import {defineConfig} from 'tsup';

/**
 * tsup build config for @luhanxin/api-client —— 与 packages/tiptap-editor、packages/error-monitor
 * 一致：ESM-only、dts 由 tsup 管线生成、不压缩。无外部依赖，网络层与 services 全部打进 dist。
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
