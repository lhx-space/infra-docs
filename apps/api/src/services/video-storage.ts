import {randomUUID} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Client as MinioClient} from 'minio';
import {env} from '../env';
import {logger} from '../logger';

/** 原始上传文件：保持默认私有策略，只给 worker 内部下载转码用，不对外公开 */
const RAW_VIDEOS_BUCKET = 'videos-raw';
/** HLS 转码产物（清单 + 分片 + 封面帧）：public-read，供浏览器直接播放，不需要鉴权
 * （跟 image-upload-dedup 的 covers bucket 是同一个道理，见 design.md 决策 5） */
const HLS_VIDEOS_BUCKET = 'videos';

const minioClient = new MinioClient({
  endPoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: false,
  accessKey: env.MINIO_ROOT_USER,
  secretKey: env.MINIO_ROOT_PASSWORD
});

function buildPublicReadPolicy(bucket: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {AWS: ['*']},
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`]
      }
    ]
  });
}

/**
 * 启动时确保两个视频相关 bucket 存在：`videos-raw` 保持默认私有策略，`videos`（HLS 产物）
 * 设为 public-read。失败只记录日志不阻塞启动，跟 `services/storage.ts` 的
 * `ensureStorageReady` 同一个风格（见 design.md 决策 4「Risk」呼应的探活思路）。
 */
export async function ensureVideoStorageReady(): Promise<void> {
  try {
    for (const bucket of [RAW_VIDEOS_BUCKET, HLS_VIDEOS_BUCKET]) {
      const exists = await minioClient.bucketExists(bucket);
      if (!exists) await minioClient.makeBucket(bucket);
    }
    await minioClient.setBucketPolicy(HLS_VIDEOS_BUCKET, buildPublicReadPolicy(HLS_VIDEOS_BUCKET));
    logger.info({buckets: [RAW_VIDEOS_BUCKET, HLS_VIDEOS_BUCKET]}, 'video minio buckets ready');
  } catch (err) {
    logger.error({err}, 'video minio bucket setup failed');
  }
}

export interface UploadRawVideoResult {
  objectKey: string;
}

/** handler 收到上传文件后调用：原始文件写入私有 bucket，仅供 worker 后续下载转码用 */
export async function uploadRawVideo(
  buffer: Buffer,
  mimeType: string
): Promise<UploadRawVideoResult> {
  const objectKey = randomUUID();
  await minioClient.putObject(RAW_VIDEOS_BUCKET, objectKey, buffer, buffer.length, {
    'Content-Type': mimeType
  });
  return {objectKey};
}

/**
 * worker 转码前调用：把原始文件下载到本地临时路径，供 `fluent-ffmpeg` 按文件路径读取——
 * 落地到本地临时文件是最简单可靠的实现（大文件流式转码优化本轮不做，见 design.md
 * Non-Goals 的整体取向：先把链路跑通，不过早优化）。
 */
export async function downloadRawVideoToTempFile(objectKey: string): Promise<string> {
  const tempPath = path.join(os.tmpdir(), `video-raw-${randomUUID()}`);
  const stream = await minioClient.getObject(RAW_VIDEOS_BUCKET, objectKey);
  await new Promise<void>((resolve, reject) => {
    const writeStream = createWriteStream(tempPath);
    stream.pipe(writeStream);
    stream.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);
  });
  return tempPath;
}

/** 转码成功后调用，删除原始文件（见 design.md 决策 8）；失败只记录日志，不影响调用方主流程 */
export async function deleteRawVideo(objectKey: string): Promise<void> {
  try {
    await minioClient.removeObject(RAW_VIDEOS_BUCKET, objectKey);
  } catch (err) {
    logger.error({err, objectKey}, 'raw video object delete failed');
  }
}

function guessContentType(filename: string): string {
  if (filename.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (filename.endsWith('.ts')) return 'video/mp2t';
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

export interface UploadPosterArtifactResult {
  posterKey: string;
}

/**
 * worker 截封面成功后立刻调用（比完整 HLS 转码快得多，见 jobs/process-video-transcode.ts
 * 顶部注释「封面优先」）：只上传这一张封面帧，不等完整转码，让前端能在 `processing`
 * 阶段就展示一张静态封面，而不是一直转圈（见 document-editor spec.md「转码中展示封面」）。
 */
export async function uploadPosterArtifact(
  assetId: string,
  localDir: string,
  posterFilename: string
): Promise<UploadPosterArtifactResult> {
  const filePath = path.join(localDir, posterFilename);
  const buffer = await fs.readFile(filePath);
  const posterKey = `${assetId}/${posterFilename}`;
  await minioClient.putObject(HLS_VIDEOS_BUCKET, posterKey, buffer, buffer.length, {
    'Content-Type': guessContentType(posterFilename)
  });
  return {posterKey};
}

export interface UploadHlsArtifactsResult {
  hlsManifestKey: string;
}

/**
 * worker 完整 HLS 转码成功后调用：把本地输出目录下的清单 + 全部分片上传到 `videos`
 * bucket，统一用 `${assetId}/` 做前缀隔离不同视频的产物，避免文件名冲突。封面帧不在
 * 这个目录里（由 `uploadPosterArtifact` 更早地单独上传过一次，两者用的是各自独立的
 * 本地临时目录，见调用方 jobs/process-video-transcode.ts）。
 */
export async function uploadHlsArtifacts(
  assetId: string,
  localDir: string,
  manifestFilename: string
): Promise<UploadHlsArtifactsResult> {
  const entries = await fs.readdir(localDir);
  for (const filename of entries) {
    const filePath = path.join(localDir, filename);
    const buffer = await fs.readFile(filePath);
    await minioClient.putObject(
      HLS_VIDEOS_BUCKET,
      `${assetId}/${filename}`,
      buffer,
      buffer.length,
      {
        'Content-Type': guessContentType(filename)
      }
    );
  }
  return {hlsManifestKey: `${assetId}/${manifestFilename}`};
}

export function buildVideoPublicUrl(objectKey: string): string {
  return `${env.MINIO_PUBLIC_URL}/${HLS_VIDEOS_BUCKET}/${objectKey}`;
}

/**
 * 引用计数归零时调用（见 video-dedup-and-lifecycle design.md 决策 4）：删除 `videos`
 * bucket 里 `${assetId}/` 前缀下的全部产物（清单/分片/封面帧）；`originalObjectKey`
 * 非空时（转码失败场景下原始文件会保留，见现有决策 8）同时尝试删除 `videos-raw` 里的
 * 原始文件。整体是 best-effort：任何一步失败只记录日志，不向上抛出，不阻塞调用方
 * 释放引用这个主流程。
 */
export async function deleteVideoAssetArtifacts(
  assetId: string,
  originalObjectKey: string
): Promise<void> {
  try {
    const stream = minioClient.listObjectsV2(HLS_VIDEOS_BUCKET, `${assetId}/`, true);
    const names: string[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on('data', obj => {
        if (obj.name) names.push(obj.name);
      });
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });
    if (names.length) await minioClient.removeObjects(HLS_VIDEOS_BUCKET, names);
  } catch (err) {
    logger.error({err, assetId}, 'video hls artifacts delete failed');
  }

  await deleteRawVideo(originalObjectKey);
}
