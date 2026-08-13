import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpeg from 'fluent-ffmpeg';
import {logger} from '../logger';
import {
  markVideoAssetFailed,
  markVideoAssetPosterReady,
  markVideoAssetReady
} from '../models/video-asset';
import {VIDEO_TRANSCODE_CONCURRENCY, type VideoTranscodeJobData} from '../queue/video-transcode';
import {
  deleteRawVideo,
  deleteVideoAssetArtifacts,
  downloadRawVideoToTempFile,
  uploadHlsArtifacts,
  uploadPosterArtifact
} from '../services/video-storage';

const MANIFEST_FILENAME = 'playlist.m3u8';
const POSTER_FILENAME = 'poster.jpg';
/** 单一分辨率转码目标——v1 不做多码率自适应（见 design.md 决策 5） */
const OUTPUT_HEIGHT = 720;
/** HLS 分片时长（秒） */
const HLS_SEGMENT_SECONDS = 6;
/** libx264 编码 preset：`medium`（默认）换成更快的档位，牺牲少量压缩率换转码速度
 * （见 video-dedup-and-lifecycle design.md 决策 7） */
const ENCODE_PRESET = 'veryfast';
/** 单个转码任务允许使用的 ffmpeg 线程数上限：让"并发任务数 × 每任务线程数"不超过机器
 * 总核心数，避免同机器上多个转码任务无限制抢占 CPU（见 design.md 决策 7、Risks，
 * 前几轮真实验证观察到的"并发任务互相抢核"现象） */
const ENCODE_THREADS = Math.max(1, Math.floor(os.cpus().length / VIDEO_TRANSCODE_CONCURRENCY));

function transcodeToHls(inputPath: string, outputDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilters(`scale=-2:${OUTPUT_HEIGHT}`)
      .outputOptions([
        '-preset',
        ENCODE_PRESET,
        '-threads',
        String(ENCODE_THREADS),
        '-hls_time',
        String(HLS_SEGMENT_SECONDS),
        '-hls_playlist_type',
        'vod',
        '-hls_segment_filename',
        path.join(outputDir, 'segment_%03d.ts')
      ])
      .output(path.join(outputDir, MANIFEST_FILENAME))
      .on('end', () => resolve())
      .on('error', err => reject(err))
      .run();
  });
}

function extractPoster(inputPath: string, outputDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .on('end', () => resolve())
      .on('error', err => reject(err))
      .screenshots({
        timestamps: ['1'],
        filename: POSTER_FILENAME,
        folder: outputDir,
        size: `?x${OUTPUT_HEIGHT}`
      });
  });
}

/**
 * 消费一条转码任务（见 tasks.md 4.1~4.4，以及后续「封面优先」优化）：
 *
 * 1. 下载原始文件到本地；
 * 2. **封面优先**：先单独截一帧封面（这一步比完整 HLS 转码快得多——通常是几百毫秒到
 *    一两秒，而完整转码可能要几秒到几十秒），截完立刻上传封面、落库
 *    `markVideoAssetPosterReady`（状态仍是 `PROCESSING`，只是多了 `posterKey`）。
 *    前端轮询到这个中间态就能提前展示一张静态封面，而不是一直转圈——不用等完整转码
 *    跑完才有任何视觉反馈（见 document-editor spec.md「转码中展示封面」）。
 * 3. 再跑完整的 HLS 转码，产物写入对象存储，落库为 `ready`。
 * 4. 异步删除原始文件。
 *
 * 任意步骤失败都落库为 `failed` 并保留原始文件（见 design.md 决策 8），本地临时文件
 * 无论成功失败都会清理干净。失败时重新抛出异常，让 BullMQ 也把这个 job 标记为 failed
 * （保留操作可见性，不只是把状态藏在 `VideoAsset` 表里）。
 *
 * 封面和 HLS 产物用两个独立的本地临时目录（而不是像之前那样共用一个目录、靠
 * `Promise.all` 并发跑）——封面必须先出结果并单独上传，跟"HLS 转码到底跑没跑完"
 * 完全解耦，用同一个目录反而不好区分"现在该上传哪些文件"。
 *
 * **资产在任务进行中被引用计数归零清理的竟态**（见 video-dedup-and-lifecycle 上线后
 * 新引入的窗口：`VideoAsset` 记录不再永远存在，`refCount` 归零会被物理删除，见
 * `services/video.ts` 的 `releaseVideoRef`）：如果转码任务跑到一半，恰好这时文档保存
 * 把这个视频从内容里删掉、引用归零，`markVideoAssetPosterReady`/`markVideoAssetReady`
 * 会返回 `null`（见 `models/video-asset.ts` 的 `updateOrNullIfMissing`）——这不是失败，
 * 是"已经没人要这个视频了"，此时清理掉刚上传的产物并直接返回，不当作 job 失败处理
 * （不重新抛出异常，避免 BullMQ 记一条误导性的"失败"日志）。
 */
export async function processVideoTranscodeJob(data: VideoTranscodeJobData): Promise<void> {
  const {assetId, originalObjectKey} = data;
  const posterDir = path.join(os.tmpdir(), `video-poster-${randomUUID()}`);
  const hlsDir = path.join(os.tmpdir(), `video-hls-${randomUUID()}`);
  await Promise.all([fs.mkdir(posterDir, {recursive: true}), fs.mkdir(hlsDir, {recursive: true})]);

  let inputPath: string | null = null;
  try {
    inputPath = await downloadRawVideoToTempFile(originalObjectKey);

    await extractPoster(inputPath, posterDir);
    const {posterKey} = await uploadPosterArtifact(assetId, posterDir, POSTER_FILENAME);
    const posterReadyAsset = await markVideoAssetPosterReady(assetId, posterKey);
    if (!posterReadyAsset) {
      logger.info(
        {assetId},
        'video asset removed mid-transcode, abandoning job after poster stage'
      );
      await deleteVideoAssetArtifacts(assetId, originalObjectKey);
      return;
    }

    await transcodeToHls(inputPath, hlsDir);
    const {hlsManifestKey} = await uploadHlsArtifacts(assetId, hlsDir, MANIFEST_FILENAME);
    const readyAsset = await markVideoAssetReady(assetId, {hlsManifestKey});
    if (!readyAsset) {
      logger.info({assetId}, 'video asset removed mid-transcode, abandoning job after hls stage');
      await deleteVideoAssetArtifacts(assetId, originalObjectKey);
      return;
    }

    await deleteRawVideo(originalObjectKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({err, assetId}, 'video transcode failed');
    const failedAsset = await markVideoAssetFailed(assetId, message);
    if (failedAsset) throw err;
    // 资产在任务失败前就已经被引用计数归零清理了，没有必要再把这次转码失败当作一次
    // job 失败向上抛（`VideoAsset` 记录都不在了，`failed` 状态也无处落地，重新抛出只会
    // 制造一条无人关心的错误日志），日志已经记过一次原始错误，直接结束
  } finally {
    if (inputPath) await fs.rm(inputPath, {force: true}).catch(() => {});
    await fs.rm(posterDir, {recursive: true, force: true}).catch(() => {});
    await fs.rm(hlsDir, {recursive: true, force: true}).catch(() => {});
  }
}
