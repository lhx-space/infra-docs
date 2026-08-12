import {configureDispatch, setDispatchUserId, updateNoiseControl} from './dispatch';
import {attachGlobalListeners} from './listeners';
import type {BeforeSendHook, DedupeOptions, Reporter, ThrottleOptions} from './types';

export interface InitErrorMonitorOptions {
  /** 至少注册一个 Reporter，否则捕获到的错误无处可去（见 spec.md「可插拔的上报出口」）。 */
  reporters: Reporter[];
  appName?: string;
  appVersion?: string;
  beforeSend?: BeforeSendHook;
  /** 去重相关配置，不传等同于 `{windowMs: 10000}`（默认行为，见 design.md 决策 3）。 */
  dedupe?: DedupeOptions;
  /** 全局节流阀配置，不传表示不启用（默认关闭，见 design.md 决策 3）。 */
  throttle?: ThrottleOptions;
}

let detachListeners: (() => void) | undefined;

/**
 * 应用启动时调用一次，完成全局监听器的挂载与上报出口的配置（见 proposal.md「What
 * Changes」）。重复调用会先卸载上一次挂载的监听器再重新挂载，不会因为重复调用（比如
 * React `StrictMode` 下开发环境的双重渲染）叠加出两份监听器。
 */
export function initErrorMonitor(options: InitErrorMonitorOptions): void {
  detachListeners?.();

  configureDispatch({
    reporters: options.reporters,
    beforeSend: options.beforeSend,
    dedupe: options.dedupe,
    throttle: options.throttle,
    appName: options.appName,
    appVersion: options.appVersion
  });

  detachListeners = attachGlobalListeners();
}

/**
 * 供消费方在用户登录/退出时更新当前用户身份，之后产出的错误报告都会带上这个
 * `userId`（见 design.md「Open Questions」）。传 `undefined` 等同于清空（比如退出登录）。
 */
export function setErrorMonitorUser(userId: string | undefined): void {
  setDispatchUserId(userId);
}

/**
 * 运行期间中途调整去重/节流策略，不需要重新调用 `initErrorMonitor`（那样会连带重新
 * 挂载全局监听器，没必要）——见 spec.md「运行期间动态调整去重/节流策略」。`dedupe`/
 * `throttle` 都是整体替换成新配置，不做增量合并；`throttle` 传 `null` 显式关闭节流阀，
 * 不传该字段则保持现状不变。
 */
export function configureErrorMonitorNoiseControl(options: {
  dedupe?: DedupeOptions;
  throttle?: ThrottleOptions | null;
}): void {
  updateNoiseControl(options);
}
