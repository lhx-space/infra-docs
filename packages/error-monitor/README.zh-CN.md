# @luhanxin/error-monitor

> 一个轻量、跟框架无关的错误监控工具包，面向浏览器与基于 WebView 的混合应用（hybrid）——涵盖渲染错误、全局同步异常、未捕获 Promise rejection、静态资源加载失败、WebSocket/SSE 连接失败，统一收敛为同一套可上报协议。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)

**[English](./README.md) | [简体中文](./README.zh-CN.md)**

## 特性

- **统一的错误上报协议** —— 无论来源是什么（渲染错误、运行时异常、Promise rejection、资源加载失败、网络连接失败、手动上报），最终都是同一套 `ErrorReport` 字段结构，只通过 `source` 字段区分。
- **6 类采集来源**，各自按需接入：
  - `render` —— React 的 `ErrorBoundary` + root 级 `onUncaughtError`/`onCaughtError`/`onRecoverableError`，或 Vue 的 `errorHandler`/`onErrorCaptured`
  - `runtime` —— 未被 try/catch 接住的全局同步异常（`window.onerror`）
  - `promise` —— 未处理的 `Promise` rejection
  - `resource` —— `<img>`/`<script>`/`<link>` 加载失败
  - `network` —— **连接级**的 `WebSocket`/`EventSource` 失败（通过 `registerNetworkConnection` 显式注册，不做自动探测）
  - `manual` —— `reportError()`，供业务代码已经 `catch` 处理过、但仍想留痕的错误
- **去重 + 节流** —— 基于 fingerprint 的去重窗口把短时间内的重复错误合并成一条汇总记录；可选的全局节流阀限制单位时间内的总上报量（`fatal` 级别可豁免）。
- **可插拔的上报出口** —— 初始化时可以注册任意多个 `Reporter` 实现，其中一个抛异常不影响其他正常收到报告。内置 `ConsoleReporter`（开发期友好的结构化日志）与 `HttpReporter`（生产级、可靠投递）。
- **链路追踪 id 关联** —— 可选的 `extractTraceInfo` 钩子，可以给 `promise`/`manual` 来源打上能跟后端日志关联的 `traceId`（比如从一次 API 错误响应头里提取），核心包完全不需要认识任何具体的 HTTP 细节。
- **核心零框架依赖** —— `@luhanxin/error-monitor` 本身不依赖 React/Vue；`/react`、`/vue` 是独立的子路径入口，只有真正 import 了才会打包进产物。

## 环境支持

这个包面向**浏览器与基于 WebView 的混合应用**（Cordova/Ionic/Capacitor、Electron renderer 等——任何存在真实 DOM 的地方），**不适配** React Native（Hermes/JSC，没有真实 DOM）或纯 Node.js 服务端：

| 能力 | 浏览器 / WebView 混合应用 | Node.js | React Native |
| --- | --- | --- | --- |
| `render`（`ErrorBoundary`） | ✅ | — | ✅（纯 React 逻辑，跟 DOM 无关） |
| `render`（`createRootErrorHandlers`） | ✅（`react-dom` root 选项） | — | ⚠️ RN 不用 `react-dom` |
| `runtime` / `promise` / `resource` | ✅（`window` 全局监听） | ⚪️ 空操作（已做兜底，不会抛错） | ❌ |
| `network`（`registerNetworkConnection`） | ✅（原生 `WebSocket`/`EventSource`） | ⚠️ 只有传入实现了 `EventTarget` 接口的 `WebSocket` 才可能可用；没有原生 `EventSource` | ❌（没有 `EventSource`） |
| `HttpReporter` 持久化队列 | ✅（`IndexedDB` → `localStorage` → 内存三级降级） | ⚪️ 退化为纯内存队列 | ❌ |

`⚪️` = 会安全地退化成空操作/内存兜底、不会抛错，但这个能力在那个环境下实际没什么意义。

## 安装

```bash
npm install @luhanxin/error-monitor
# 或
pnpm add @luhanxin/error-monitor
```

React/Vue 是可选的 peer dependency，只有 import 了对应的 `/react`、`/vue` 子路径才需要。

## 快速开始

```ts
import {ConsoleReporter, initErrorMonitor} from '@luhanxin/error-monitor';

initErrorMonitor({
  reporters: [new ConsoleReporter()],
  appName: 'my-app',
  appVersion: '1.0.0'
});
```

这一步会挂载 `runtime`/`promise`/`resource`（以及部分 `render`）的全局监听器。如果是 React 应用，还需要接入 root 级回调，才能覆盖完全没被任何 `ErrorBoundary` 接住的渲染错误：

```tsx
import {createRootErrorHandlers} from '@luhanxin/error-monitor/react';
import {createRoot} from 'react-dom/client';

createRoot(document.getElementById('root')!, createRootErrorHandlers()).render(<App />);
```

## 使用指南

### 上报网络连接失败（`WebSocket`/`EventSource`）

`network` 来源**从不自动生效**——需要显式注册你关心的那个具体实例，并拿到一个注销函数：

```ts
import {registerNetworkConnection} from '@luhanxin/error-monitor';

const ws = new WebSocket('wss://example.com/realtime');
const unregister = registerNetworkConnection(ws, 'websocket', 'my-realtime-channel');

// 之后这个具体实例不再需要被监控时（比如手动重连即将创建一个全新的 WebSocket 实例前）：
unregister();
```

只采集**连接级**失败（建连失败、异常关闭状态码、反复重连不成功）——消息级解析错误和 HTTP 状态码有意排除在外，那属于 APM 的范畴，不是崩溃监控该管的事。

### 把网络错误跟后端日志关联起来（链路追踪 id）

```ts
import {initErrorMonitor} from '@luhanxin/error-monitor';
import {ApiError} from './api-error'; // 你自己项目里的 HTTP 错误类

initErrorMonitor({
  reporters: [/* ... */],
  extractTraceInfo: reason =>
    reason instanceof ApiError ? {traceId: reason.traceId, extra: {httpStatus: reason.status}} : undefined
});
```

`extractTraceInfo` 会在 `promise`（未处理的 rejection）与 `manual`（`reportError()`）两类来源生成报告前被调用——它不会对 `fetch`/HTTP 做任何假设，换成什么传输层都能用。

### 手动上报

```ts
import {reportError} from '@luhanxin/error-monitor';

try {
  await doSomethingRisky();
} catch (err) {
  reportError(err, {context: 'checkout-flow'});
}
```

### 生产环境的可靠 HTTP 上报

```ts
import {HttpReporter} from '@luhanxin/error-monitor';

const reporter = new HttpReporter({
  endpoint: 'https://your-backend.example.com/errors',
  getHeaders: () => ({Authorization: `Bearer ${getAccessToken()}`})
});
```

`HttpReporter` 的可靠性从不依赖"赌一次卸载瞬间的传输方式"（不用 `navigator.sendBeacon`，也不单纯依赖 `fetch({keepalive: true})`）。每一条报告在真正尝试发送网络请求*之前*，都会先同步写入一份持久化本地队列——`IndexedDB`，不可用则退化到 `localStorage`，两者都不可用则退化为纯内存队列。投递会在 `pagehide`/`visibilitychange` 时机会性重试，未确认送达的记录会在应用下次启动时再次重试。发送失败只会用 `console.error` 记录，永远不会重新进入上报链路。

如果同一个页面里对接了多个指向不同 endpoint 的 `HttpReporter` 实例，记得给每个实例传入不同的 `storage` 配置，避免互相覆盖对方的本地队列：

```ts
new HttpReporter({
  endpoint: 'https://errors.example.com',
  storage: {dbName: '__errors_queue__', storeName: 'queue', localStorageKey: '__errors_queue__'}
});
```

### 去重与节流

```ts
initErrorMonitor({
  reporters: [/* ... */],
  dedupe: {windowMs: 10_000, maxCountPerWindow: 20},
  throttle: {windowMs: 60_000, maxCount: 50, allowFatal: true}
});
```

两者都可以在运行期间中途调整，不需要重新挂载监听器：

```ts
import {configureErrorMonitorNoiseControl} from '@luhanxin/error-monitor';

configureErrorMonitorNoiseControl({throttle: null}); // 关闭节流
```

### DevTools 调试面板

一个小的悬浮面板，可以按需手动触发每一类采集来源——本地调试接入时很方便。

```tsx
import {ErrorMonitorDevTools} from '@luhanxin/error-monitor/react';

<ErrorMonitorDevTools enabled={import.meta.env.DEV} />;
```

## API 参考

### 核心（`@luhanxin/error-monitor`）

| 导出 | 说明 |
| --- | --- |
| `initErrorMonitor(options)` | 挂载全局监听器，配置 reporters/去重/节流/`extractTraceInfo`。可以重复调用（会重新挂载，不会叠加出多份监听器）。 |
| `setErrorMonitorUser(userId)` | 给之后产出的报告打上 `userId` 标签。传 `undefined` 清空（如退出登录）。 |
| `configureErrorMonitorNoiseControl(options)` | 运行期间中途调整 `dedupe`/`throttle`，不重新挂载监听器。 |
| `reportError(error, extra?, options?)` | 手动上报已经处理过的错误。 |
| `registerNetworkConnection(connection, kind, label?)` | 把一个 `WebSocket`/`EventSource` 实例接入 `network` 来源，返回一个注销函数。 |
| `ConsoleReporter` | 内置的 `Reporter`，把结构化对象打进控制台。 |
| `HttpReporter` | 内置的 `Reporter`，带本地持久化队列（见上文）。 |
| 类型 | `ErrorReport`、`ErrorSource`、`ErrorLevel`、`Reporter`、`BeforeSendHook`、`DedupeOptions`、`ThrottleOptions`、`TraceInfoExtractor`、`NetworkConnectionKind`、`HttpReporterOptions`、`PersistentQueueOptions`、`InitErrorMonitorOptions`、`ReportErrorOptions` |

### React（`@luhanxin/error-monitor/react`）

| 导出 | 说明 |
| --- | --- |
| `ErrorBoundary` | Class 组件，捕获子树渲染/生命周期/构造函数抛出的错误，展示 `fallback`。 |
| `createRootErrorHandlers()` | 返回 `{onUncaughtError, onCaughtError, onRecoverableError}`，直接展开进 `createRoot(container, options)`。 |
| `ErrorMonitorDevTools` | 悬浮调试面板（见上文使用指南）。 |

### Vue（`@luhanxin/error-monitor/vue`）

支持 Vue 3 与 Vue 2.7+（通过 `vue-demi` 桥接）。

| 导出 | 说明 |
| --- | --- |
| `ErrorBoundary` | Composition API 组件，内部包了一层 `onErrorCaptured`，展示 `fallback`。 |
| `createVueErrorHandler()` | 返回一个可以直接赋给 `app.config.errorHandler`（Vue 3）/ `Vue.config.errorHandler`（Vue 2）的函数。 |

## 设计要点

- `network` 有意只覆盖**连接级**的 WebSocket/SSE 失败——不管单条消息错误，也不管 HTTP 状态码/耗时。这条边界是刻意划的：HTTP 失败没被 catch 时本来就会经由 `promise` 来源浮出水面；把"服务故障率"这种运营指标塞进一个为 JS 崩溃设计的协议里，会把"崩溃监控"和"APM"两个不同的关注点搞混。
- 对于会重连的传输层（比如 `y-websocket` 的 `WebsocketProvider`，每次重连都会创建一个全新的原生 `WebSocket`），注册/重新注册的责任在调用方——这个包只认识原生的 `WebSocket`/`EventSource` 实例，不理解任何具体的封装库。
- `HttpReporter` 的可靠性模型有意**不**依赖"选对卸载瞬间的传输 API"——每条报告在尝试任何网络请求之前都已经同步落进持久化存储，一次发送失败/被中断只是"待重试"，不是数据丢失。

## 文档

源码、Issue 以及整个 monorepo 都在 <https://github.com/lhx-space/infra-docs/tree/main/packages/error-monitor>。

## License

MIT © luhanxin
