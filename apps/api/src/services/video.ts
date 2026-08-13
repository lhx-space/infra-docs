import type {VideoAsset} from '../generated/prisma/client';
import {Prisma} from '../generated/prisma/client';
import {logger} from '../logger';
import {
  createVideoAsset,
  decrementVideoAssetRefCount,
  deleteVideoAsset,
  findVideoAssetById,
  findVideoAssetBySha256,
  incrementVideoAssetRefCount
} from '../models/video-asset';
import {enqueueVideoTranscodeJob} from '../queue/video-transcode';
import {computeSha256} from '../utils/content-hash';
import {
  buildVideoPublicUrl,
  deleteRawVideo,
  deleteVideoAssetArtifacts,
  uploadRawVideo
} from './video-storage';

/** 风格对齐 services/wiki.ts 的 WikiError：status + message，handler 层统一映射成 HTTP 状态码 */
export class VideoError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'VideoError';
    this.status = status;
  }
}

export interface UploadVideoResult {
  assetId: string;
  status: 'processing' | 'ready' | 'failed';
  hlsUrl: string | null;
  posterUrl: string | null;
  error: string | null;
}

function toUploadResult(asset: VideoAsset): UploadVideoResult {
  return {
    assetId: asset.id,
    status: asset.status.toLowerCase() as UploadVideoResult['status'],
    hlsUrl: asset.hlsManifestKey ? buildVideoPublicUrl(asset.hlsManifestKey) : null,
    posterUrl: asset.posterKey ? buildVideoPublicUrl(asset.posterKey) : null,
    error: asset.error
  };
}

/**
 * 上传原始视频：先对内容计算 sha256 查重（见 video-dedup-and-lifecycle spec.md「相同内容
 * 的重复上传自动去重」）——命中已存在资产时直接复用，不重复转码，返回该资产的完整当前
 * 状态（可能已经是 `ready`，见 design.md 决策 6，前端不需要再等一轮轮询）。**上传本身
 * （无论命中还是未命中）都不会改变引用计数**——引用计数只反映资产当前被多少篇已保存
 * 文档实际引用，完全由 `services/document.ts` 的 `updateDocument` 在保存时对内容做
 * diff 来维护（见 design.md 决策 2；这是实现过程中修正过的一处设计：如果上传时就认领
 * 一次引用，文档保存时的 diff 会把"从 0 次到 1 次出现"再算一次新增引用，同一次插入被
 * 计两次）。未命中时维持原有流程：写入私有 bucket，落库为 `PROCESSING`、`refCount: 0`，
 * 把转码任务放进队列后立即返回（见 design.md 决策 1、spec.md「接受原始视频文件上传并
 * 立即返回处理中状态」）。
 */
export async function uploadVideo(
  buffer: Buffer,
  mimeType: string,
  userId: string
): Promise<UploadVideoResult> {
  const sha256 = computeSha256(buffer);

  const existing = await findVideoAssetBySha256(sha256);
  if (existing) {
    return toUploadResult(existing);
  }

  const {objectKey} = await uploadRawVideo(buffer, mimeType);

  try {
    const asset = await createVideoAsset({
      originalObjectKey: objectKey,
      createdBy: userId,
      sha256,
      refCount: 0
    });
    await enqueueVideoTranscodeJob({assetId: asset.id, originalObjectKey: objectKey});
    return toUploadResult(asset);
  } catch (err) {
    // 并发下另一个请求几乎同时上传了同一份"从未出现过"的内容，两边都会走到这里插入，
    // 后到的这次会因 sha256 唯一约束冲突失败——转为按"命中"逻辑处理，不视为异常
    // （见 design.md 决策 5，同样不认领任何引用）
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await findVideoAssetBySha256(sha256);
      if (winner) {
        // 这次多余上传的原始文件已经写进 raw bucket 但用不上了，删掉避免泄漏；
        // 不入队转码，因为已经有另一个任务在处理同样的内容
        await deleteRawVideo(objectKey);
        return toUploadResult(winner);
      }
    }
    throw err;
  }
}

export interface VideoStatusResult {
  status: 'processing' | 'ready' | 'failed';
  hlsUrl: string | null;
  posterUrl: string | null;
  error: string | null;
}

/**
 * 查询转码状态（见 spec.md「转码状态查询」）：`hlsUrl`/`posterUrl` 由存储的 objectKey
 * 实时拼接成公开 URL，不在 `VideoAsset` 表里冗余存一份完整 URL——跟 `image-upload-dedup`
 * 里图片直接存完整 URL 的做法不同，是因为图片的 URL 会被直接写进 `Document.coverImage`
 * 这个字符串字段持久化，而这里只是查询响应的即时拼接，没有持久化冗余的顾虑。
 */
export async function getVideoStatus(assetId: string): Promise<VideoStatusResult> {
  const asset = await findVideoAssetById(assetId);
  if (!asset) {
    throw new VideoError(404, 'not_found');
  }

  return {
    status: asset.status.toLowerCase() as VideoStatusResult['status'],
    hlsUrl: asset.hlsManifestKey ? buildVideoPublicUrl(asset.hlsManifestKey) : null,
    posterUrl: asset.posterKey ? buildVideoPublicUrl(asset.posterKey) : null,
    error: asset.error
  };
}

/**
 * 增加某个视频资产的引用计数——恢复历史版本导致某个 assetId 重新出现在文档内容中时调用
 * （见 video-dedup-and-lifecycle spec.md「视频引用计数生命周期管理」场景"恢复历史版本
 * 重新引入视频"）。目标资产不存在时（此前已经被彻底清理）只记录日志，不抛出异常——
 * 这种情况下文档里会留下一个指向不存在资产的视频节点，跟图片去重"释放一个未被追踪的
 * 旧值"是同一类可接受的边界情况，不在这里做修复。
 */
export async function acquireVideoRef(assetId: string, times = 1): Promise<void> {
  try {
    await incrementVideoAssetRefCount(assetId, times);
  } catch (err) {
    logger.error({err, assetId, times}, 'acquire video ref failed: asset not found');
  }
}

/**
 * 释放某个视频资产的一次（或多次）引用——视频节点从文档内容中消失、文档被删除时调用
 * （见 spec.md「视频引用计数生命周期管理」）。归零时删除 `VideoAsset` 记录本身并尝试
 * 清理对象存储中的全部产物（见 design.md 决策 4）；物理删除失败只记录日志，不影响
 * 调用方的主流程。
 */
export async function releaseVideoRef(assetId: string, times = 1): Promise<void> {
  const updated = await decrementVideoAssetRefCount(assetId, times).catch((err: unknown) => {
    logger.error({err, assetId, times}, 'release video ref failed: asset not found');
    return null;
  });
  if (!updated || updated.refCount > 0) return;

  await deleteVideoAssetArtifacts(updated.id, updated.originalObjectKey);
  await deleteVideoAsset(updated.id).catch(err => {
    logger.error({err, assetId: updated.id}, 'video asset record delete failed');
  });
}
