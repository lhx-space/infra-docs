# apps/mobile

`infra-docs` 的移动端只读浏览客户端 —— 基于 **Expo · React Native**，提供登录、团队/Wiki/文档树浏览、文档只读渲染、全文搜索。编辑与实时协同能力保留在 [`apps/web`](../web) / [`apps/desktop`](../desktop)。

> 技术栈：Expo SDK 57 · React 19 · React Native 0.86 · TypeScript · Expo Router · Zustand · expo-secure-store · react-native-webview。

## 前置条件

- 依赖 monorepo 根目录已 `pnpm install`（本 app 是 workspace 成员，不单独 install）。
- 需要 [`apps/api`](../api)（REST，端口 3000）已启动；移动端是只读的，**不连接** `apps/collab-server`。

## 运行

```bash
# 在仓库根目录执行
pnpm --filter @app/mobile run ios        # iOS 模拟器
pnpm --filter @app/mobile run android    # Android 模拟器
pnpm --filter @app/mobile run web        # 浏览器（调试用）
pnpm --filter @app/mobile run typecheck  # tsc --noEmit
```

> 改了 `.env` 或根目录 workspace 依赖后，建议 `pnpm --filter @app/mobile exec expo start --clear` 清缓存重启。

## 后端地址（重要）

宿主机地址在 [`src/lib/config.ts`](./src/lib/config.ts) 里按平台自动选择：

| 运行环境 | 使用的地址 | 说明 |
| --- | --- | --- |
| iOS 模拟器 | `http://localhost:3000` | 与 Mac 共享网络，localhost 即宿主机 |
| Android 模拟器 | `http://10.0.2.2:3000` | 模拟器里 localhost 指向自身，`10.0.2.2` 才是宿主机 |
| 真机 | 自定义 | 在 `apps/mobile/.env` 写 `EXPO_PUBLIC_API_URL=http://<电脑局域网IP>:3000` |

因此**模拟器场景不要创建 `.env`**（否则会覆盖平台默认值，Android 模拟器尤其会连不上）。真机调试时再创建 `.env`，并注意：手机与电脑需同一网络，且 macOS 防火墙需放行 `node` 的入站连接。

## 目录结构

```
src/
├── app/                      — Expo Router 文件路由
│   ├── _layout.tsx           — 根布局：装配 api-client + Stack.Protected 鉴权门
│   ├── login.tsx / register.tsx
│   ├── (tabs)/               — 底部 Tab：我的团队 / 搜索
│   ├── team/[teamId].tsx     — 团队下的 Wiki 列表
│   ├── wiki/[wikiId].tsx     — 文档树
│   └── document/[documentId].tsx — 文档只读渲染（WebView）
├── components/               — screen-header / states 等通用组件
├── lib/                      — config（平台地址）/ token-store（SecureStore）/ bootstrap / document-tree / format / errors
└── store/                    — zustand：auth / team / document / search
```

## 与 monorepo 的关系

- 复用 [`@luhanxin/api-client`](../../packages/api-client)（纯 HTTP 客户端，bearer 鉴权模式），不直接依赖 DOM 绑定的 `@luhanxin/app` / `@luhanxin/ui` / `@luhanxin/tiptap-editor`。
- monorepo 集成在 [`metro.config.js`](./metro.config.js)：`watchFolders` + `nodeModulesPaths` 指向 workspace 根，保留 Metro 默认层级查找以兼容 pnpm 隔离布局。
- 代码风格走仓库统一的 biome（根目录 `pnpm lint`）。

## API 断点调试

移动端连不上后端时，先用「模拟器能否访问宿主机」二分定位；后端断点调试见根 README 的 `dev:api:debug`（`--inspect=9229`，配合 `.vscode/launch.json`）。
