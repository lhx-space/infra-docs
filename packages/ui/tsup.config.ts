import {defineConfig} from 'tsup';

/**
 * tsup build config for @luhanxin/ui —— 与 packages/tiptap-editor、packages/error-monitor 一致：
 * ESM-only 输出、dts 由 tsup 管线生成（tsc 只负责 typecheck）、不压缩、react/react-dom 与
 * 其余 dependencies 由 tsup 默认外部化（不打进 dist，由消费方解析）。
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: {compilerOptions: {ignoreDeprecations: '6.0'}},
  clean: true,
  sourcemap: false,
  splitting: false,
  treeshake: true,
  target: 'node18'
});
