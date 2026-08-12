import {dispatchError} from '../core/dispatch';

/**
 * 从任意抛出值里尽量抠出 message/stack，跟 `core/listeners.ts` 里的思路一致，这里独立
 * 一份而不是导出复用：不想让这个 React 子路径的构建产物反过来依赖 `core/listeners.ts`
 * 的内部实现细节，两边各自维护自己需要的最小工具函数，保持解耦。
 */
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

interface RootErrorInfo {
  componentStack?: string;
}

export interface RootErrorHandlers {
  onUncaughtError: (error: unknown, errorInfo: RootErrorInfo) => void;
  onCaughtError: (error: unknown, errorInfo: RootErrorInfo) => void;
  onRecoverableError: (error: unknown, errorInfo: RootErrorInfo) => void;
}

/**
 * 生成可以直接传给 `createRoot(container, {...})` 的三个 root 级回调（见 spec.md
 * 「React 根节点级别的错误信号补充」、design.md 决策 4）：
 * - `onCaughtError`：错误被某个 `ErrorBoundary` 捕获并恢复展示了，级别是 `error`
 * - `onUncaughtError`：完全没有任何 `ErrorBoundary` 接住，级别是 `fatal`
 * - `onRecoverableError`：React 内部自动从某些错误里恢复（如 hydration 不匹配），
 *   应用本身不会崩，级别定为 `warning`，只是留个痕
 */
export function createRootErrorHandlers(): RootErrorHandlers {
  function report(
    error: unknown,
    errorInfo: RootErrorInfo,
    level: 'fatal' | 'error' | 'warning'
  ): void {
    dispatchError({
      source: 'render',
      level,
      message: messageFromUnknown(error),
      stack: stackFromUnknown(error),
      componentStack: errorInfo.componentStack
    });
  }

  return {
    onUncaughtError: (error, errorInfo) => report(error, errorInfo, 'fatal'),
    onCaughtError: (error, errorInfo) => report(error, errorInfo, 'error'),
    onRecoverableError: (error, errorInfo) => report(error, errorInfo, 'warning')
  };
}
