import {readFileSync} from 'node:fs';
import {defineConfig} from 'tsup';

/**
 * apps/api 生产构建配置：用 tsup（esbuild）代替 `tsc` 直接产出 JS（见
 * openspec/changes/system-performance-hardening design.md 决策 6/7）。
 *
 * 为什么不用 tsc 直接产出：`package.json` 是 `"type": "module"`，`tsc` 配
 * `module`/`moduleResolution: nodenext` 会强制要求所有相对导入显式带 `.js` 后缀
 * （Node 原生 ESM 解析规则），但代码库里没有一处这么写——实测直接产出几十条构建错误
 * （`TS2835`），外加几个只在 `nodenext` 解析下才暴露的 CJS/ESM 互操作类型错误
 * （`pino-http`/`ioredis` 被判定"不可调用/不可构造"）。打包器会把项目内的相对导入
 * 全部内联进产物文件本身，不再依赖 Node 运行时逐个解析这些相对路径，天然绕开这条
 * 限制，不需要改几十个文件的导入语句。`tsc --noEmit`（默认 `tsconfig.json`，
 * `moduleResolution: Bundler`）继续独立负责类型检查（`typecheck`/CI 脚本不变），
 * 跟这里的构建产物生成完全解耦——类型检查的模块解析方式变化不影响这里，反之亦然。
 *
 * `entry` 用两个独立入口（`server.ts`/`worker.ts`）而不是一份共享 chunk：这两个
 * 是各自独立启动的进程（见 docker-compose.yml 的 api/worker 两个 service），产物
 * 里各自的公共依赖（`logger`/`env` 等）重复内联一份，换来两个产物互不依赖、可以
 * 独立启动，对一个后端服务来说构建产物体积重复的成本可以忽略。
 *
 * `external` 显式列出全部 `dependencies`（不依赖 tsup/esbuild 的默认推断行为，见
 * design.md 决策 7）：这些依赖本来就会随 Docker 镜像里的 `node_modules` 一起存在，
 * 打包进产物本身没有实际收益，反而有风险——`sharp`（原生二进制）、`pg`/`ioredis`
 * （数据库/缓存客户端）、`fluent-ffmpeg`（只是调用外部 ffmpeg 二进制的胶水代码）、
 * `@grpc/grpc-js` + `@grpc/proto-loader`（`proto-loader` 运行时用文件系统路径读取
 * `/protos/collab.proto`，见 `src/grpc/proto-loader.ts` 顶部注释）、`@prisma/client`/
 * `@prisma/adapter-pg`（Prisma 生成的 client 运行时会从 `@prisma/client/runtime/...`
 * 动态 `import()` 一份 wasm 查询编译器，这个 bare specifier 必须保持外部才能从
 * `node_modules` 正常解析）——一律不打包，产物里对它们的 `import` 保持原样。
 * 不在这份列表里的依赖（体量小、纯 JS、无文件系统路径依赖）才会被打包进产物本身。
 */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  dependencies?: Record<string, string>;
};

export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  dts: false,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: Object.keys(pkg.dependencies ?? {})
});
