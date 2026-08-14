# @luhanxin/web

> infra-docs 的 React 前端 —— Team/Wiki 工作区、实时协同文档编辑，以及围绕它们的一切。

**[English](./README.md) | [简体中文](./README.zh-CN.md)**

属于 [infra-docs](../../README.zh-CN.md) monorepo 的一部分。整体架构、以及这个应用跟 `apps/api`/`apps/collab-server` 之间的关系见[根目录 README](../../README.zh-CN.md)。

## 特性

- **账号体系** —— 登录/注册，会话状态由 `store/auth.ts` 管理。
- **Team / Wiki 工作区** —— 团队级 Wiki 目录、Wiki 列表/详情、邀请链接与分享链接兑换流程。
- **实时协同文档编辑** —— `pages/wiki/DocumentEditorPage.tsx`，基于 [`@luhanxin/tiptap-editor`](../../packages/tiptap-editor)，协同底层用 Yjs（`yjs`/`y-indexeddb`/`y-websocket`）。
- **命令面板搜索**（`cmdk`）、收藏/固定项、深浅色主题。
- **前端错误监控** —— 接入 [`@luhanxin/error-monitor`](../../packages/error-monitor)（`main.tsx` 挂载全局监听器，应用外壳外包一层 `ErrorBoundary`）。

## 技术栈

React 19 · Vite 8 · TypeScript · Tailwind CSS 4 · Radix UI · React Router 7 · Zustand 5 · Yjs

## 路由

集中声明在 [`src/router/routes.tsx`](./src/router/routes.tsx)：

| 路径 | 页面 | 鉴权 |
| --- | --- | --- |
| `/login`、`/register` | `pages/Login`、`pages/Register` | 仅未登录可访问 |
| `/home` | `pages/Home` | 需登录 |
| `/wiki` | `pages/wiki/WikiList` | 需登录 |
| `/wiki/:wikiId` | `pages/wiki/WikiDetail` | 需登录 |
| `/wiki/:wikiId/documents/:documentId` | `pages/wiki/DocumentEditorPage` | 需登录 |
| `/teams/:teamId/wikis` | `pages/team/TeamWikiDirectory` | 需登录 |
| `/invites/:token` | `pages/InviteRedeem` | 需登录 |
| `/share-links/:token` | `pages/ShareLinkRedeem` | 需登录 |

## 开发

这个应用需要 `apps/api` 和 `apps/collab-server` 同时跑起来（见[根目录 README](../../README.zh-CN.md#快速开始)）。

```bash
cp .env.example .env
pnpm dev            # 在这个目录下执行，或在仓库根目录用 `pnpm --filter web dev`
```

打开 <http://localhost:5173>。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `VITE_API_BASE_URL` | `apps/api` 的 REST 基础地址（默认 `http://localhost:3000`） |
| `VITE_COLLAB_WS_URL` | `apps/collab-server` 的 WebSocket 地址，用于 Yjs 同步（默认 `ws://localhost:4000/ws`） |

两者都是编译期常量，会固化进生产构建产物——换地址需要重新构建，不是运行时环境变量能解决的。

## 脚本

```bash
pnpm dev         # vite 开发服务器
pnpm build       # tsc -b && vite build
pnpm preview     # 本地预览生产构建产物
pnpm typecheck   # tsc --noEmit
```

## 状态管理

[`src/store`](./src/store) 下的 Zustand store：`auth`、`document`、`pinned`、`profile`、`search`、`shell`、`team`、`theme`、`wiki`——各自负责一个功能领域，大致跟上面的页面/路由划分对应。
