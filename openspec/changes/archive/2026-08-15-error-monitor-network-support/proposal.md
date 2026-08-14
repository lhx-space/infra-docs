## Why

`packages/error-monitor` 目前只覆盖 5 类"逃逸出常规错误处理路径"的前端错误来源（渲染错误、全局同步异常、未捕获 Promise rejection、静态资源加载失败、手动上报），`design.md`（`2026-08-13-error-monitor`）当时明确把"网络请求监控"划为 Non-Goal（"fetch 5xx/超时属于 APM 范畴"）。但排查过程中发现两个真实盲区不该继续留白：

1. `WebSocket`/`EventSource`（SSE）的 `onerror`/`onclose` 是纯事件回调，天生不会冒泡到 `window.onerror`，也不会变成 `unhandledrejection`——现有 5 类来源里没有任何一个能接住它。以 `apps/web` 的实时协同连接为例：`apps/collab-server` 持续连不上时，除了 UI 上一个"连接异常"徽章，`error-monitor` 完全看不到，运维/排查毫无感知。这跟当初划掉的"HTTP fetch 5xx"不是一回事——HTTP 失败最终会变成一个 `Promise` rejection，没被 `catch` 的话本来就会被现有的 `unhandledrejection` 监听器捕到；WS/SSE 的失败是真正意义上"没有任何现有机制能接住"的盲区。
2. 即使被现有 `promise`/`manual` 来源捕获到的网络类错误（比如 `ApiError`），报告里也没有能跟后端日志对上号的信息——`apps/api` 其实已经用 `pino-http` 给每个请求生成了 `req.id` 并写进了服务端日志，只是从未回传给前端，导致前端错误报告和后端日志是两套互相找不到彼此的记录，排查时只能靠时间戳硬凑。
3. `error-monitor` 目前没有任何网络类上报出口（`Reporter`）——`ConsoleReporter` 是过渡占位方案，`HttpReporter` 在上一轮被有意延后到"接口定义之后"，现在需要真正补上，并且要一并解决"上报请求本身在页面卸载时容易被浏览器中断"的可靠性问题。

## What Changes

- 新增 `error-monitor` 的第 6 类错误来源 `network`：监听 `WebSocket`/`EventSource` 的连接级失败（建连失败、异常关闭码、反复重连不成功），不采集"每一条消息级错误"、不做 HTTP 状态码统计（明确保留原有"不做 HTTP 请求/接口失败监控"的边界，避免跟 APM 重新混在一起）
- `ErrorReport` 新增一等字段 `traceId`；新增可插拔的 `extractTraceInfo` 配置钩子（消费方自己判断一个 rejection/手动上报的原始值是不是网络错误、以及怎么从里面挖出 `traceId`），在 `promise` 与 `manual` 两类来源接入这个钩子
- `apps/api` 补一个响应头中间件，把 `pino-http` 已经生成的 `req.id` 通过 `x-trace-id` 响应头回传给前端，作为前后端日志关联的唯一 id 来源
- `apps/web` 的 `ApiError` 新增 `traceId` 字段（从响应头读取），`main.tsx` 接入 `extractTraceInfo` 把 `ApiError` 识别成网络错误并提取 `traceId`
- 新增 `HttpReporter`：endpoint 由消费方配置（包本身不内置任何具体后端地址）；统一用 `fetch(url, {..., keepalive: true})` 发送，不引入 `navigator.sendBeacon`——`keepalive` 能同时满足"页面卸载时请求也不会被中断"和"能带自定义鉴权 header"两个需求，是比"正常路径 fetch、卸载路径切 sendBeacon"更简单、更少特殊分支的统一方案（详见 design.md 决策部分）

## Capabilities

### New Capabilities

（本次不新增独立 capability，均落在已有的 `error-monitor` capability 内）

### Modified Capabilities

- `error-monitor`：新增网络连接失败来源（`network`）、错误报告的链路追踪字段与提取钩子、`apps/api` 侧的追踪 id 响应头契约、`HttpReporter` 上报出口

## Impact

- `packages/error-monitor/src/core/`：`types.ts`（新增 `ErrorSource: 'network'`、`ErrorReport.traceId`、`TraceInfoExtractor` 类型）、`listeners.ts`（新增 WS/SSE 连接失败监听、`promise` 来源接入 trace 提取）、`report-error.ts`（`manual` 来源接入 trace 提取）、`dispatch.ts`/`init.ts`（新增 `extractTraceInfo` 配置项与存取）、新增 `http-reporter.ts`
- `packages/error-monitor/src/index.ts`：补充导出新增的类型与 `HttpReporter`
- `apps/api/src/app.ts`：新增响应头中间件
- `apps/web/src/network/errors.ts`：`ApiError` 新增 `traceId` 字段
- `apps/web/src/network/client.ts`：读取 `x-trace-id` 响应头
- `apps/web/src/main.tsx`：接入 `extractTraceInfo` 配置（`HttpReporter` 是否在这一轮实际启用取决于是否已有真实后端接口，见 design.md Open Questions）
- 不涉及数据库迁移；`apps/api` 只新增一个响应头，不改变任何现有响应体结构，向后兼容
