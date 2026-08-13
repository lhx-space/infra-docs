import {Queue} from 'bullmq';
import {queueConnection} from './connection';

export const VIDEO_CLEANUP_QUEUE_NAME = 'video-cleanup';

/** 清理任务本身很轻（一次索引查询 + 少量删除），跟真正的转码任务（`video-transcode`
 * 队列）用独立的队列/并发语义，不占用转码并发名额（见 upload-reliability-hardening
 * design.md 决策 1） */
export const VIDEO_CLEANUP_CONCURRENCY = 1;

/** 清理任务的执行间隔——每小时一次足够及时回收孤儿资产，又不会对系统造成额外负担
 * （见 design.md 决策 1、Risks） */
export const VIDEO_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export const VIDEO_CLEANUP_JOB_NAME = 'cleanup-orphan-video-assets';

/**
 * 孤儿视频资产清理队列（见 upload-reliability-hardening proposal.md）：定期回收
 * "创建超过一定时间窗口、`refCount` 仍为 0"的 `VideoAsset`。用 BullMQ 自带的
 * repeatable job，而不是 `setInterval`——多个 worker 副本部署时，BullMQ 会保证同一个
 * repeatable job 定义只有一个调度实例生效，不会导致多副本各自重复触发清理
 * （见 design.md 决策 1）。
 */
export const videoCleanupQueue = new Queue(VIDEO_CLEANUP_QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: true
  }
});

/**
 * 注册（或确认已注册）定期清理任务——`upsertJobScheduler` 是 BullMQ 6.x 里创建
 * repeatable job 的推荐方式（旧的 `queue.add(name, data, {repeat})` 已经不再推荐，
 * 见 bullmq 类型声明 `job-options.d.ts` 顶部注释）。用固定的 `jobSchedulerId` 避免
 * 每次进程重启都叠加出一个新的重复调度——重复调用是 upsert 语义，天然幂等。
 * worker 进程启动时调用一次即可。
 */
export function scheduleOrphanVideoCleanup(): Promise<void> {
  return videoCleanupQueue
    .upsertJobScheduler(
      VIDEO_CLEANUP_JOB_NAME,
      {every: VIDEO_CLEANUP_INTERVAL_MS},
      {name: VIDEO_CLEANUP_JOB_NAME, data: {}}
    )
    .then(() => undefined);
}
