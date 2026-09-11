import {resolve} from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'electron-vite';

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        // 应用本体在 packages/app，`@/` 别名指向它——包内源码用 `@/` 相对自身 src 引用，
        // 宿主构建时把 `@` 解析到 packages/app/src（跟 apps/web 的 vite.config.ts 一致）。
        '@': resolve('../../packages/app/src')
      }
    },
    plugins: [react(), tailwindcss()],
    server: {
      // 固定桌面端 renderer dev server 端口为 5174，跟 apps/web 的 5173 错开，避免 Vite
      // 自动加 1 导致 CORS 白名单（apps/api 的 CORS_ORIGIN）对不上。
      port: 5174,
      strictPort: true
    }
  }
});
