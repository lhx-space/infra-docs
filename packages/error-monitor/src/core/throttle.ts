import type {ErrorReport, ThrottleOptions} from './types';

/**
 * 全局节流阀（见 design.md 决策 3、spec.md「全局节流」）：跟 `dedupe.ts` 是两道独立的
 * 闸门——去重管的是"同一个错误重复"，这里管的是"单位时间内总共放行多少条"，不区分
 * fingerprint，专门用来防"短时间内冒出一堆*不同*错误"这种去重完全无能为力的场景。
 *
 * 用固定窗口（跟 `dedupe.ts` 一致的风格，不是滑动窗口）：窗口内放行数达到 `maxCount`
 * 后，后续报告默认全部丢弃，`allowFatal`（默认 `true`）时 `fatal` 级别仍然放行——节流阀
 * 的目的是防普通错误的洪水，不该连带吞掉"应用可能已经整体崩溃"这种最高优先级的信号。
 *
 * 被丢弃的报告不会完全无声无息：窗口结束时，如果这个窗口内确实丢过东西，会调用
 * `onWindowDrop` 补一条"这个窗口内丢弃了 N 条报告"的诊断信息（由调用方——`dispatch.ts`
 * ——决定怎么把这条信息送出去，`throttle.ts` 自己不直接依赖 `send`，避免循环依赖）。
 */
export function createThrottle(
  options: ThrottleOptions | null,
  onWindowDrop: (droppedCount: number, options: ThrottleOptions) => void
) {
  let windowCount = 0;
  let droppedInWindow = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function resetWindow(activeOptions: ThrottleOptions): void {
    timer = undefined;
    if (droppedInWindow > 0) {
      onWindowDrop(droppedInWindow, activeOptions);
    }
    windowCount = 0;
    droppedInWindow = 0;
  }

  /** 返回 `true` 表示允许这条报告继续往下走（调用 `Reporter`），`false` 表示被节流丢弃。 */
  function allow(report: ErrorReport): boolean {
    if (!options) return true;

    if (timer === undefined) {
      timer = setTimeout(() => {
        if (options) resetWindow(options);
      }, options.windowMs);
    }

    if (windowCount < options.maxCount) {
      windowCount += 1;
      return true;
    }

    if ((options.allowFatal ?? true) && report.level === 'fatal') {
      // fatal 不计入 windowCount，也不算作"被丢弃"——它是被显式豁免放行的，不是节流
      // 阀失效，跟真正被吞掉的报告要分开统计，避免 onWindowDrop 汇总数字失真。
      return true;
    }

    droppedInWindow += 1;
    return false;
  }

  return {allow};
}

export type Throttle = ReturnType<typeof createThrottle>;
