## Context

`apps/web` 目前对前端运行时错误没有任何统一的捕获机制：React 渲染阶段没有挂 `ErrorBoundary`，任意组件渲染抛错都会导致整页白屏；事件处理函数、`async/await`、静态资源加载失败这些完全绕过 `ErrorBoundary` 的错误来源更是彻底空白。这次要补的是采集侧和协议层，不是接后端接口本身（后端接口还没定，先用 `console.log` 占位跑通协议）。

约束与已有模式：
- Monorepo 用 pnpm workspace；`packages/tiptap-editor` 是现成的参考模式——独立 `tsup` 构建、通过 `package.json` `exports` 字段做子路径导出（如 `/schema`），本轮沿用同一套组织方式
- `apps/web` 用的是 React 19.2，具备 `createRoot(container, {onUncaughtError, onCaughtError, onRecoverableError})` 这组 root 级回调，可以跟 `ErrorBoundary` 互补
- 目前唯一消费方是 `apps/web`；`apps/desktop` 的渲染进程也是 React，是潜在的未来复用方，但本轮不接线

## Goals / Non-Goals

**Goals:**
- 统一捕获 5 类错误来源（渲染错误、全局同步异常、未捕获 Promise rejection、静态资源加载失败、手动上报），收敛成同一套 `ErrorReport` 协议
- `Reporter` 可插拔，本轮提供 `ConsoleReporter`，为后续 `HttpReporter` 预留接入位置（新增实现类即可，不改动采集逻辑）
- 内置基于 fingerprint 的去重/节流，避免同一个错误短时间内反复上报刷屏
- `ErrorBoundary` 组件支持在 App 根部与页面内容区两个粒度接入
- 不引入任何第三方错误监控 SDK（Sentry 等），纯手写

**Non-Goals:**
- 不实现真正的后端上报接口本身，`HttpReporter` 留给接口定义后的独立后续变更
- 不做网络请求/接口失败监控（fetch 5xx/超时属于 APM 范畴，跟 JS 运行时错误是两个关注点）
- 不做用户行为轨迹（breadcrumbs）记录，先把错误本体协议跑起来
- 不接入 `apps/desktop`（包设计上预留了框架无关的复用能力，但本轮只接 `apps/web`）
- 不处理 SSR 场景（项目目前是纯 CSR SPA）
- Vue 子路径**只做到代码落地**，不做浏览器实测：仓库内目前没有任何 Vue 消费方，无法在真实页面里验证 `ErrorBoundary`/`createVueErrorHandler` 的实际效果，验收留到真实 Vue 项目接入时再补跑（见「决策 6」与 `tasks.md` 6.5）

## Decisions

**1. 包结构：`packages/error-monitor`，核心与 React 分离**
- `src/core/`：框架无关的采集与协议（`window.onerror`/`unhandledrejection`/资源错误监听、`ErrorReport`/`Reporter` 类型、去重逻辑、`init`/`reportError`），不依赖 `react`
- `src/react/`：`ErrorBoundary` 组件，通过 `package.json` `exports` 的 `"./react"` 子路径单独导出
- 理由：核心逻辑跟 DOM/`window` 相关但跟 React 无关，拆开才能让未来任意前端技术栈（包括 `apps/desktop`）复用核心采集能力，只是不需要 `ErrorBoundary` 这部分；子路径导出模式已经在 `tiptap-editor`（`/schema`）验证过，风格统一，认知成本低

**2. 5 类错误来源的挂载方式**
| 来源 | 挂载方式 | 备注 |
|---|---|---|
| 全局同步异常 | `window.addEventListener('error', handler)` | 事件处理函数、`setTimeout` 回调等未被 try/catch 接住的错误 |
| 未捕获 Promise rejection | `window.addEventListener('unhandledrejection', handler)` | 覆盖 `async/await` 链路 |
| 静态资源加载失败 | `window.addEventListener('error', handler, true)`（**捕获阶段**）+ 判断 `event.target` 是否为 `HTMLImageElement`/`HTMLScriptElement`/`HTMLLinkElement` | 必须用捕获阶段——资源加载错误不会冒泡到默认（非捕获）阶段的 `window` 监听器 |
| React 渲染错误 | `ErrorBoundary`（`getDerivedStateFromError` + `componentDidCatch`） | 局部化捕获，`fallback` 可自定义 |
| React 19 root 级信号 | `createRoot` 的 `onUncaughtError`/`onCaughtError`/`onRecoverableError` | 跟 `ErrorBoundary` 互补，能区分"被 boundary 接住恢复了"和"完全没人接住"两种严重级别 |
| 手动上报 | 导出的 `reportError(error, extra)` | 业务代码里已经 `catch` 住但仍想留痕的场景 |

所有来源最终都调用同一个内部"上报入口"函数（组装 `ErrorReport` → 去重判断 → 分发给各个 `Reporter`），只是 `source` 字段不同，不是每类来源各写一套分发逻辑。

**3. 去重/节流策略（`DedupeOptions` + `ThrottleOptions`，两道正交的闸门）**

去重（`DedupeOptions`，按 fingerprint 分桶，管"同一个错误重复"）：
- `fingerprint` = `source` + `message` + `stack`/`componentStack` 首行拼接后的简单标识，作为去重 key
- 维护一个内存 `Map<fingerprint, {count, timer}>`：同一个 `fingerprint` 第一次出现立即上报（不丢第一次现场），时间窗口内（`windowMs`，默认 10s，传 `false` 关闭去重）后续重复只计数，窗口结束时补一条"该错误又出现了 N 次"的汇总上报
- `maxCountPerWindow`：计数达到这个值就不等窗口到期，立即结束窗口、发出汇总——避免死循环场景下 `occurrences` 涨到一个没有实际意义的天文数字；提前结束后下一次出现会开启全新窗口重新计数
- `shouldDedupe(report) => boolean`：每条报告分发前都会问一遍这个钩子，返回 `false` 表示这条永远立即放行、不进 fingerprint 分桶——用于"业务上认为每次都要看到"的错误。`reportError(error, extra, {dedupe: false})` 是同一件事在调用点的覆盖入口，优先级比钩子更高（调用点的显式意图最明确）
- Map 设置一个最大跟踪种类上限（如 200 种 `fingerprint`），超出后淘汰最早创建的记录，防止长时间运行的 SPA 页面内存无限增长——只是近似 LRU，不追求精确

全局节流（`ThrottleOptions`，不区分 fingerprint，管"单位时间总吞吐量"）：
- 解决去重完全覆盖不到的场景——短时间内冒出一堆*不同*的错误（比如一次基础设施性故障牵连多条不同代码路径同时报错，各自 fingerprint 不同，去重对此无能为力）
- 固定窗口（跟去重同风格，不是滑动窗口）：窗口内成功放行数达到 `maxCount` 后，后续报告默认丢弃；`allowFatal`（默认 `true`）时 `fatal` 级别仍然放行且不计入丢弃统计——节流阀是防"普通错误洪水"的，不该连带吞掉应用可能已经整体崩溃的最高优先级信号
- 被丢弃不是完全无声：窗口结束时如果这个窗口内确实丢过东西，补一条 `source: 'meta'` 的诊断记录（`ErrorSource` 新增的第 6 类来源，代表 `error-monitor` 自身的内部诊断信息，不是业务错误），带上丢弃数量，避免"降噪降过头、出问题都不知道"
- 不传 `throttle` 等于不启用，是一个需要显式开启的可选能力，默认行为不变（向后兼容）

调用点/钩子豁免只对**去重**生效，不豁免**全局节流**——节流阀是总吞吐量的硬限制，不因为某条报告"业务上不想被去重"就跟着豁免，否则每个调用点都标"我很重要"，节流阀就形同虚设。

运行期间动态调整：`configureErrorMonitorNoiseControl({dedupe?, throttle?})` 独立于 `initErrorMonitor`，可以在应用运行期间中途调整去重/节流策略而不需要重新挂载全局监听器（`initErrorMonitor` 内部会 `detachListeners?.()` 再重新 `attachGlobalListeners()`，代价比单纯换配置大得多，没必要为了改个数字重新走一遍）。`dedupe`/`throttle` 都是整体替换，不做增量合并；`throttle` 传 `null` 显式关闭。

**4. `ErrorBoundary` 双层接入策略**
- `App.tsx` 根部一层：兜底路由/Provider 级别的灾难性错误，`fallback` 是整页级"出错了，点击刷新重试"
- `AppShell.tsx` 内容区（`<main>` 承载的路由 `children`）再包一层：某页面渲染崩溃时只影响该内容区，`Sidebar`/用户菜单仍可用，`fallback` 是"这个页面出错了"+ 返回按钮
- 两层用的是同一个 `ErrorBoundary` 组件，用 `fallback` prop 区分展示，不需要两套实现

**5. `ConsoleReporter` 输出格式**
直接 `console.log` 整个结构化 `ErrorReport` 对象（不拼接成字符串），方便在浏览器控制台展开查看完整字段，也方便对照未来 `HttpReporter` 要传的请求体结构。

**6. Vue 2/3 支持（已落地代码，浏览器实测留待真实 Vue 消费方出现时补跑）**

`error-monitor` 的 `package.json` 指向独立发布的个人工具库（不是只服务这个仓库），所以即使当前 monorepo 里没有 Vue 应用，做 Vue 侧的框架对等覆盖也是合理的。方案已经按下面的设计落地为 `src/vue/` 目录 + `"./vue"` 子路径（见 `tasks.md` 第 6 组），`typecheck`/`build` 均已通过；唯一没做的是浏览器里的实际验证——仓库内没有真实 Vue 页面，等有真实消费方接入时再补跑。

- **组件形态**：跟 `/react` 一致，纯 `.ts` + `h()` 渲染函数，不写 `.vue` 单文件组件——避免给 `tsup` 引入 Vue SFC 编译插件（`unplugin-vue`/`vite-plugin-vue` 之类），构建配置不需要为这一个子路径单独复杂化，产物体量也和 React 那边对等。
- **版本策略**：基于 [`vue-demi`](https://github.com/vueuse/vue-demi) 桥接 Vue 2 与 Vue 3 的 Composition API 差异，用**同一份**源码同时支持两个大版本——`vue-demi` 会在安装时探测宿主实际装的是 Vue 2 还是 Vue 3，运行时把 `onErrorCaptured`/`h`/`defineComponent` 等 API 转发到对应的真实实现，不需要维护两份重复代码、也不需要根据版本条件导出两个包。
  - **已知限制（需要到时候跟真实消费方确认）**：`vue-demi` 依赖 Composition API，Vue 2 端要求 `>=2.7`（2.7 起才内置 Composition API）；更早的纯 Options API 时代的 Vue 2（`<2.7`）不在这套方案的覆盖范围内。如果未来真实接入方用的是 `<2.7`，需要另外补一套基于 `errorCaptured` 组件选项 + `Vue.config.errorHandler` 的 Options API 实现，工作量不大但是两套代码，本轮先假设不需要。
- **组件级捕获**（对应 React 的 `ErrorBoundary`）：`onErrorCaptured((err, instance, info) => {...; return false})`——命中时复用同一个 `dispatch` 入口生成 `ErrorReport`（`source: 'render'`），`info` 这个字符串参数（如 `"render function"`、`"native event handler"`）放进 `extra` 字段留痕；返回 `false` 阻止错误继续向上冒泡到父级 `onErrorCaptured`/全局 `errorHandler`，语义上对应 React `ErrorBoundary` 截断异常传播的效果。fallback 展示逻辑跟 React 版一样交给调用方传入。
- **应用级全局兜底**（对应 React 19 root 的 `onUncaughtError`/`onCaughtError`）：导出一个 `createVueErrorHandler()` 工具函数，生成的函数可以直接赋给 Vue 3 的 `app.config.errorHandler` 或 Vue 2 的 `Vue.config.errorHandler`。**关键差异**：Vue 全局只有这一个 handler，不像 React 19 root 那样天然区分"被某个 boundary 接住恢复了"和"完全没人接住"两种严重级别——这里不强行套 `ErrorLevel` 的 `fatal`/`error` 二分，统一按 `'error'` 处理，具体触发场景（渲染函数/watcher/生命周期等）通过 `info` 参数塞进 `extra` 供排查参考。
- **子路径规划**：`package.json` 新增 `"./vue"` exports 条目（`dist/vue.js` + `dist/vue.d.ts`，跟 `/react` 同构）；`peerDependencies` 新增 `vue: ">=2.7"`（`peerDependenciesMeta` 设为可选，不用 Vue 的项目不受影响）；`vue-demi` 作为普通 `dependencies`（不是 peer——体积很小且版本探测逻辑本身就依赖它内部实现，不适合让消费方自己管理版本）。
- **明确不做的事**：不做路由集成（React 那边"用路由 path 当 `key` 强制重置 `ErrorBoundary`"的技巧，在 Vue Router 场景下需要换成监听 route 变化后调用组件暴露的 reset 方法，属于另一层设计，留到真实接入时再定，不在这轮方案范围内预先假设）。

## Risks / Trade-offs

- [Risk] 全局 `window.onerror`/资源错误监听可能捕获到跟本应用无关的第三方脚本错误（如浏览器插件注入脚本）→ [Mitigation] `init` 支持 `beforeSend` 钩子按需过滤；资源错误/运行时错误默认 `level` 是 `'error'` 不是 `'fatal'`，后续接后端时可按 `level`/`source` 二次过滤
- [Risk] 去重用的内存 `Map` 若错误种类持续变化，理论上会无限增长 → [Mitigation] 设置跟踪种类上限并做近似 LRU 淘汰
- [Risk] `onCaughtError`/`onUncaughtError` 是 React 19 才有的相对新 API，后续版本行为可能调整 → [Mitigation] 这两个回调只是"多一路信号"，即使行为变化，`ErrorBoundary` 仍独立工作，不是单点依赖
- [Risk] `ConsoleReporter` 目前生产构建也会把内部堆栈信息打进控制台，可能暴露给最终用户 → [Mitigation] 本轮明确这是过渡占位方案，接 `HttpReporter` 时应同步评估是否要在生产环境移除/降级 `ConsoleReporter`（见下方 Open Questions）
- [Risk，已实测踩到并修复] 多入口（`index.ts`/`react.ts`/`vue.ts`）tsup 构建如果用 `splitting: false`，`core/dispatch.ts` 的模块级状态（`reporters`/`deduper`）会在三份产物里各自独立一份——`initErrorMonitor` 只配置了其中一份，导致 `ErrorBoundary`/`DevTools`/root 级回调触发的上报全部静默丢失、且没有任何报错提示，非常隐蔽 → [Mitigation] `tsup.config.ts` 改为 `splitting: true`，`core/*` 被提取成三个入口共享的 chunk；这是构建配置的硬约束，后续新增入口/改动这个配置时要留意别再关掉 `splitting`

## Migration Plan

不涉及数据迁移，纯前端新增代码：
1. 新建并发布 `packages/error-monitor`（workspace 内直接引用，不需要发 npm）
2. `apps/web` 接入三处：`main.tsx`（`initErrorMonitor` + `createRoot` 的 root 回调）、`App.tsx`（根部 `ErrorBoundary`）、`AppShell.tsx`（内容区 `ErrorBoundary`）
3. 本地/预发观察 `console` 输出是否符合协议预期，确认字段完整后再评估接后端接口

回滚：只需还原 `apps/web` 的这三处接入点（不调用 `initErrorMonitor`、不套 `ErrorBoundary`），不影响其他任何现有功能，风险极低。

## Open Questions

- `ConsoleReporter` 在生产构建中是否需要移除/降级：留到接 `HttpReporter` 的后续变更里一并决定，本轮先保留
- `userId` 怎么塞进 `ErrorReport`：是否需要提供一个运行时 `setUser(userId)` 之类的 setter，等 `apps/web` 接入时结合鉴权 store 结构再定，不阻塞这轮核心能力落地
- Vue 子路径是否需要支持 `<2.7` 的纯 Options API 版本：见「决策 6」，等出现真实 Vue 消费方、确认其 Vue 版本后再决定是否要补一套 Options API 实现
- Vue 子路径实际排期：等仓库内（或 `lhx-kit` 的其他消费方）出现真实 Vue 项目时，作为独立的后续变更实现并验证，不追加到本轮 `tasks.md`
