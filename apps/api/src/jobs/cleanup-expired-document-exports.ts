import {logger} from '../logger';
import {deleteDocumentExport, findExpiredDocumentExports} from '../models/document-export';
import {deleteDocumentExportObject} from '../services/document-export-storage';

/** 导出产物保留时长（见 document-export design.md 决策 8）：24 小时后由本 job 回收
 * 记录与存储对象。写死常量不做成环境变量，取向对齐 jobs/cleanup-orphan-video-assets.ts。 */
export const DOCUMENT_EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * 超期导出清理任务的实际执行逻辑（见 tasks.md 6.1，由 queue/document-export.ts 的
 * repeatable job 定期触发，结构对齐 jobs/cleanup-orphan-video-assets.ts）：找出全部
 * 超期记录，逐个删除对象存储产物 + 数据库记录；单条失败只记录日志，不影响其余记录
 * 的清理（best-effort，跟视频孤儿资产清理同一个取向）。
 *
 * 跟视频清理不同的一点：导出记录没有“重新被引用”的窗口——`createdAt` 只增不变、
 * 没有引用计数语义，超期即可安全删除，不需要条件删除防竟态。
 */
export async function cleanupExpiredDocumentExports(): Promise<void> {
  const expired = await findExpiredDocumentExports(DOCUMENT_EXPORT_RETENTION_MS);
  if (expired.length === 0) return;

  logger.info({count: expired.length}, 'expired document exports found, cleaning up');

  for (const record of expired) {
    try {
      if (record.objectKey) {
        await deleteDocumentExportObject(record.objectKey);
      }
      await deleteDocumentExport(record.id);
      logger.info({exportId: record.id}, 'expired document export cleaned up');
    } catch (err) {
      logger.error({err, exportId: record.id}, 'expired document export cleanup failed');
    }
  }
}
