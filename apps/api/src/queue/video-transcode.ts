import {Queue} from 'bullmq';
import {queueConnection} from './connection';

export const VIDEO_TRANSCODE_QUEUE_NAME = 'video-transcode';

/** worker（`src/worker.ts`）同时处理的转码任务数量上限（见 design.md 决策 1、Risks；
 * tasks.md 4.5）——保守取值，避免多个 ffmpeg 进程互相抢占 CPU 拖慢彼此。 */
export const VIDEO_TRANSCODE_CONCURRENCY = 2;

export interface VideoTranscodeJobData {
  assetId: string;
  /** 原始视频在 `videos-raw` bucket 中的 objectKey，worker 据此下载源文件（见 services/video-storage.ts） */
  originalObjectKey: string;
}

/**
 * 视频转码任务队列：`POST /videos` 的 handler 只负责把任务放进队列后立即返回
 * （见 design.md 决策 1），真正的 ffmpeg 转码由 `src/worker.ts` 里的 `Worker` 异步消费。
 */
export const videoTranscodeQueue = new Queue<VideoTranscodeJobData>(VIDEO_TRANSCODE_QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    // 转码失败已经通过 `VideoAsset.status = 'failed'` 落库并保留原始文件供排查（见
    // spec.md「转码失败」），不需要 BullMQ 层面的自动重试——重试一次耗时的转码任务、
    // 且大概率会因为同样的源文件问题再次失败，价值有限。
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: false
  }
});

export function enqueueVideoTranscodeJob(data: VideoTranscodeJobData): Promise<void> {
  return videoTranscodeQueue.add('transcode', data).then(() => undefined);
}
