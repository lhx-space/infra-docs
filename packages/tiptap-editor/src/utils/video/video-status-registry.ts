export interface VideoStatusResult {
  status: 'processing' | 'ready' | 'failed';
  hlsUrl?: string | null;
  posterUrl?: string | null;
  error?: string | null;
}

/**
 * 全包共享的"查询视频转码状态"实现注册表，跟 `video-uploader-registry.ts` 是同一个桥接
 * 模式。`VideoView`（NodeView 组件）在 `status: 'processing'` 时会定期调用这个函数轮询
 * 最新状态（见 document-editor spec.md「转码完成后自动更新」「重新打开文档时同步最新
 * 转码状态」——两条需求用的是同一段轮询逻辑：NodeView 挂载时只要发现 `status` 仍是
 * `processing` 就会开始轮询，不区分"刚插入"还是"重新打开文档时才第一次挂载"）。
 */
let activePoller: ((assetId: string) => Promise<VideoStatusResult>) | null = null;

export function setActiveVideoStatusPoller(poller: typeof activePoller): void {
  activePoller = poller;
}

export function getActiveVideoStatusPoller(): typeof activePoller {
  return activePoller;
}
