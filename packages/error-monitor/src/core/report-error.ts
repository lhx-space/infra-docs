import {dispatchError, getTraceInfo} from './dispatch';

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
 *
 * 跟 `handleUnhandledRejection` 一样接入 `extractTraceInfo`（见
 * error-monitor-network-support design.md 决策 4）：业务代码 `catch` 住一个网络错误
 * 后手动上报，跟没 catch 直接变成 unhandledrejection 走的是同一种"外部注入的 unknown
 * 错误值"路径，理应共享同一份提取逻辑。调用点显式传入的 `extra` 优先级更高，覆盖
 * 提取出来的同名字段。
 */
export function reportError(
  error: unknown,
  extra?: Record<string, unknown>,
  options?: ReportErrorOptions
): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const traceInfo = getTraceInfo(error);
  // 未配置 `extractTraceInfo`/未判定为网络错误时 `traceInfo` 为 `undefined`——这里显式
  // 保持 `extra` 依然是 `undefined`（而不是退化成 `{}`），确保「未配置该钩子时行为与
  // 改动前完全一致」（见 spec.md「未配置提取钩子」、tasks.md 3.5）。
  const mergedExtra = traceInfo?.extra || extra ? {...traceInfo?.extra, ...extra} : undefined;

  dispatchError({
    source: 'manual',
    level: 'warning',
    message,
    stack,
    traceId: traceInfo?.traceId,
    extra: mergedExtra,
    forceImmediate: options?.dedupe === false
  });
}
