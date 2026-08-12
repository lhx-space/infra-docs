## Why

目前 `apps/web` 对前端运行时错误几乎没有任何统一的捕获与留痕手段：React 渲染阶段的错误没有任何 `ErrorBoundary`（一旦某个组件渲染抛错，整个页面会直接白屏），而事件处理函数、`async/await`、静态资源加载失败这些**不会**被 `ErrorBoundary` 捕获的错误更是完全无人问津——出了问题只能等用户反馈"页面白屏/卡住了"，排查时两眼一抹黑，没有任何错误现场（堆栈、发生时间、当时的 URL）可查。需要一套统一的错误捕获与上报基础设施，覆盖渲染错误之外的运行时错误，并把"上报到什么地方"设计成可插拔协议——后端具体的错误上报接口这轮不实现，先用 `console.log` 占位，接口定好之后直接换一个 Reporter 实现即可，不用改动任何采集侧代码。

## What Changes

- 新增 `packages/error-monitor` 包：框架无关的错误采集核心 + `Reporter` 上报协议 + React 专用子路径
  - 采集范围：全局同步异常（`window.onerror`）、未捕获的 Promise rejection（`unhandledrejection`）、静态资源加载失败（图片/脚本/样式）、React 渲染错误（`ErrorBoundary` + React 19 root 级 `onUncaughtError`/`onCaughtError`/`onRecoverableError`）、手动上报 API（`reportError`）
  - 统一的 `ErrorReport` 数据结构，不管来源是哪一种都收敛成同一个 shape 上报
  - 内置基于 message+stack 的短时间窗口去重/节流（同一个错误短时间内重复出现只报一次并计数，不刷屏）
  - `Reporter` 是可插拔接口，本轮只提供 `ConsoleReporter`（用 `console.log` 输出，验证协议链路），预留后续 `HttpReporter` 的接入位置（新增一个实现类即可，不改动任何采集逻辑）
  - `@luhanxin/error-monitor/react` 子路径导出 `ErrorBoundary` 组件（`fallback` 可自定义，供页面级/内容区级接入）与 `ErrorMonitorDevTools`（类似 Next.js 开发环境右下角的调试指示器，常驻悬浮按钮，点击展开面板可手动触发本包覆盖的每一类错误来源，供任意消费方接入后自检）
  - `@luhanxin/error-monitor/vue` 子路径导出 Vue 2.7+/3 版本的 `ErrorBoundary`、`createVueErrorHandler`（基于 `vue-demi` 桥接两个大版本，见 design.md 决策 6）——仓库内暂无 Vue 消费方，代码已落地但浏览器实测留待真实接入时补跑
- `apps/web` 接入：
  - `main.tsx`：调用 `initErrorMonitor(...)` 完成全局监听器的初始化（一次性、应用启动时），`createRoot` 补充 `onUncaughtError`/`onCaughtError`/`onRecoverableError` 三个 root 级回调，统一喂给同一套上报出口
  - `App.tsx` 根部包一层 `ErrorBoundary` 作为最外层兜底（挡路由/Provider 级别的灾难性错误，展示整页级"出错了，刷新重试"兜底 UI）
  - `AppShell.tsx` 的路由内容区（`<main>` 承载的 `children`）再包一层 `ErrorBoundary`——某个具体页面渲染崩溃时，只影响该内容区，`Sidebar`/`Header`/用户菜单仍然可用，用户可以直接切换到其他页面，不需要整页刷新

## Capabilities

### New Capabilities
- `error-monitor`：前端运行时错误的统一捕获（渲染错误/全局同步异常/未捕获 Promise rejection/资源加载失败/手动上报）、去重节流、`ErrorReport` 协议与可插拔 `Reporter` 上报机制、`ErrorBoundary` React 组件

### Modified Capabilities
- `app-shell`：新增一条要求——路由内容区渲染出错时展示局部兜底 UI，`Sidebar`/用户菜单等主壳其余部分不受影响（此前完全没有这层保护，任意页面渲染错误会导致整页白屏）

## Impact

- **新增依赖**：无第三方运行时依赖（不引入 Sentry 等 SDK），纯手写采集逻辑
- **新增代码**：`packages/error-monitor`（核心 + `/react` + `/vue` 子路径），风格与目录组织对齐现有 `packages/tiptap-editor`（独立 tsup 构建入口、子路径导出）
- **包名调整**：`packages/error-monitor`、`packages/tiptap-editor` 的作用域从 `@lhx-kit/*` 改为 `@luhanxin/*`，同步更新两个仓库内消费方（`apps/web`、`apps/api`）的依赖声明与 import 语句；外部真实发布的 `@lhx-kit/tsconfig` 不受影响
- **改动代码**：`apps/web/src/main.tsx`（挂载全局监听 + `createRoot` 的 root 级回调）、`apps/web/src/App.tsx`（最外层 `ErrorBoundary`）、`apps/web/src/components/shell/AppShell.tsx`（内容区 `ErrorBoundary`）
- **不涉及**：后端错误上报接口本身（本轮只做协议与 `ConsoleReporter` 占位，`HttpReporter` 留给接口定义后的独立后续工作）、`apps/desktop` 的接入（包设计上预留了框架无关的复用能力，但本轮只接 `apps/web`）、网络请求/接口失败监控（属于 APM 范畴，跟 JS 运行时错误是两个关注点，不纳入这个包）
