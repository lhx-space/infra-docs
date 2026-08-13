import {prisma} from '../db/prisma';
import type {PrismaClient, VideoAsset, VideoAssetStatus} from '../generated/prisma/client';
import {Prisma} from '../generated/prisma/client';

export type {VideoAsset, VideoAssetStatus};

type Client = PrismaClient;

/**
 * 引用计数生命周期管理上线后，`VideoAsset` 记录不再是"永远不会消失"的（归零即物理删除，
 * 见 `services/video.ts` 的 `releaseVideoRef`）——如果转码任务正在进行中，恰好这时文档
 * 保存把这个视频从内容里删掉导致引用归零，记录会在任务完成前被删除。这几个 worker 侧
 * 的 `mark*` 函数于是可能对着一条已经不存在的记录 `update()`，Prisma 会抛出 P2025
 * （"record not found"）。用这个小工具统一把 P2025 转成返回 `null`，让调用方
 * （`jobs/process-video-transcode.ts`）能正常判断"这个资产已经不需要了"并提前退出，
 * 而不是被这个可预期的竟态直接炸掉整个 job。
 */
async function updateOrNullIfMissing(
  update: () => Promise<VideoAsset>
): Promise<VideoAsset | null> {
  try {
    return await update();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return null;
    }
    throw err;
  }
}

export interface CreateVideoAssetInput {
  originalObjectKey: string;
  createdBy: string;
  /** 未命中去重时才会传（首次出现的内容）；历史数据允许为空，见 video.prisma 顶部注释 */
  sha256?: string;
  /** 调用方（`services/video.ts`）总是显式传 0——上传本身不认领引用，见 video.prisma
   * `refCount` 字段注释与 design.md 决策 2 */
  refCount: number;
}

/** 上传接口收到合法视频文件后立即调用，落库为 `status = PROCESSING`（默认值），
 * `refCount` 默认 1（见 tasks.md 3.2、design.md 决策 2） */
export function createVideoAsset(
  input: CreateVideoAssetInput,
  client: Client = prisma
): Promise<VideoAsset> {
  return client.videoAsset.create({data: input});
}

export function findVideoAssetById(
  id: string,
  client: Client = prisma
): Promise<VideoAsset | null> {
  return client.videoAsset.findUnique({where: {id}});
}

/** 上传去重查找入口（见 video-dedup-and-lifecycle spec.md「相同内容的重复上传自动去重」）；
 * 历史记录 `sha256` 为 `null`，查找参数不可能是 `null`，天然不会误命中它们 */
export function findVideoAssetBySha256(
  sha256: string,
  client: Client = prisma
): Promise<VideoAsset | null> {
  return client.videoAsset.findUnique({where: {sha256}});
}

export interface MarkVideoAssetReadyInput {
  hlsManifestKey: string;
}

/** worker 完整转码成功后调用（见 tasks.md 4.2）；`posterKey` 已经在更早的
 * `markVideoAssetPosterReady` 里落库过，这里不需要重复写。资产已被引用计数归零清理时
 * 返回 `null`（见顶部 `updateOrNullIfMissing` 注释），调用方据此清理这次转码产物、
 * 提前结束 job，不当作失败处理 */
export function markVideoAssetReady(
  id: string,
  data: MarkVideoAssetReadyInput,
  client: Client = prisma
): Promise<VideoAsset | null> {
  return updateOrNullIfMissing(() =>
    client.videoAsset.update({
      where: {id},
      data: {status: 'READY', hlsManifestKey: data.hlsManifestKey}
    })
  );
}

/**
 * worker 截封面成功后立刻调用（见 jobs/process-video-transcode.ts「封面优先」注释）：
 * 只更新 `posterKey`，不改 `status`——此时完整 HLS 转码还没跑完，状态仍是
 * `PROCESSING`，只是多了一张可以提前展示的封面。资产已被引用计数归零清理时返回 `null`
 * （见顶部 `updateOrNullIfMissing` 注释）。
 */
export function markVideoAssetPosterReady(
  id: string,
  posterKey: string,
  client: Client = prisma
): Promise<VideoAsset | null> {
  return updateOrNullIfMissing(() => client.videoAsset.update({where: {id}, data: {posterKey}}));
}

/** worker 转码失败后调用，`error` 记录可读的失败原因（见 tasks.md 4.3）。资产已被引用
 * 计数归零清理时返回 `null`（见顶部 `updateOrNullIfMissing` 注释）——没必要对一条已经
 * 不存在的记录报"标记失败也失败了"的二次错误 */
export function markVideoAssetFailed(
  id: string,
  error: string,
  client: Client = prisma
): Promise<VideoAsset | null> {
  return updateOrNullIfMissing(() =>
    client.videoAsset.update({where: {id}, data: {status: 'FAILED', error}})
  );
}

/** 去重命中/恢复历史版本重新引入某个视频时调用，原子自增，避免并发下的丢失更新
 * （见 video-dedup-and-lifecycle design.md 决策 5、tasks.md 2.1/2.3/3.3） */
export function incrementVideoAssetRefCount(
  id: string,
  by = 1,
  client: Client = prisma
): Promise<VideoAsset> {
  return client.videoAsset.update({where: {id}, data: {refCount: {increment: by}}});
}

/** 视频节点从文档内容中消失、文档被删除时调用，原子自减（见 tasks.md 3.2） */
export function decrementVideoAssetRefCount(
  id: string,
  by = 1,
  client: Client = prisma
): Promise<VideoAsset> {
  return client.videoAsset.update({where: {id}, data: {refCount: {decrement: by}}});
}

/** 引用计数归零后物理删除记录本身（见 design.md 决策 4，跟图片去重"归零只删对象、
 * 保留记录"不同）；调用方负责先清理对象存储产物 */
export function deleteVideoAsset(id: string, client: Client = prisma): Promise<VideoAsset> {
  return client.videoAsset.delete({where: {id}});
}

/** 孤儿资产清理入口（见 upload-reliability-hardening spec.md「孤儿转码资产清理」）：
 * 找出所有创建超过 `maxAgeMs` 且仍从未被任何文档引用（`refCount = 0`）的资产，不区分
 * `status`——清理仍在转码中的孤儿是安全的（见 jobs/process-video-transcode.ts 顶部
 * 「资产在任务进行中被引用计数归零清理的竟态」注释）。 */
export function findOrphanVideoAssets(
  maxAgeMs: number,
  client: Client = prisma
): Promise<VideoAsset[]> {
  return client.videoAsset.findMany({
    where: {refCount: 0, createdAt: {lt: new Date(Date.now() - maxAgeMs)}}
  });
}

/**
 * 只有当 `refCount` 在删除这一刻仍然是 0 时才真的删除，返回是否真的删除了——用
 * `deleteMany` 带条件而不是普通 `delete`，防止"查出孤儿列表之后、真正删除之前"这段
 * 极短窗口内，恰好有一次保存把这个资产重新引用了（`refCount` 变回 > 0），却被清理
 * 任务误删。 */
export async function deleteVideoAssetIfStillOrphan(
  id: string,
  client: Client = prisma
): Promise<boolean> {
  const result = await client.videoAsset.deleteMany({where: {id, refCount: 0}});
  return result.count > 0;
}
