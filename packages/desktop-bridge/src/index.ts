/**
 * desktop 原生能力桥（SDK）的类型契约 + 访问器。
 *
 * apps/desktop 的 preload 用 contextBridge 把 main 进程能力以 `window.bridge` 暴露给
 * renderer；`@luhanxin/app` 等 web 代码通过 `getDesktopBridge()` 拿到它，在 Electron 里
 * 走原生通道、在普通浏览器里返回 null 走 web 降级。这里只定义「契约」，不依赖 Electron，
 * 也不假设一定运行在 Electron 里。
 */

export interface SaveFileResult {
  canceled: boolean;
  filePath?: string;
}

export interface DesktopBridge {
  /** 用系统默认浏览器打开外部链接（http/https） */
  openExternal(url: string): Promise<void>;
  /** 弹原生「另存为」对话框写二进制文件（文档导出等），取消时返回 {canceled: true} */
  saveFile(options: {defaultPath: string; content: Uint8Array}): Promise<SaveFileResult>;
  /** 读系统钥匙串里的 token（safeStorage 加密落盘），无则 null */
  getStoredToken(): Promise<string | null>;
  /** 把 token 加密写入系统钥匙串 */
  setStoredToken(token: string): Promise<void>;
  /** 清除钥匙串里的 token */
  clearStoredToken(): Promise<void>;
  /** 订阅深链事件（luhanxin-docs-app://...），返回取消订阅函数 */
  onDeepLink(callback: (url: string) => void): () => void;
  /** 当前平台：darwin | win32 | linux 等 */
  platform: string;
  /** Electron / Chromium / Node 版本信息 */
  versions: {electron: string; chrome: string; node: string};
}

/** 取桌面桥；非 Electron 环境（普通浏览器）下 window.bridge 不存在，返回 null */
export function getDesktopBridge(): DesktopBridge | null {
  return (window as {bridge?: DesktopBridge}).bridge ?? null;
}
