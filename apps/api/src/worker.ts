import {execFile} from 'node:child_process';
import {Worker} from 'bullmq';
import {cleanupOrphanVideoAssets} from './jobs/cleanup-orphan-video-assets';
import {processVideoTranscodeJob} from './jobs/process-video-transcode';
import {logger} from './logger';
import {queueConnection} from './queue/connection';
import {
  scheduleOrphanVideoCleanup,
  VIDEO_CLEANUP_CONCURRENCY,
  VIDEO_CLEANUP_QUEUE_NAME
} from './queue/video-cleanup';
import {
  VIDEO_TRANSCODE_CONCURRENCY,
  VIDEO_TRANSCODE_QUEUE_NAME,
  type VideoTranscodeJobData
} from './queue/video-transcode';
import {ensureVideoStorageReady} from './services/video-storage';

/**
 * `videos-raw`/`videos` 这两个 MinIO bucket 原来只在 `server.ts` 启动时确保存在
 * （`ensureVideoStorageReady`），`worker` 从未调用过——`docker-compose.yml` 里
 * `api`/`worker` 两个 service 是并行独立启动的，没有 `depends_on` 顺序保证，且即使加了
 * `depends_on`，也只能保证"容器进程已启动"，不保证 `server.ts` 里那个异步、不 await 的
 * `ensureVideoStorageReady()` 调用已经跑完——首次冷启动时如果 `worker` 恰好先于 `api`
 * 完成 bucket 创建就消费到一个转码任务，会直接因为 bucket 不存在而失败。这里让 `worker`
 * 也在自己启动时确保一遍（跟 `server.ts` 调的是同一个幂等函数：存在则跳过、不存在则
 * 创建，失败只记录日志不阻塞启动），彻底去掉这个隐性的启动顺序依赖，不管 `api`/`worker`
 * 谁先启动、甚至单独只起 `worker` 用于本地调试，都不会受影响。
 */
void ensureVideoStorageReady();

/**
 * 独立的转码 worker 进程入口（见 design.md 决策 2：不与 HTTP API 共用进程，本地开发/生产
 * 都需要单独起一个进程跑这个文件）。启动时做一次 `ffmpeg -version` 探活检查——失败只记录
 * 错误日志、不阻塞进程启动，让"部署环境没预装 ffmpeg"这类问题尽早在启动日志里暴露，而不是
 * 等到第一次真正处理任务才报错（见 design.md Risks）。
 */
function probeFfmpeg(): void {
  execFile('ffmpeg', ['-version'], (err, stdout) => {
    if (err) {
      logger.error({err}, 'ffmpeg binary not found — video transcoding will fail');
      return;
    }
    logger.info({version: stdout.split('\n')[0]}, 'ffmpeg probe ok');
  });
}

probeFfmpeg();

const worker = new Worker<VideoTranscodeJobData>(
  VIDEO_TRANSCODE_QUEUE_NAME,
  job => processVideoTranscodeJob(job.data),
  {
    connection: queueConnection,
    // 保守的默认并发上限，避免多个 ffmpeg 进程同时跑互相拖慢（见 design.md 决策 1、Risks；tasks.md 4.5）
    concurrency: VIDEO_TRANSCODE_CONCURRENCY
  }
);

worker.on('completed', job => {
  logger.info({jobId: job.id, assetId: job.data.assetId}, 'video transcode job completed');
});
worker.on('failed', (job, err) => {
  logger.error({jobId: job?.id, assetId: job?.data.assetId, err}, 'video transcode job failed');
});

logger.info({concurrency: VIDEO_TRANSCODE_CONCURRENCY}, 'video transcode worker started');

/**
 * 孤儿视频资产清理 worker（见 upload-reliability-hardening proposal.md）：跟转码
 * worker 共存于同一进程，但用独立的队列/并发（`VIDEO_CLEANUP_CONCURRENCY`），不占用
 * 转码任务的并发名额（见 design.md 决策 1）。`scheduleOrphanVideoCleanup()` 注册一次
 * 定期触发的 repeatable job，重复调用是幂等的，进程重启不会叠加出多个调度。
 */
const cleanupWorker = new Worker(VIDEO_CLEANUP_QUEUE_NAME, () => cleanupOrphanVideoAssets(), {
  connection: queueConnection,
  concurrency: VIDEO_CLEANUP_CONCURRENCY
});

cleanupWorker.on('completed', () => {
  logger.info('orphan video asset cleanup run completed');
});
cleanupWorker.on('failed', (job, err) => {
  logger.error({jobId: job?.id, err}, 'orphan video asset cleanup run failed');
});

void scheduleOrphanVideoCleanup().catch(err => {
  logger.error({err}, 'failed to schedule orphan video asset cleanup');
});

logger.info('orphan video asset cleanup worker started');

const shutdown = async (signal: string): Promise<void> => {
  logger.info({signal}, 'worker shutting down');
  await Promise.all([worker.close(), cleanupWorker.close()]);
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
