import {dispatchError} from '../core/dispatch';

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

/**
 * Vue 3 `app.config.errorHandler` / Vue 2 `Vue.config.errorHandler` 的回调签名
 * 基本一致：`(err, instance, info) => void`（`instance` 类型两个版本不同，这里不关心
 * 具体类型，只透传给 `info` 做上下文说明）。
 */
export type VueErrorHandler = (err: unknown, instance: unknown, info: string) => void;

/**
 * 生成可以直接赋给 `app.config.errorHandler`（Vue 3）/ `Vue.config.errorHandler`
 * （Vue 2）的全局兜底函数（对应 `/react` 的 `createRootErrorHandlers`，见 design.md
 * 决策 6）。
 *
 * 关键差异：Vue 全局只有这一个 handler，不像 React 19 root 那样天然区分"被某个
 * boundary 接住恢复了"和"完全没人接住"两种严重级别——这里不强行套 `ErrorLevel` 的
 * `fatal`/`error` 二分，统一按 `'error'` 处理；具体触发场景（渲染函数/watcher/
 * 生命周期等）通过 `info` 参数塞进 `extra` 供排查参考。
 */
export function createVueErrorHandler(): VueErrorHandler {
  return (err, _instance, info) => {
    dispatchError({
      source: 'render',
      level: 'error',
      message: messageFromUnknown(err),
      stack: stackFromUnknown(err),
      extra: {info}
    });
  };
}
