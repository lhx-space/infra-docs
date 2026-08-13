/**
 * 全包共享的"视频上传失败提示"注册表，跟 `image-upload-error-registry.ts` 是同一个桥接
 * 模式：视频上传（斜杠命令触发）失败时需要通知 React 层展示提示，但触发点本身是纯
 * ProseMirror/DOM 层代码，拿不到 `DocumentEditor` 组件的 props。不传这个 prop 时静默
 * 失败——只是没有额外提示，不影响"上传失败不插入任何视频节点"这条核心行为。
 */
let activeHandler: ((message: string) => void) | null = null;

export function setActiveVideoUploadErrorHandler(handler: typeof activeHandler): void {
  activeHandler = handler;
}

export function getActiveVideoUploadErrorHandler(): typeof activeHandler {
  return activeHandler;
}
