import {defineConfig} from 'tsup';

/**
 * tsup build config for @luhanxin/ai-chat —— 与 packages/ui 一致：ESM-only、dts 由 tsup
 * 生成、不压缩、react/react-dom 与其余 dependencies 由 tsup 默认外部化（不打进 dist）。
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // tsup 8.5.1 的 dts 生成器内部强制注入 `baseUrl: "."`，而 TS 6.0 废弃了 baseUrl，
  // 会导致 dts 构建报 TS5101——这里在 dts 层静默该 deprecation（baseUrl 是 tsup 注入的，
  // 不是本包 tsconfig 里的，无法从 tsconfig 移除）。
  dts: {compilerOptions: {ignoreDeprecations: '6.0'}},
  clean: true,
  sourcemap: false,
  splitting: false,
  treeshake: true,
  target: 'node18'
});
