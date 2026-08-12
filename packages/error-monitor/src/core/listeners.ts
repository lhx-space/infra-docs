import {dispatchError} from './dispatch';

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function stackFromUnknown(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

/** 全局同步异常（见 design.md 决策 2 表格第一行）：事件处理函数、`setTimeout` 回调等
 * 未被 try/catch 接住的错误，最终都会以 `ErrorEvent` 的形式派发到 `window` 上。这个
 * 监听器注册在默认（非捕获）阶段——全局脚本错误的 `event.target` 就是 `window` 本身，
 * 捕获/冒泡阶段对它没有区别，用默认阶段即可。 */
function handleGlobalError(event: ErrorEvent): void {
  dispatchError({
    source: 'runtime',
    level: 'error',
    message: event.message || messageFromUnknown(event.error),
    stack: stackFromUnknown(event.error)
  });
}

/** 未处理的 Promise rejection：`async/await` 链路里没写 `.catch()` 的错误，这部分是
 * `ErrorBoundary` 完全覆盖不到的场景（见 design.md Context）。 */
function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  dispatchError({
    source: 'promise',
    level: 'error',
    message: messageFromUnknown(event.reason),
    stack: stackFromUnknown(event.reason)
  });
}

const RESOURCE_TAG_NAMES = new Set(['IMG', 'SCRIPT', 'LINK']);

function resourceUrl(target: Element): string | undefined {
  if (target instanceof HTMLImageElement) return target.src;
  if (target instanceof HTMLScriptElement) return target.src;
  if (target instanceof HTMLLinkElement) return target.href;
  return undefined;
}

/**
 * 静态资源加载失败：必须注册在**捕获阶段**（第三个参数 `true`）——资源加载错误的
 * `event.bubbles` 是 `false`，不会冒泡到默认（非捕获）阶段的 `window` 监听器，只有
 * 捕获阶段能在事件下行途中拿到（见 design.md 决策 2）。
 *
 * 这里用 `event.target instanceof Element` 过滤：全局脚本错误的 `event.target` 是
 * `window` 本身（不是 `Element`），资源加载失败的 `event.target` 才是具体的
 * `<img>`/`<script>`/`<link>` 元素，两者不会互相误判。
 */
function handleResourceError(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element) || !RESOURCE_TAG_NAMES.has(target.tagName)) return;

  dispatchError({
    source: 'resource',
    level: 'warning',
    message: `资源加载失败: <${target.tagName.toLowerCase()}>`,
    extra: {resourceUrl: resourceUrl(target)}
  });
}

/**
 * 挂载全局监听器，返回一个卸载函数。非浏览器环境（比如未来某天核心逻辑被用在 Node
 * 测试环境里）直接跳过，返回一个空操作的卸载函数，不抛错。
 */
export function attachGlobalListeners(): () => void {
  if (typeof window === 'undefined') return () => {};

  window.addEventListener('error', handleGlobalError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
  window.addEventListener('error', handleResourceError, true);

  return () => {
    window.removeEventListener('error', handleGlobalError);
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    window.removeEventListener('error', handleResourceError, true);
  };
}
