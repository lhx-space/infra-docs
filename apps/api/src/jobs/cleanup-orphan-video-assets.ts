import {logger} from '../logger';
import {deleteVideoAssetIfStillOrphan, findOrphanVideoAssets} from '../models/video-asset';
import {deleteVideoAssetArtifacts} from '../services/video-storage';

/** 创建超过这个时长、仍从未被任何文档引用的视频资产视为孤儿（见 upload-reliability-
 * hardening design.md 决策 2）：足够宽松，不会误删"用户刚上传、还没来得及保存文档"的
 * 正常场景，同时又不会让孤儿无限期占用存储。写死常量，不做成环境变量（同一取向见
 * `queue/video-transcode.ts` 的 `VIDEO_TRANSCODE_CONCURRENCY`）。 */
export const ORPHAN_VIDEO_ASSET_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * 孤儿视频资产清理任务的实际执行逻辑（由 `queue/video-cleanup.ts` 的 repeatable job
 * 定期触发，见 upload-reliability-hardening proposal.md）：找出所有满足条件的孤儿，
 * 逐个删除对象存储产物 + 数据库记录；单条失败只记录日志，不影响其余记录的清理
 * （跟 `services/video.ts` 的 `releaseVideoRef` 对物理删除失败的容错处理是同一个
 * best-effort 取向）。
 */
export async function cleanupOrphanVideoAssets(): Promise<void> {
  const orphans = await findOrphanVideoAssets(ORPHAN_VIDEO_ASSET_MAX_AGE_MS);
  if (orphans.length === 0) return;

  logger.info({count: orphans.length}, 'orphan video assets found, cleaning up');

  for (const asset of orphans) {
    try {
      // 先做条件删除（`refCount = 0` 才真的删记录），确认这条记录在删除这一刻确实
      // 还是孤儿之后，才去清理对象存储产物——顺序不能反：如果先删产物、后发现记录
      // 在这段极短窗口内已经被重新引用（`refCount` 变回 > 0），就会把一个仍在被
      // 正常使用的视频的文件误删掉。
      const deleted = await deleteVideoAssetIfStillOrphan(asset.id);
      if (!deleted) {
        logger.info(
          {assetId: asset.id},
          'orphan video asset was referenced again before cleanup, skipped deletion'
        );
        continue;
      }
      await deleteVideoAssetArtifacts(asset.id, asset.originalObjectKey);
      logger.info({assetId: asset.id}, 'orphan video asset cleaned up');
    } catch (err) {
      logger.error({err, assetId: asset.id}, 'orphan video asset cleanup failed');
    }
  }
}
