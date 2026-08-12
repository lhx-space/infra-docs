export interface LinkPreviewResult {
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
}

/**
 * 跟 `image-uploader-registry.ts` 是同一个桥接模式：粘贴处理是模块级的 ProseMirror
 * Plugin，拿不到 `DocumentEditor` 组件的 props，用这个模块级引用传递消费方注入的
 * `fetchLinkPreview` 实现（见 link-preview spec.md「服务端抓取链接元信息」——具体调用哪个
 * 接口由 `apps/web` 决定，本包不感知）。
 */
let activeFetcher: ((url: string) => Promise<LinkPreviewResult | null>) | null = null;

export function setActiveLinkPreviewFetcher(
  fetcher: ((url: string) => Promise<LinkPreviewResult | null>) | null
): void {
  activeFetcher = fetcher;
}

export function getActiveLinkPreviewFetcher():
  | ((url: string) => Promise<LinkPreviewResult | null>)
  | null {
  return activeFetcher;
}
