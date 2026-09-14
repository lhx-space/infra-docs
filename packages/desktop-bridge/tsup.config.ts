import {defineConfig} from 'tsup';

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
