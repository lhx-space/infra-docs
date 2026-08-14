/**
 * 错误的来源分类（见 design.md 决策 2）：
 * - `render`：React 渲染阶段/生命周期/构造函数抛出的错误（`ErrorBoundary` 或 React
 *   root 级 `onUncaughtError`/`onCaughtError` 产出）
 * - `runtime`：全局同步异常（事件处理函数、`setTimeout` 回调等未被 try/catch 接住的错误）
 * - `promise`：未处理的 Promise rejection（`async/await` 链路里没写 `.catch()`）
 * - `resource`：静态资源（图片/脚本/样式）加载失败
 * - `manual`：业务代码主动调用 `reportError` 上报
 * - `meta`：`error-monitor` 自身产出的内部诊断信息（目前唯一场景：全局节流阀触发后，
 *   窗口结束时补一条"这个窗口内丢弃了 N 条报告"的汇总，见 design.md 决策 3）——不代表
 *   应用本身出了错误，只是关于"上报链路本身状态"的信号，跟其余来源的语义不同，
 *   单独归一类，不要跟 `manual` 混在一起
 * - `network`：`WebSocket`/`EventSource` 的**连接级**失败（建连失败、异常关闭、反复
 *   重连不成功），见 error-monitor-network-support design.md 决策 1——只关心连接本身，
 *   不采集消息级错误、不做 HTTP 状态码统计，继续维持跟 APM 的边界；采集入口是消费方
 *   显式调用 `registerNetworkConnection` 注册，不做自动探测
 */
export type ErrorSource =
  | 'render'
  | 'runtime'
  | 'promise'
  | 'resource'
  | 'manual'
  | 'meta'
  | 'network';

/** `network` 来源的连接分类（见 `registerNetworkConnection`）：区分是原生 `WebSocket`
 * 还是 `EventSource`（SSE），写入报告的 `extra.kind`。 */
export type NetworkConnectionKind = 'websocket' | 'sse';

/**
 * 可插拔的链路追踪 id 提取钩子（见 error-monitor-network-support design.md 决策 2）：
 * 输入是 `unhandledrejection`/`reportError` 拿到的原始 `unknown` 值，由消费方自己判断
 * 这是不是一个网络请求错误、以及怎么从里面挖出 `traceId`——`error-monitor` 核心不认识
 * 任何具体网络库/HTTP 响应头的概念，全部逻辑留给消费方实现。返回 `undefined` 表示
 * "不是网络错误"或"提取失败"，此时报告不会携带 `traceId`。
 */
export type TraceInfoExtractor = (
  reason: unknown
) => {traceId?: string; extra?: Record<string, unknown>} | undefined;

/**
 * 严重级别：`fatal` 用于完全没有被任何 `ErrorBoundary` 捕获、可能导致应用整体崩溃的错误；
 * `error` 用于被捕获/处理但仍然算作错误的情况；`warning` 用于资源加载失败、手动上报这类
 * 不影响应用整体可用性的情况。
 */
export type ErrorLevel = 'fatal' | 'error' | 'warning';

/**
 * 所有来源统一收敛成的错误报告结构（见 spec.md「统一的错误上报协议」）——不管错误来自
 * 哪一类来源，最终都是这一套字段，只通过 `source` 字段区分，不允许各来源自定义额外的
 * 结构。
 */
export interface ErrorReport {
  /** 客户端生成的唯一 id，用于去重汇总时关联/未来跟后端接口对账 */
  id: string;
  source: ErrorSource;
  level: ErrorLevel;
  message: string;
  stack?: string;
  /** 仅 `render` 来源有意义：React 提供的组件树路径 */
  componentStack?: string;
  /**
   * 可跟后端结构化日志关联的链路追踪标识（见 error-monitor-network-support
   * proposal.md「Why」第 2 点）：只有配置了 `extractTraceInfo`（`promise`/`manual`
   * 来源）且提取成功时才会填充，跟 `componentStack` 一样是"某些来源才有意义"的顶层
   * 字段，不塞进 `extra`（见 design.md 决策 3）。
   */
  traceId?: string;
  timestamp: number;
  url: string;
  userAgent: string;
  appName?: string;
  appVersion?: string;
  /** 由消费方通过 `setErrorMonitorUser` 设置，包本身不感知业务的用户体系 */
  userId?: string;
  extra?: Record<string, unknown>;
  /**
   * 去重汇总时才会带上这个字段：该 fingerprint 在去重窗口内累计出现的次数
   * （首次上报的那一条不带这个字段，见 spec.md「错误去重与节流」）
   */
  occurrences?: number;
}

/** 可插拔的上报出口（见 spec.md「可插拔的上报出口」）：`init` 时可以注册多个实现，
 * 每条错误报告都会分发给全部已注册的 `Reporter`。 */
export interface Reporter {
  report(report: ErrorReport): void | Promise<void>;
}

/** 上报前的自定义过滤钩子：返回空值（`null`/`undefined`）表示丢弃这条报告，不分发给
 * 任何 `Reporter`；也可以返回一个修改过的报告对象用于脱敏等场景。 */
export type BeforeSendHook = (report: ErrorReport) => ErrorReport | null | undefined;

/**
 * 去重/节流相关配置（见 design.md 决策 3）。跟 `ThrottleOptions` 是两道独立的闸门：
 * 这一层管的是"同一个错误在短时间内反复出现"，按 `fingerprint`（`source`+`message`+
 * 堆栈首行）分桶。
 */
export interface DedupeOptions {
  /** 去重时间窗口（毫秒），传 `false` 完全关闭去重（每次都立即放行）。默认 10000。 */
  windowMs?: number | false;
  /**
   * 同一个 fingerprint 在窗口内最多计数到多少次就提前结束窗口、立即发一条汇总，不用
   * 等到 `windowMs` 到期——主要是为了避免死循环场景下 `occurrences` 涨到一个没有实际
   * 意义的天文数字。不设置则不封顶（沿用窗口到期才汇总的行为）。
   */
  maxCountPerWindow?: number;
  /**
   * 自定义判断某条报告是否要参与去重——返回 `false` 表示这条永远立即放行、不进
   * fingerprint 分桶（比如某些业务上认为"每一次都要看到"的错误）。每条报告分发时都会
   * 调用一次，不管来源是什么；跟 `reportError` 调用点的 `{dedupe: false}` 是同一件事的
   * 两个入口——调用点覆盖优先级更高。
   */
  shouldDedupe?: (report: ErrorReport) => boolean;
}

/**
 * 全局节流阀配置（见 design.md 决策 3）：跟 `DedupeOptions` 正交，管的是"单位时间内
 * 总共放行多少条真正要发送的报告"，不区分 fingerprint——去重解决不了"短时间内冒出一堆
 * *不同*错误"的场景（比如一次基础设施性故障牵连多条不同代码路径同时报错），这道闸门
 * 才是防这种情况的。不传 `throttle`（`initErrorMonitor` 里）等于不启用，保持这是一个
 * 需要显式开启的可选能力。
 */
export interface ThrottleOptions {
  /** 节流窗口（毫秒） */
  windowMs: number;
  /** 窗口内最多放行多少条（计的是去重之后、真正会调用 `Reporter` 的条数） */
  maxCount: number;
  /**
   * 超出上限后，`fatal` 级别的报告是否仍然放行——默认为 `true`：`fatal` 代表应用可能
   * 已经整体崩溃，这类信号不该被一个为了防"吵闹的普通错误"设计的节流阀连带吞掉。
   */
  allowFatal?: boolean;
}
