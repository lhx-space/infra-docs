/**
 * 全包共享的"图片上传失败提示"注册表，跟 `image-uploader-registry.ts` 是同一个桥接模式：
 * 图片上传的三个入口（工具栏已下线，现在是粘贴/拖拽/斜杠命令）都在 `startImageUpload`
 * （见 utils/upload-image-plugin.ts）里失败，但那是纯 ProseMirror 层的代码，拿不到
 * `DocumentEditor` 组件的 props，所以失败提示也要通过这个模块级引用桥接回 React 层，
 * 由消费方决定怎么展示（比如 `apps/web` 接了 toast）。不传这个 prop 时静默失败——
 * 只是没有额外提示，不影响"占位消失、不留下任何图片节点"这条核心行为。
 */
let activeHandler: ((message: string) => void) | null = null;

export function setActiveImageUploadErrorHandler(
  handler: ((message: string) => void) | null
): void {
  activeHandler = handler;
}

export function getActiveImageUploadErrorHandler(): ((message: string) => void) | null {
  return activeHandler;
}
