import {Queue} from 'bullmq';
import {queueConnection} from './connection';

/**
 * 文档导出的队列定义（见 tasks.md 4.1，结构对齐 queue/video-transcode.ts）：目前只有
 * PDF 走异步队列（无头浏览器渲染，耗时明显长于同步转换），Markdown/Word 在请求线程内
 * 同步完成，不进队列（见 design.md 决策 7）。
 */
export const DOCUMENT_EXPORT_PDF_QUEUE_NAME = 'document-export-pdf';

/** worker 同时处理的 PDF 导出任务数上限——保守取值对齐 `VIDEO_TRANSCODE_CONCURRENCY`
 * （多个 Chromium 实例同时渲染互相抢占内存/CPU，见 design.md Risks）。 */
export const DOCUMENT_EXPORT_PDF_CONCURRENCY = 2;

export interface DocumentExportPdfJobData {
  exportId: string;
  documentId: string;
}

export const documentExportPdfQueue = new Queue<DocumentExportPdfJobData>(
  DOCUMENT_EXPORT_PDF_QUEUE_NAME,
  {
    connection: queueConnection,
    defaultJobOptions: {
      // 失败已经通过 `DocumentExport.status = 'FAILED'` + `errorMessage` 落库并可被
      // 前端轮询到（见 spec.md「生成失败的状态反馈」），不需要 BullMQ 自动重试——
      // PDF 生成失败大概率是确定性的（如 Playwright 环境问题），重试只是重复占用
      // 浏览器资源。取向对齐 queue/video-transcode.ts 的 `attempts: 1`。
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: false
    }
  }
);

export function enqueueDocumentExportPdfJob(data: DocumentExportPdfJobData): Promise<void> {
  return documentExportPdfQueue.add('export-pdf', data).then(() => undefined);
}

/**
 * ---- 超期导出清理的调度（见 tasks.md 6.1）----
 * 参照 queue/video-cleanup.ts 的既有模式：用 BullMQ 的 repeatable job（`upsertJobScheduler`）
 * 而不是 `setInterval`，多 worker 副本部署时同一调度只有一个实例生效；固定
 * `jobSchedulerId` 的 upsert 语义天然幂等，进程重启不会叠加出多个调度。
 */
export const DOCUMENT_EXPORT_CLEANUP_QUEUE_NAME = 'document-export-cleanup';

export const DOCUMENT_EXPORT_CLEANUP_CONCURRENCY = 1;

/** 清理任务执行间隔——每小时一次，配合 24 小时保留时长足够及时（见 design.md 决策 8） */
export const DOCUMENT_EXPORT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export const DOCUMENT_EXPORT_CLEANUP_JOB_NAME = 'cleanup-expired-document-exports';

const documentExportCleanupQueue = new Queue(DOCUMENT_EXPORT_CLEANUP_QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: true
  }
});

/** worker 进程启动时调用一次，注册（或确认已注册）定期清理任务 */
export function scheduleDocumentExportCleanup(): Promise<void> {
  return documentExportCleanupQueue
    .upsertJobScheduler(
      DOCUMENT_EXPORT_CLEANUP_JOB_NAME,
      {every: DOCUMENT_EXPORT_CLEANUP_INTERVAL_MS},
      {name: DOCUMENT_EXPORT_CLEANUP_JOB_NAME, data: {}}
    )
    .then(() => undefined);
}
