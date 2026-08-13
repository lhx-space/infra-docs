import {http} from '@/network';

export interface UploadVideoResult {
  assetId: string;
  /** 去重命中一个已经转码完成（甚至失败）的资产时，不再总是 `processing`
   * （见 video-dedup-and-lifecycle design.md 决策 6） */
  status: 'processing' | 'ready' | 'failed';
  hlsUrl: string | null;
  posterUrl: string | null;
  error: string | null;
}

export interface VideoStatusResult {
  status: 'processing' | 'ready' | 'failed';
  hlsUrl: string | null;
  posterUrl: string | null;
  error: string | null;
}

/**
 * 视频上传 + 转码状态查询（见 video-transcoding spec.md）。跟 `services/upload.ts`
 * 的图片上传是同一个设计取向：不绑定 Wiki/Document 这一个具体场景。上传接口现在会
 * 对内容去重（见 video-dedup-and-lifecycle spec.md「相同内容的重复上传自动去重」）：
 * 命中已存在资产时同步返回其完整当前状态（可能已经是 `ready`），未命中时才是
 * `processing`，真正的转码结果要通过 `getVideoStatus` 轮询获得。
 */
export function uploadVideo(file: File): Promise<UploadVideoResult> {
  const formData = new FormData();
  formData.append('file', file);
  return http.post<UploadVideoResult>('/videos', formData);
}

export function getVideoStatus(assetId: string): Promise<VideoStatusResult> {
  return http.get<VideoStatusResult>(`/videos/${assetId}`);
}
