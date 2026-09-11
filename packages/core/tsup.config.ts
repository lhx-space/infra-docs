import {defineConfig} from 'tsup';

/**
 * tsup build config for @luhanxin/core —— 与 packages/tiptap-editor、packages/error-monitor 一致：
 * ESM-only、dts 由 tsup 管线生成、不压缩。react/react-dom（peer）与 zustand/yjs 及
 * @luhanxin/* 这些 dependencies 由 tsup 默认外部化，消费方解析它们（构建顺序由 pnpm 拓扑序保证）。
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  splitting: false,
  treeshake: true,
  target: 'node18'
});
