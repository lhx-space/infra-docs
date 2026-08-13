import {beginPendingUpload, endPendingUpload} from '../shared/pending-upload-registry';

/**
 * 全包共享的"当前图片上传实现"注册表：斜杠命令的"图片"候选项、粘贴/拖拽处理都需要调用
 * 同一个由消费方（`apps/web`）注入的 `uploadImage` 回调，但斜杠命令的候选项列表是模块级
 * 静态数据（见 utils/slash-command.ts），拿不到 `DocumentEditor` 组件的 props——这里用一个
 * 模块级可变引用做桥接，`DocumentEditor` 挂载/卸载时负责设置/清空它。
 */
let activeUploader: ((file: File) => Promise<string>) | null = null;

export function setActiveImageUploader(uploader: ((file: File) => Promise<string>) | null): void {
  activeUploader = uploader;
}

export function getActiveImageUploader(): ((file: File) => Promise<string>) | null {
  return activeUploader;
}

/** `pending-upload-registry.ts` 共享计数器的类型化外壳，跟 `video-uploader-registry.ts`
 * 同一个理由（见 upload-reliability-hardening design.md 决策 3） */
export const beginImageUpload = beginPendingUpload;
export const endImageUpload = endPendingUpload;
