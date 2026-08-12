import {http} from '@/network';

export interface LinkPreviewResult {
  available: boolean;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
}

/** 对应 `POST /link-preview`（见 link-preview spec.md），失败时后端返回 `{available: false}`，
 * 不是 HTTP 错误，调用方据此自动降级为纯文本链接 */
export function fetchLinkPreview(url: string): Promise<LinkPreviewResult> {
  return http.post<LinkPreviewResult>('/link-preview', {url});
}
