import {defineConfig} from 'tsup';

/**
 * tsup build config for @luhanxin/error-monitor.
 * - 三个入口分开打：`src/index.ts` 是框架无关的核心（不依赖 react/vue），`src/react.ts`
 *   是 React 专用子路径（ErrorBoundary/root 级回调/DevTools），`src/vue.ts` 是 Vue 专用
 *   子路径（ErrorBoundary/createVueErrorHandler，见 design.md 决策 6）。拆开构建是为了
 *   让核心逻辑在不需要任何具体框架的场景也能单独引用，也不会因为入口耦合在一起而被迫
 *   把 react/react-dom/vue 一起打进依赖图。
 * - ESM-only output（匹配 package.json 的 `"type": "module"`）。
 * - 用 tsup 自带的 dts 管线出 .d.ts，tsc 只负责 typecheck。
 * - 不压缩：发布出去的包应该保持可读，方便消费方调试。
 * - `splitting: true`——这不是可选项，是修复一个真实踩到的 bug 用的：三个入口如果各自
 *   独立打包（`splitting: false`），`core/dispatch.ts` 里 `reporters`/`deduper` 这些模块级
 *   状态会在 `index.js`/`react.js`/`vue.js` 里各自复制一份。消费方在 `index.js` 里调用
 *   `initErrorMonitor` 只配置了 `index.js` 那一份状态，而 `react.js`/`vue.js` 里的
 *   `ErrorBoundary`/`DevTools`/`createRootErrorHandlers`/`createVueErrorHandler` 用的是
 *   另一份从未被配置过的 `dispatch`（`reporters` 恒为空数组）——实测复现为：全局监听器
 *   （走 `index.js`）报的 runtime/promise/resource 错误能正常输出，但 `ErrorBoundary`
 *   捕获的渲染错误、DevTools 面板里的"手动上报"按钮全部静默丢失，没有任何报错提示。
 *   开启 `splitting: true` 后 tsup/esbuild 会把 `core/*` 提成多个入口共享的 chunk，
 *   三个入口引用的是同一份模块实例，状态自然是共享的。
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/react.ts', 'src/vue.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  splitting: true,
  treeshake: true,
  target: 'node18',
  external: ['react', 'react-dom', 'vue', 'vue-demi']
});
