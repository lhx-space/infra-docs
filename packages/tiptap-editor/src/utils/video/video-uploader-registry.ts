import {beginPendingUpload, endPendingUpload} from '../shared/pending-upload-registry';

export interface VideoUploadResult {
  assetId: string;
  /** 去重命中一个已经转码完成的资产时可能直接是 `ready`（甚至 `failed`），不再总是
   * `processing`（见 video-dedup-and-lifecycle design.md 决策 6） */
  status: 'processing' | 'ready' | 'failed';
  hlsUrl: string | null;
  posterUrl: string | null;
  error: string | null;
}

/**
 * 全包共享的"当前视频上传实现"注册表，跟 `image-uploader-registry.ts` 是同一个桥接模式：
 * 斜杠命令的"视频"候选项是模块级静态数据，拿不到 `DocumentEditor` 组件的 props，用这个
 * 模块级可变引用桥接由消费方（`apps/web`）注入的上传回调。上传只返回 `assetId`（转码是
 * 异步的，见 video-transcoding spec.md），真正的转码状态由 `video-status-registry.ts`
 * 里的轮询器查询。
 */
let activeUploader: ((file: File) => Promise<VideoUploadResult>) | null = null;

export function setActiveVideoUploader(uploader: typeof activeUploader): void {
  activeUploader = uploader;
}

export function getActiveVideoUploader(): typeof activeUploader {
  return activeUploader;
}

/** `pending-upload-registry.ts` 共享计数器的类型化外壳（见 upload-reliability-hardening
 * design.md 决策 3）：调用点看到 `beginVideoUpload`/`endVideoUpload` 就知道这是视频
 * 上传在计数，实际计数逻辑只有共享模块那一份，不会跟图片那边各算各的、算出不一致的值。 */
export const beginVideoUpload = beginPendingUpload;
export const endVideoUpload = endPendingUpload;
