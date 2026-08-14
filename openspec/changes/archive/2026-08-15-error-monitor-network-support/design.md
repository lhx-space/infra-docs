## Context

`packages/error-monitor` 是一个框架无关的核心 + React/Vue 子路径的通用错误监控工具库（不是只服务这个仓库，见上一轮 `2026-08-13-error-monitor` design.md 决策 6 的定位）。当前已落地的能力：

- 5 类错误来源：`render`/`runtime`/`promise`/`resource`/`manual`，外加内部诊断用的 `meta`
- 统一的 `ErrorReport` 协议 + 基于 fingerprint 的去重/节流
- 唯一内置的 `Reporter` 是 `ConsoleReporter`（`console.log` 占位，`HttpReporter` 当时被有意延后到"接口定义之后"）

排查一次 `apps/collab-server` WebSocket 连接问题时发现的两个真实缺口（详见 proposal.md「Why」），加上 `apps/api` 已经用 `pino-http` 生成了每请求的 `req.id` 却从未回传给前端，构成了本轮要补的三块能力：网络连接失败采集、链路追踪 id 关联、`HttpReporter` 上报出口。

约束：
- 上一轮 `design.md` 明确把"HTTP 请求/接口失败监控"划为 Non-Goal（"属于 APM 范畴，跟 JS 运行时错误是两个关注点"）——本轮**不推翻**这条边界，只解决 HTTP 失败之外的、真正无处可去的信号（WS/SSE 连接失败）
- `error-monitor` 核心不能引入任何具体网络库/框架依赖（跟 `react`/`vue` 分离的原则一致），trace id 的提取逻辑必须是消费方自己实现的可插拔回调，不能让核心包认识"HTTP 响应头"这种具体概念

## Goals / Non-Goals

**Goals:**
- 新增 `network` 错误来源，捕获 `WebSocket`/`EventSource` 的**连接级**失败（建连失败、异常关闭、反复重连不成功）
- `ErrorReport` 新增一等字段 `traceId`；新增可插拔的 `extractTraceInfo` 配置钩子，在 `promise`/`manual` 两类来源接入
- `apps/api` 把已有的 `pino-http` `req.id` 通过响应头回传给前端，作为 `traceId` 的数据来源
- `apps/web` 的 `ApiError` 携带 `traceId`，并通过 `extractTraceInfo` 接入 `error-monitor`
- 新增 `HttpReporter`：endpoint 可配置；内部以本地持久化队列（`IndexedDB`/`localStorage`）为可靠性主干，`fetch`（含机会性的 `keepalive`）只是队列的消费方式，不是可靠性的唯一保障（见决策 6）

**Non-Goals:**
- 不做 HTTP 请求/接口失败的通用监控（状态码分布、耗时统计等）——继续维持上一轮的边界，`ApiError` 没被 catch 时本来就会被现有的 `unhandledrejection`（`promise` 来源）捕获，不存在盲区
- 不做 WS/SSE **消息级**错误采集（比如某一条消息解析失败），只关心连接本身建立/维持失败——消息级错误属于业务逻辑该自己处理和留痕（用现有的 `manual` 上报）的范畴，不是"逃逸出常规处理路径"的信号
- 本轮不建立真实的后端错误上报接收接口（`apps/api` 新增数据表/路由用于落库错误报告）——`HttpReporter` 提供能力，但沿用 `ConsoleReporter` 当年的策略：协议先跑通，真实接口定义后再独立接入，本轮 `apps/web/main.tsx` 不实例化启用它
- 不做"自动探测页面里所有 WebSocket/EventSource 实例"的黑魔法——采集入口是消费方显式注册，跟全局 `window.onerror` 那种自动生效的机制不是一回事（原因见下方决策 4）

## Decisions

**1. `network` 来源只做连接级失败，不做消息级、不做 HTTP 状态码——维持跟 APM 的边界**

WS/SSE 的连接失败（`onerror`/异常 `onclose`）跟 HTTP fetch 失败的本质区别：HTTP 失败最终必然变成一个 JS 异常/rejected Promise，业务代码不 catch 的话本来就会被现有 `unhandledrejection` 捕到，不存在监控盲区，继续排除在外是对的；WS/SSE 连接失败是纯事件回调，从设计上就不会流入任何 JS 异常处理路径，是真正意义上"没有任何现有机制能接住"的信号，这是本轮新增来源的唯一站得住的理由——**如果以后有人想拿这个来源顺带监控"每一条 WS 消息处理失败"或者"HTTP 5xx 比例"，都应该拒绝，那是往 APM 方向滑，会重新引入协议语义混乱的老问题**（一个为"JS 崩溃"设计的去重/节流协议，不适合承载"服务端故障率"这种运营指标）。

**2. trace id 提取用可插拔回调（`extractTraceInfo`），不是让核心包认识"响应头"**

`error-monitor` 核心不能依赖任何具体网络库——它甚至不知道消费方是用 `fetch` 还是 `axios` 还是别的。所以设计成一个纯函数回调，输入是 `unhandledrejection`/`reportError` 拿到的原始 `unknown` 值，输出是 `{traceId?, extra?} | undefined`：

```ts
export type TraceInfoExtractor = (reason: unknown) =>
  {traceId?: string; extra?: Record<string, unknown>} | undefined;
```

"是不是网络错误"和"怎么提取"合并成一个函数（不是拆成 `isNetworkError` + `extract` 两个回调）——因为这两步在所有实际场景里永远是配对使用的，拆开只会让消费方多写一层判断，没有换来任何灵活性。`apps/web` 的具体实现是 `reason instanceof ApiError ? {traceId: reason.traceId, extra: {httpStatus: reason.status}} : undefined`，这行代码留在 `apps/web` 里，`error-monitor` 全程不 import 任何跟 `ApiError`/HTTP 相关的东西。

**3. `traceId` 提升为 `ErrorReport` 一等字段，不塞进 `extra`**

跟 `componentStack`（只有 `render` 来源有意义，但仍然是顶层字段）是同一个道理：这是"可追溯性"这个核心目的的字段，值得被任何未来的 `Reporter`/排查后台直接索引查询，不该被埋在一个弱类型的 `extra` 里让每个消费者各自约定 key 名。

**4. `promise` 与 `manual` 两个来源都接入 trace 提取，`runtime`/`resource`/`render` 不接入**

业务代码 `catch` 住 `ApiError` 后手动 `reportError(err)`，跟没 catch 直接变成 `unhandledrejection`，走的是同一种"外部注入的 unknown 错误值"路径，理应共享同一份提取逻辑，否则消费方在手动上报的调用点还要自己重复拼一遍 `extra: {traceId: ...}`。`runtime`（全局同步异常）、`resource`（资源加载失败）、`render`（React 渲染错误）这三类来源的错误本质上是"代码逻辑 bug"或"资源不可达"，跟"这次网络请求"没有天然关联，即使凑巧传进来的 `event.error`/组件抛出的 error 恰好是一个 `ApiError`（比如渲染函数里直接同步 `throw` 了一个刚拿到的网络错误），也不值得为这种边缘场景在三处都重复接入同一份判断逻辑——真正的网络错误绝大多数场景都是通过 `await` 链路以 Promise 形式出现的。

**5. `apps/api` 透传 `pino-http` 现成的 `req.id`，不新建一套 trace id 生成逻辑**

`app.ts` 里已经 `app.use(pinoHttp({logger}))`，`pino-http` 内置的 `genReqId` 早就给每个请求生成了一个 id 并写进了每一条服务端结构化日志——这本身就是"能跟后端日志精确关联"的理想 trace id，不需要另起一套（比如自己生成 UUID 塞进 `res.locals`），只需要在 `pinoHttp` 中间件之后加一行 `res.setHeader('x-trace-id', req.id)` 把这个已经存在的值回传给客户端。响应头名固定用 `x-trace-id`（`apps/web` 侧硬编码读取这一个头即可——`apps/web` 只对接自己控制的这一个后端，不需要做成运行时可配置；真正需要可配置的是 `error-monitor` 那一侧"怎么从错误对象里挖 `traceId`"这个逻辑，两者不是同一层）。

**6. `HttpReporter` 的可靠性不靠"选对卸载瞬间的传输 API"，靠本地持久化队列 + 下次启动补发**

最初讨论方向依次是"正常路径 `fetch`、卸载那一刻切 `navigator.sendBeacon`"→"全程只用 `fetch({keepalive: true})`"，复盘两轮后放弃了"靠某个单一传输 API 保证送达"这个前提，改成**持久化优先、传输方式只是次要优化**的设计：

- 错误报告产生后**立即同步写入本地持久化队列**（`IndexedDB` 为主，`localStorage` 兜底给 `IndexedDB` 不可用的场景），这一步跟"页面还能活多久""要不要发网络请求"完全无关，是流水线里最先做、最快落地的一步
- 正常情况下（页面存活）用普通 `fetch` 尝试投递，成功即把该条从队列删除；失败则留在队列，等下一次触发再重试
- 页面隐藏/卸载时（监听 `pagehide`/`visibilitychange: hidden`，不用已经不可靠的 `unload`），机会性地尝试一次 `fetch({keepalive: true})`——**这只是"能发就发"的优化，不是正确性依赖的关键路径**，失败了也无所谓
- 真正的兜底在**应用下一次启动时**：读一遍本地队列，把上次没确认送达的报告重新尝试上报（设置数量上限与过期时间，避免长期离线导致队列无限增长）

这个转向的直接原因是：无论选 `sendBeacon` 还是 `fetch keepalive`，它们解决的都是同一类问题（"卸载那一刻尽量把请求送出去"），也共享同一类无法回避的失效模式——选择哪一个只是在两种"一次性赌一把"的方案之间挑，赌注本身的风险没有变。持久化队列把"发出去"和"发成功"解耦，让传输层的选择从"必须押对"降级为"押不中也无所谓"，详细的失效模式分析见下方 Risks / Trade-offs。

`HttpReporter.report()` 因此拆成两层：`enqueue()`（同步写本地队列，永不失败——即使写入 `IndexedDB` 失败，也退化为内存队列，接受这种边缘场景下的丢失风险）+ `flush()`（消费队列，实际发网络请求），比"一个方法里塞两条分支路径"的写法责任更清晰，也更容易分别测试。

**7. `HttpReporter` 的 endpoint 由消费方配置，包本身不内置任何具体后端地址**

跟 `ConsoleReporter` 不需要任何配置形成对比——`HttpReporter` 必然需要知道往哪儿发，这个地址是应用特定的，`error-monitor` 保持"通用工具库"定位，不能假设消费方的后端路由结构。

## Risks / Trade-offs

- [Risk] **数据包大小限制**：`fetch keepalive` 与 `navigator.sendBeacon` 在 Chromium 里共享同一个约 64KB 的总配额（同一时刻所有 pending 的 keepalive 请求体之和，超出直接同步失败/拒绝排队），选哪个 API 都逃不掉这个上限 → [Mitigation] 这个限制只影响"卸载那一刻的机会性 flush"这一次尝试，不影响正确性——错误报告本身是很小的结构化 JSON，且已有的去重/节流机制本身就在控制单位时间内的报告条数；即使这次机会性 flush 因为超限直接失败，数据早已经在持久化队列里，下次启动时正常走非 keepalive 的 `fetch` 补发，不受这个配额约束（那时不再是"卸载瞬间"，可以正常分批发送）
- [Risk] **浏览器兼容性坑（尤其 Safari）**：Safari（历史版本，尤其 iOS Safari）在 `unload`/`beforeunload` 事件里触发的 `fetch keepalive` 有已知的不可靠记录——请求经常被直接静默丢弃，不抛错也不触发任何回调，这跟"选 `sendBeacon` 还是 `fetch keepalive`"无关，是同一类"页面即将消失那一刻搞事情"的操作在该浏览器下的通病 → [Mitigation] 两层：① 用 `pagehide`/`visibilitychange: hidden` 代替已经被规范标注为不可靠、且各浏览器行为不一致的 `unload`，这是不依赖具体传输 API 的通用最佳实践；② 更根本的是，这次尝试即使在某个 Safari 版本上原地失效，报告已经落在持久化队列里，用户下次打开应用时会被正常读出补发——**兼容性坑不需要被"修复"，只需要被"兜底"**，因为想枚举清楚所有浏览器在所有版本下这一刻的行为组合本身就是个无底洞
- [Risk] **移动端 Hybrid 容器强制杀进程**：如果 WebView/Hybrid 容器所在的进程被系统直接杀死（不是"页面正在关闭、JS 还能跑一下"，而是执行上下文瞬间消失，常见于 iOS 后台应用被系统回收、用户强制退出 App），**没有任何浏览器 API 能补救**——`sendBeacon`、`keepalive fetch`，包括未来任何新 API，都要求"至少还有机会执行这行 JS"，强杀那一刻连这个前提都不成立 → [Mitigation] 这不是"选对技术方案就能解决"的问题，是所有客户端上报方案的物理下限，能做的唯一事情是**缩小暴露窗口**：把"错误发生"到"数据落地到持久化存储"之间的路径做到最短（同步写入，不等待任何网络往返、不做额外的批量攒批延迟），把真正有风险的窗口从"从捕获错误到网络请求成功"（可能是几百毫秒到几秒，取决于网络状况）压缩到"从捕获错误到一次本地同步写操作完成"（通常个位数毫秒）。这个窗口没法压缩到零，但两者不是同一个量级的风险敞口，这是"能平衡"和"平衡不了"的真实边界——**能平衡的是"数据有没有落地"，平衡不了的是"落地这个动作本身需要的最后几毫秒执行时间"**
- [Risk] `IndexedDB` 本身在部分场景下不可用或受限（historically 比如 Safari 隐私浏览模式对 `IndexedDB` 有过额度/持久性限制）→ [Mitigation] 退化到 `localStorage`（结构更简单，但同样跨刷新持久）；两者都不可用的极端场景（罕见），退化为纯内存队列，只在当前这次页面生命周期内有效——这一层丢失风险是显式接受的，因为对应场景本身就没有任何持久化能力可用，跟前一条"物理下限"是同一类不可平衡的情况，不重复设计兜底
- [Risk] `HttpReporter` 自身的上报请求如果失败（比如后端错误上报接口本身也挂了），不能再次触发一轮错误上报，否则会自我循环 → [Mitigation] 复用 `dispatch.ts` 里 `send()` 已有的隔离原则——`Reporter.report()`/队列消费逻辑内部的失败直接 `catch` 掉打印 `console.error`，不允许再走回 `dispatchError`；网络失败时报告留在队列里等待重试，不是"失败了就丢弃"
- [Risk] `network` 来源的采集入口是显式注册（消费方需要拿到 `WebSocket`/`EventSource` 实例后手动调用注册函数），不像全局错误那样"引入就自动生效"，容易被忽略而实际上没接上 → [Mitigation] 这是有意的设计（见 Non-Goals 最后一条，不做自动探测），但需要在包的文档/类型签名层面让这个注册函数足够显眼，且返回一个注销函数，跟其余 hook 化的清理约定保持一致，降低"忘记调用"的概率（后续可以考虑给 `apps/web` 里的 `useDocumentCollaboration` 补一个实际调用示例）
- [Risk] `apps/api` 的 `req.id` 目前用的是 `pino-http` 内置的默认生成算法，如果未来要跟外部系统（网关/CDN）的 trace id 体系打通，可能需要改成接受上游传入的 trace id 而不是自己生成 → [Mitigation] 本轮不动生成算法，只是把已经存在的值透传出去，后续如果要改成"识别上游 header 优先复用"是纯增量修改，不影响本轮的响应头契约

## Migration Plan

不涉及数据迁移，且大部分改动都是新增可选能力，向后兼容：

1. `packages/error-monitor`：新增 `network` 来源采集函数、`traceId`/`TraceInfoExtractor` 类型、`extractTraceInfo` 配置项、`HttpReporter` 类——全部是新增导出，不修改任何已有函数签名的必填参数
2. `apps/api/src/app.ts`：新增一行响应头中间件，不改变任何现有响应体结构
3. `apps/web`：`ApiError` 新增可选字段、`client.ts` 读取响应头、`main.tsx` 接入 `extractTraceInfo`（`HttpReporter` 本轮不实例化启用，见 Non-Goals）
4. 本地/预发验证：手动断开协同 WebSocket 连接，确认 `network` 来源报告能通过 `ConsoleReporter` 正常输出并带有合理的 `extra`；手动触发一次 `ApiError`（比如未登录访问受保护接口），确认对应报告带有 `traceId` 且跟后端同一请求的日志行 `req.id` 一致

回滚：三处改动都是纯增量，不调用新增的注册函数/不配置 `extractTraceInfo`，行为与本轮改动前完全一致；`apps/api` 的响应头即使回滚也不影响任何已有客户端行为（未读取这个头的客户端完全无感）。

## Open Questions

- `network` 来源的注册 API 除了 `WebSocket`/`EventSource` 原生实例，是否需要专门理解 `y-websocket` 的 `WebsocketProvider` 这种封装对象（`apps/web` 实际用的是它，不是裸 `WebSocket`）——倾向于只认原生 `WebSocket`/`EventSource`，`WebsocketProvider` 暴露了 `.ws`（内部原生实例，会随重连变化），接入方式留到 tasks 阶段具体实现时确认是否要在每次重连时重新注册
- `HttpReporter` 真正接后端接口是独立的后续变更，届时需要决定：错误报告要不要落库、要不要做管理后台查询——不在本轮范围
