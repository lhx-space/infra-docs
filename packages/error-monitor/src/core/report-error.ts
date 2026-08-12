import {dispatchError} from './dispatch';

export interface ReportErrorOptions {
  /**
   * 传 `false` 跳过去重，这一条永远立即上报——业务代码明确知道"这条必须发出去"时用
   * （比如同一个 fingerprint 理论上会撞上，但每一次触发的业务上下文都不一样，不希望
   * 被合并成一条汇总）。不影响全局节流阀，节流阀依然可能生效（见 design.md 决策 3）。
   * 默认 `true`（走正常的去重逻辑）。
   */
  dedupe?: boolean;
}

/**
 * 手动上报 API：业务代码在 `catch` 块里已经处理过某个错误，但仍想留痕时调用（见
 * spec.md「手动上报 API」）。跟自动捕获的错误走的是完全同一条分发/去重链路，只是
 * `source` 固定为 `'manual'`。
 */
export function reportError(
  error: unknown,
  extra?: Record<string, unknown>,
  options?: ReportErrorOptions
): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  dispatchError({
    source: 'manual',
    level: 'warning',
    message,
    stack,
    extra,
    forceImmediate: options?.dedupe === false
  });
}
