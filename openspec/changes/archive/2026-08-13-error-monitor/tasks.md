## 1. `packages/error-monitor` 包脚手架

- [x] 1.1 新建 `packages/error-monitor/package.json`：`name: "@luhanxin/error-monitor"`，`type: "module"`，`exports` 字段包含 `"."`（核心）与 `"./react"`（React 子路径），参考 `packages/tiptap-editor/package.json` 的组织方式；`peerDependencies` 里 `react`/`react-dom` 设为可选（核心逻辑不依赖 React）
- [x] 1.2 新建 `tsconfig.json`（继承 `@lhx-kit/tsconfig`）与 `tsup.config.ts`（`entry: ['src/index.ts', 'src/react.ts']`，ESM-only，`dts: true`）
- [x] 1.3 新建 `src/core/types.ts`：定义 `ErrorSource`（`'render' | 'runtime' | 'promise' | 'resource' | 'manual'`）、`ErrorLevel`（`'fatal' | 'error' | 'warning'`）、`ErrorReport`、`Reporter` 接口（见 design.md 决策 3）

## 2. 核心采集逻辑（框架无关）

- [x] 2.1 `src/core/dispatch.ts`：内部统一的"上报入口"函数——组装 `ErrorReport`（补全 `id`/`timestamp`/`url`/`userAgent` 等公共字段）→ 去重判断 → 依次分发给已注册的 `Reporter`；单个 `Reporter` 抛异常要 `try/catch` 隔离，不影响其他 `Reporter`
- [x] 2.2 `src/core/dedupe.ts`：按 `message` + 堆栈首行生成 fingerprint 的去重/节流实现（见 design.md 决策 3）——内存 `Map<fingerprint, {count, timer}>`，窗口内第一次立即放行、窗口结束时补一条汇总记录；`dedupWindowMs` 可配置，传 `false` 关闭；`Map` 设跟踪种类上限做近似 LRU 淘汰
- [x] 2.3 `src/core/listeners.ts`：`window.addEventListener('error', ...)` 捕获全局同步异常（`source: 'runtime'`）
- [x] 2.4 同一文件补充 `window.addEventListener('unhandledrejection', ...)` 捕获未处理的 Promise rejection（`source: 'promise'`）
- [x] 2.5 同一文件补充捕获阶段的资源加载失败监听（`window.addEventListener('error', handler, true)`，判断 `event.target` 是否为 `HTMLImageElement`/`HTMLScriptElement`/`HTMLLinkElement`，`source: 'resource'`）
- [x] 2.6 `src/core/init.ts`：导出 `initErrorMonitor(options)`——挂载 2.3~2.5 的全局监听器，接收 `reporters`/`beforeSend`/`dedupWindowMs`/`appName`/`appVersion` 等初始化配置；`beforeSend` 钩子在分发前对报告做过滤（返回空值则丢弃，见 spec「上报前的自定义过滤钩子」）
- [x] 2.7 `src/core/report-error.ts`：导出手动上报函数 `reportError(error, extra?)`，生成 `source: 'manual'` 的报告并复用 2.1 的分发入口
- [x] 2.8 `src/core/console-reporter.ts`：内置 `ConsoleReporter`，`report()` 直接 `console.log` 整个结构化 `ErrorReport` 对象
- [x] 2.9 `src/index.ts`：核心入口统一导出 `initErrorMonitor`/`reportError`/`ConsoleReporter`/`Reporter`/`ErrorReport` 等类型与函数

## 3. React 子路径

- [x] 3.1 `src/react/ErrorBoundary.tsx`：class 组件，`getDerivedStateFromError` + `componentDidCatch` 捕获子树渲染错误，生成 `source: 'render'`、包含 `componentStack` 的报告并复用 2.1 的分发入口；`fallback` 支持传入 `ReactNode` 或 `(error) => ReactNode` 渲染函数
- [x] 3.2 `src/react/root-error-handlers.ts`：导出一个工具函数，生成可直接传给 `createRoot(container, {...})` 的 `onUncaughtError`/`onCaughtError`/`onRecoverableError` 三个回调——`onCaughtError` 生成 `level: 'error'`，`onUncaughtError` 生成 `level: 'fatal'`，都复用 2.1 的分发入口（见 design.md 决策 4）
- [x] 3.3 `src/react.ts`：React 子路径统一导出 `ErrorBoundary`、`createRootErrorHandlers`（3.2 的工具函数）
- [x] 3.4 `package.json` `exports["./react"]` 指向 `src/react.ts` 构建产物
- [x] 3.5 `src/react/DevTools.tsx`：导出 `ErrorMonitorDevTools` 组件——类似 Next.js 开发环境右下角的调试指示器，常驻一个圆形悬浮按钮，点击展开面板可手动触发本包覆盖的每一类错误来源（runtime/promise/resource/render/manual/连续重复）；纯内联 `style` 实现，不依赖宿主的样式方案；`enabled` prop 默认 `true`，是否只在开发环境挂载由消费方自己决定（如 `{import.meta.env.DEV && <ErrorMonitorDevTools />}`），包本身不假设具体构建工具。这是包的正式能力（供任何消费方接入后自检），不是这个仓库的一次性测试代码

## 4. `apps/web` 接入

- [x] 4.1 `apps/web/package.json` 新增 `@luhanxin/error-monitor` workspace 依赖
- [x] 4.2 `apps/web/src/main.tsx`：调用 `initErrorMonitor({reporters: [new ConsoleReporter()], appName: 'web', ...})`；`createRoot` 调用补充 `onUncaughtError`/`onCaughtError`/`onRecoverableError`（用 3.2 的工具函数生成）
- [x] 4.3 `apps/web/src/App.tsx`：最外层包一层 `ErrorBoundary`，`fallback` 为整页级"出错了，点击刷新重试"兜底 UI（见 design.md 决策 4）；另外用独立的一层 `ErrorBoundary`（`fallback` 为 `null`）单独包裹仅开发环境挂载的 `ErrorMonitorDevTools`，跟保护应用主体的那层完全隔离——devtools 面板"触发 render 错误"是故意让这个小组件自己崩溃来验证捕获链路，不应该带崩整个应用
- [x] 4.4 `apps/web/src/components/shell/AppShell.tsx`：路由内容区（`<main>` 承载的 `children`）再包一层 `ErrorBoundary`，`fallback` 为"这个页面出错了" + 返回按钮，不影响 `Sidebar`/用户菜单（对应 app-shell spec.md「路由内容区渲染错误的局部兜底展示」）

## 5. 验证

- [x] 5.1 `packages/error-monitor` 的 `typecheck` + `build`（`tsup`）通过
- [x] 5.2 `apps/web` 的 `typecheck` 通过
- [x] 5.3 浏览器验证：触发一个未被 try/catch 接住的同步异常，确认控制台输出结构化的 `ErrorReport`（`source: 'runtime'`）
- [x] 5.4 浏览器验证：触发一个未 `.catch()` 的 `async` 异常，确认 `source: 'promise'` 的报告被上报
- [x] 5.5 浏览器验证：故意让渲染抛错，确认对应的 `ErrorBoundary` 只影响自己包裹的子树、展示 fallback，页面其余部分（`Sidebar`/`Header`/用户菜单）不受影响、仍可正常导航
- [x] 5.6 浏览器验证：短时间内连续触发同一个错误多次（x5），确认控制台只在窗口开始时输出一条即时报告，窗口结束（10s）后再补一条 `occurrences` 汇总记录，中间不逐次刷屏
- [x] 5.7 浏览器验证：调用 `reportError` 手动上报一次，确认 `source: 'manual'` 的报告携带传入的附加上下文
  - **实测中发现并修复了一个真实 bug**：`tsup.config.ts` 原来是 `splitting: false`，导致 `index.js`/`react.js`/`vue.js` 三个入口各自独立打包出**互不共享**的 `core/dispatch` 模块状态——`initErrorMonitor`（`index.js`）配置的 `reporters` 数组，`react.js`/`vue.js` 里的 `ErrorBoundary`/`DevTools`/`createRootErrorHandlers`/`createVueErrorHandler` 完全看不到（它们各自的 `dispatch` 副本里 `reporters` 恒为空数组），导致这几处触发的上报全部静默丢失、没有任何报错提示。改成 `splitting: true` 后 tsup 把 `core/*` 提取成三个入口共享的 chunk，问题修复，见 `tsup.config.ts` 注释
- [x] 5.8 清理浏览器实测过程中产生的临时产物（Playwright 的 `.playwright-cli/` 快照/日志目录、本地配置文件），验证用的 `ErrorMonitorDevTools` 本身作为包的正式功能保留，不删除

## 6. Vue 子路径（design.md 决策 6 落地；浏览器实测留待后续验收，见下方说明）

- [x] 6.1 `src/vue/ErrorBoundary.ts`：基于 `vue-demi` 的 `defineComponent`/`onErrorCaptured`，纯 `.ts`（不写 `.vue` SFC），`onErrorCaptured` 里生成 `source: 'render'` 的报告（Vue 的 `info` 参数放进 `extra`，Vue 没有 React 式的 componentStack）并 `return false` 阻止冒泡；`fallback` prop 支持 VNode 或渲染函数，语义对齐 `/react` 的 `ErrorBoundary`
- [x] 6.2 `src/vue/create-vue-error-handler.ts`：导出 `createVueErrorHandler()`，生成的函数可直接赋给 Vue 3 `app.config.errorHandler` / Vue 2 `Vue.config.errorHandler`；Vue 只有一个全局 handler，不做 `fatal`/`error` 二级区分，统一 `level: 'error'`
- [x] 6.3 `src/vue.ts` 统一导出 `ErrorBoundary`、`createVueErrorHandler`；`package.json` 新增 `exports["./vue"]`、`vue-demi` 依赖、`vue: ">=2.7"` 可选 peerDependency；`tsup.config.ts` 新增 `src/vue.ts` 入口
- [x] 6.4 `packages/error-monitor` 的 `typecheck` + `build` 通过（含 Vue 子路径）
- [ ] 6.5 浏览器实测验证（Vue 侧 `ErrorBoundary`/`createVueErrorHandler` 的实际捕获效果）：仓库内目前没有 Vue 消费方，无法在真实页面里验证，留到有真实 Vue 项目接入时再补跑

## 7. 包名调整

- [x] 7.1 `packages/error-monitor`、`packages/tiptap-editor` 的 `package.json` `name`/`description` 字段从 `@lhx-kit/*` 改为 `@luhanxin/*`，同步更新所有引用处（`apps/web`、`apps/api` 的依赖声明与 import 语句、两个包自身的 README/tsup 注释/源码注释）；外部真实发布的 `@lhx-kit/tsconfig` devDependency 保持不变，不在改名范围内
- [x] 7.2 `pnpm install` 重建 workspace 软链接，`packages/tiptap-editor`/`packages/error-monitor`/`apps/web`/`apps/api` 的 `typecheck` 全部通过

## 8. 降噪机制增强：单标识计数上限 + 全局节流阀 + 豁免钩子 + 运行期动态调整

- [x] 8.1 `src/core/types.ts`：`ErrorSource` 新增 `'meta'`（`error-monitor` 自身的内部诊断信息，目前唯一场景是节流丢弃汇总，不代表业务错误）；新增 `DedupeOptions`（`windowMs`/`maxCountPerWindow`/`shouldDedupe`）、`ThrottleOptions`（`windowMs`/`maxCount`/`allowFatal`）类型
- [x] 8.2 `src/core/dedupe.ts`：`createDeduper` 改为接收 `DedupeOptions` 对象；`handle` 新增第三参 `forceBypass`；实现 `maxCountPerWindow`（达到即提前 `flush` 汇总并重置该 fingerprint 的窗口）与 `shouldDedupe`（返回 `false` 时和 `forceBypass` 一样直接放行，不进分桶）
- [x] 8.3 `src/core/throttle.ts`（新建）：`createThrottle(options, onWindowDrop)` 实现全局固定窗口节流——`maxCount` 内放行，超出后默认丢弃、`allowFatal`（默认 `true`）豁免 `fatal` 级别且不计入丢弃统计；窗口结束时若有丢弃，通过 `onWindowDrop` 回调通知调用方（`throttle.ts` 自己不直接依赖 `send`，避免循环依赖）
- [x] 8.4 `src/core/dispatch.ts`：接入 `throttle`（`sendThrottled` 包一层在 `deduper.handle` 的 `send` 回调外面）；`buildThrottle` 里的 `onWindowDrop` 直接调用内部 `send` 产出 `source: 'meta'` 的诊断记录（绕开 dedupe/throttle 自身，避免自我循环）；`RawErrorInput` 新增 `forceImmediate` 字段（对应 `reportError` 调用点覆盖）；新增导出 `updateNoiseControl(options)` 供运行期间调整
- [x] 8.5 `src/core/report-error.ts`：`reportError` 新增第三参 `options?: {dedupe?: boolean}`，传 `false` 时设置 `forceImmediate: true`
- [x] 8.6 `src/core/init.ts`：`InitErrorMonitorOptions` 的 `dedupWindowMs` 替换为 `dedupe?: DedupeOptions`，新增 `throttle?: ThrottleOptions`；新增导出 `configureErrorMonitorNoiseControl(options)`，内部转发给 `dispatch.ts` 的 `updateNoiseControl`，不重新挂载全局监听器
- [x] 8.7 `src/index.ts` 补充导出 `configureErrorMonitorNoiseControl`、`ReportErrorOptions`、`DedupeOptions`、`ThrottleOptions`
- [x] 8.8 更新 `specs/error-monitor/spec.md`：扩写「错误去重与节流」需求（补充计数上限场景），新增「部分错误可豁免去重」「全局节流」「运行期间动态调整去重与节流策略」三条需求
- [x] 8.9 `packages/error-monitor` 的 `typecheck` + `build` 通过
- [x] 8.10 用临时脚本（跑完即删，不进正式代码）直接调用 `core/dispatch.ts` 验证 5 种场景：①`maxCountPerWindow` 提前 flush ②`shouldDedupe` 钩子绕过 ③`reportError({dedupe:false})` 调用点覆盖 ④全局节流丢弃 + `fatal` 豁免 + `meta` 汇总 ⑤运行期 `updateNoiseControl` 中途关闭去重生效——全部断言通过
