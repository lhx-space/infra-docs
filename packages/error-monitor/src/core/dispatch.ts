import {createDeduper, DEFAULT_DEDUP_WINDOW_MS, type Deduper} from './dedupe';
import {createThrottle, type Throttle} from './throttle';
import type {BeforeSendHook, DedupeOptions, ErrorReport, Reporter, ThrottleOptions} from './types';

let reporters: Reporter[] = [];
let beforeSend: BeforeSendHook | undefined;
let deduper: Deduper = createDeduper({windowMs: DEFAULT_DEDUP_WINDOW_MS});
let throttle: Throttle = createThrottle(null, () => {});
let configuredAppName: string | undefined;
let configuredAppVersion: string | undefined;
let currentUserId: string | undefined;
let idCounter = 0;

export interface ConfigureDispatchOptions {
  reporters: Reporter[];
  beforeSend?: BeforeSendHook;
  dedupe?: DedupeOptions;
  throttle?: ThrottleOptions;
  appName?: string;
  appVersion?: string;
}

function buildThrottle(options: ThrottleOptions | undefined): Throttle {
  return createThrottle(options ?? null, (droppedCount, activeOptions) => {
    // 节流阀触发丢弃时补的诊断信息——直接调用内部 `send`，不再经过 `deduper`/`throttle`
    // 本身，避免"上报节流丢弃的日志"又被节流或去重掉的自我循环（跟 dispatch.ts 里
    // Reporter 抛异常直接打 console.error、不再走 Reporter 链路是同一个道理）。
    send({
      id: generateId(),
      source: 'meta',
      level: 'warning',
      message: `错误上报已达节流上限，本窗口内丢弃了 ${droppedCount} 条报告`,
      timestamp: Date.now(),
      url: typeof window !== 'undefined' ? window.location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      appName: configuredAppName,
      appVersion: configuredAppVersion,
      userId: currentUserId,
      extra: {droppedCount, windowMs: activeOptions.windowMs, maxCount: activeOptions.maxCount}
    });
  });
}

/**
 * `initErrorMonitor` 调用时配置一次，后续所有来源共用这一份配置（见 design.md 决策 2：
 * 所有来源最终都调用同一个内部"上报入口"函数，只是 `source` 字段不同，不是每类来源
 * 各写一套分发逻辑）。
 */
export function configureDispatch(options: ConfigureDispatchOptions): void {
  reporters = options.reporters;
  beforeSend = options.beforeSend;
  configuredAppName = options.appName;
  configuredAppVersion = options.appVersion;
  deduper = createDeduper(options.dedupe ?? {});
  throttle = buildThrottle(options.throttle);
}

/**
 * 支持在 `initErrorMonitor` 之后、运行期间中途调整去重/节流策略，不需要重新走一遍
 * `initErrorMonitor`（那样会连带重新挂载全局监听器，没必要）——见 spec.md「运行期间
 * 动态调整去重/节流策略」。`dedupe`/`throttle` 都是整体替换，不做增量合并；`throttle`
 * 传 `null` 表示显式关闭节流阀。
 */
export function updateNoiseControl(options: {
  dedupe?: DedupeOptions;
  throttle?: ThrottleOptions | null;
}): void {
  if (options.dedupe) deduper = createDeduper(options.dedupe);
  if ('throttle' in options) throttle = buildThrottle(options.throttle ?? undefined);
}

/** 供 `setErrorMonitorUser` 调用，之后产出的错误报告都会带上这个 `userId`。 */
export function setDispatchUserId(userId: string | undefined): void {
  currentUserId = userId;
}

function generateId(): string {
  idCounter += 1;
  return `err_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/** 各采集来源调用 `dispatchError` 时传入的原始输入——只需要提供跟这个错误本身相关的
 * 字段，`id`/`timestamp`/`url`/`userAgent`/`appName`/`appVersion`/`userId` 这些公共字段
 * 由 `dispatchError` 统一补全，采集侧不需要关心。 */
export type RawErrorInput = Pick<
  ErrorReport,
  'source' | 'level' | 'message' | 'stack' | 'componentStack' | 'extra'
> &
  Partial<Pick<ErrorReport, 'userId'>> & {
    /**
     * 调用点级别的去重覆盖（目前只有 `reportError(error, extra, {dedupe: false})` 会
     * 传 `true`）：跳过 fingerprint 分桶，这条报告永远立即放行，不受 `shouldDedupe`
     * 钩子影响（调用点的显式意图优先级最高）。不影响全局节流阀——节流阀是总吞吐量的
     * 硬限制，不因为某条报告"不想被去重"就豁免。
     */
    forceImmediate?: boolean;
  };

/**
 * 内部统一的"上报入口"：全部来源最终都调用这个函数——补全公共字段 → 交给去重管理器
 * 判断是否要立即上报 → 通过节流阀 → 分发给全部已注册的 `Reporter`（见 design.md
 * 决策 2、决策 3）。
 */
export function dispatchError(input: RawErrorInput): void {
  const report: ErrorReport = {
    ...input,
    id: generateId(),
    timestamp: Date.now(),
    url: typeof window !== 'undefined' ? window.location.href : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    appName: configuredAppName,
    appVersion: configuredAppVersion,
    userId: input.userId ?? currentUserId
  };

  deduper.handle(report, sendThroughThrottle, input.forceImmediate === true);
}

function sendThroughThrottle(report: ErrorReport): void {
  if (!throttle.allow(report)) return;
  send(report);
}

function send(report: ErrorReport): void {
  const finalReport = beforeSend ? beforeSend(report) : report;
  if (!finalReport) return;

  for (const reporter of reporters) {
    try {
      void reporter.report(finalReport);
    } catch (err) {
      // 单个 Reporter 内部抛异常要隔离掉，不能影响其他 Reporter 正常收到这条报告；
      // 这里直接打 console.error，不走 Reporter 链路，避免"上报出错的日志本身又
      // 触发一次上报"的死循环
      console.error('[error-monitor] a reporter threw while reporting an error', err);
    }
  }
}
