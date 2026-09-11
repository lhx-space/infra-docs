import path from 'node:path';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, {reactCompilerPreset} from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), babel({presets: [reactCompilerPreset()]}), tailwindcss()],
  resolve: {
    alias: {
      // 应用本体已抽到 packages/app，`@/` 别名指向它——包内源码仍用 `@/` 相对自身 src 引用，
      // 宿主构建时需要把 `@` 解析到 packages/app/src（desktop 宿主同理）。
      '@': path.resolve(__dirname, '../../packages/app/src')
    }
  }
});
