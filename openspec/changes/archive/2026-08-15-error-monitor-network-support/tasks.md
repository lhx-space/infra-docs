## 1. `error-monitor` 核心——类型与协议扩展

- [x] 1.1 `src/core/types.ts`：`ErrorSource` 新增 `'network'`；`ErrorReport` 新增可选字段 `traceId?: string`
- [x] 1.2 `src/core/types.ts`：新增导出 `TraceInfoExtractor` 类型（`(reason: unknown) => {traceId?: string; extra?: Record<string, unknown>} | undefined`）
- [x] 1.3 `src/core/types.ts`：新增 `network` 来源专用的连接分类类型（`'websocket' | 'sse'`），供采集函数与 `ErrorReport.extra` 使用

## 2. `error-monitor` 核心——WebSocket/SSE 连接级失败采集

- [x] 2.1 新建 `src/core/network-listeners.ts`：导出注册函数（如 `registerNetworkConnection`），接收 `WebSocket`/`EventSource` 实例 + 分类标识 + 可选标签，返回一个注销函数
- [x] 2.2 `WebSocket` 场景：监听 `error` 事件与非正常状态码（`1006` 等，非 `1000`/主动 `close()` 触发的关闭）的 `close` 事件，生成 `source: 'network'` 报告
- [x] 2.3 `EventSource` 场景：监听 `error` 事件，生成 `source: 'network'` 报告
- [x] 2.4 验证：注销函数调用后，原实例后续的错误/关闭不再产生报告；未注册的实例完全不受影响
- [x] 2.5 验证：主动正常关闭（状态码 `1000`）不产生报告

## 3. `error-monitor` 核心——链路追踪 id 提取

- [x] 3.1 `src/core/dispatch.ts`：`ConfigureDispatchOptions` 新增 `extractTraceInfo?: TraceInfoExtractor`，存入模块状态；新增导出的 getter 供 `listeners.ts`/`report-error.ts` 读取
- [x] 3.2 `src/core/init.ts`：`InitErrorMonitorOptions` 新增 `extractTraceInfo` 字段并透传给 `configureDispatch`
- [x] 3.3 `src/core/listeners.ts`：`handleUnhandledRejection` 调用已配置的 `extractTraceInfo(event.reason)`，命中时把 `traceId`/`extra` 合并进 `dispatchError` 的入参
- [x] 3.4 `src/core/report-error.ts`：`reportError` 同样接入 3.3 的提取逻辑，作用于传入的 `error` 参数
- [x] 3.5 验证：`extractTraceInfo` 返回 `undefined` 时报告不携带 `traceId`；未配置该钩子时行为与改动前完全一致

## 4. `error-monitor` 核心——`HttpReporter`

- [x] 4.1 新建 `src/core/http-reporter.ts`：`HttpReporter` 类，构造参数至少包含 `endpoint`，可选自定义 headers 获取函数（供鉴权场景使用）
- [x] 4.2 `report()` 实现：`fetch(endpoint, {method: 'POST', headers, body: JSON.stringify(report), keepalive: true})`，不引入 `navigator.sendBeacon`
- [x] 4.3 发送失败（`fetch` 抛出异常或非 2xx）时仅 `console.error` 记录，不调用任何会重新触发 `dispatchError` 的路径
- [x] 4.4 验证：`HttpReporter` 与 `ConsoleReporter` 可以同时注册，互不影响，其中一个失败不影响另一个正常收到报告

## 5. `error-monitor`——统一导出

- [x] 5.1 `src/index.ts` 补充导出：`TraceInfoExtractor`、`HttpReporter`、`registerNetworkConnection`（及其他 2.1 新增的公开符号）
- [x] 5.2 确认 `tsup.config.ts` 的 `splitting: true` 仍然生效（见上一轮 design.md 决策记录的真实 bug），新增模块不引入第二份 `core/dispatch` 状态

## 6. `apps/api`——响应头透传链路追踪 id

- [x] 6.1 `src/app.ts`：在 `app.use(pinoHttp({logger}))` 之后新增中间件，`res.setHeader('x-trace-id', req.id)`
- [x] 6.2 验证：任意接口（包括返回非 2xx 的场景，如未登录访问受保护路由）响应头都带有 `x-trace-id`，且值与该请求对应的服务端日志行 `req.id` 一致

## 7. `apps/web`——接入链路追踪 id

- [x] 7.1 `src/network/errors.ts`：`ApiError` 新增只读字段 `traceId?: string`，构造函数新增对应参数
- [x] 7.2 `src/network/client.ts`：`rawRequest` 从 `response.headers.get('x-trace-id')` 读取，构造 `ApiError` 时传入
- [x] 7.3 `src/main.tsx`：`initErrorMonitor` 新增 `extractTraceInfo: (reason) => reason instanceof ApiError ? {traceId: reason.traceId, extra: {httpStatus: reason.status}} : undefined`

## 8. 收尾验证

- [x] 8.1 `packages/error-monitor`：`pnpm typecheck`/`pnpm build` 通过
- [x] 8.2 `apps/api`/`apps/web`：`tsc --noEmit` 通过，`biome check` 通过
- [x] 8.3 浏览器验证：手动断开一次真实的协同 WebSocket 连接，确认 `network` 来源报告通过 `ConsoleReporter` 正常输出
- [x] 8.4 浏览器验证：手动触发一次 `ApiError`（如未带 token 访问受保护接口），确认对应报告携带的 `traceId` 与该请求在 `apps/api` 日志里的 `req.id` 一致
- [x] 8.5 更新 `apps/web/src/hooks/use-document-collaboration.ts`：在合适的位置调用 `registerNetworkConnection`，把实际的协同连接接入这次新增的 `network` 来源（验证端到端可用，不只是包本身的单元验证）
