# @luhanxin/web

> The React frontend for infra-docs — Team/Wiki workspaces, real-time collaborative document editing, and everything in between.

**[English](./README.md) | [简体中文](./README.zh-CN.md)**

Part of the [infra-docs](../../README.md) monorepo. See the [root README](../../README.md) for the overall architecture and how this app fits alongside `apps/api` and `apps/collab-server`.

## Features

- **Auth** — login / registration, session handled via `store/auth.ts`.
- **Team & Wiki workspaces** — team-level Wiki directories, Wiki list/detail views, invite-link and share-link redemption flows.
- **Real-time collaborative document editing** — `pages/wiki/DocumentEditorPage.tsx`, built on [`@luhanxin/tiptap-editor`](../../packages/tiptap-editor) with a Yjs (`yjs` / `y-indexeddb` / `y-websocket`) collaboration backend.
- **Command palette search** (`cmdk`), pinned/favorite items, light/dark theme.
- **Frontend error monitoring** wired up via [`@luhanxin/error-monitor`](../../packages/error-monitor) (global listeners in `main.tsx`, `ErrorBoundary` around the app shell).

## Tech stack

React 19 · Vite 8 · TypeScript · Tailwind CSS 4 · Radix UI · React Router 7 · Zustand 5 · Yjs

## Routes

Declared centrally in [`src/router/routes.tsx`](./src/router/routes.tsx):

| Path | Page | Auth |
| --- | --- | --- |
| `/login`, `/register` | `pages/Login`, `pages/Register` | guest only |
| `/home` | `pages/Home` | required |
| `/wiki` | `pages/wiki/WikiList` | required |
| `/wiki/:wikiId` | `pages/wiki/WikiDetail` | required |
| `/wiki/:wikiId/documents/:documentId` | `pages/wiki/DocumentEditorPage` | required |
| `/teams/:teamId/wikis` | `pages/team/TeamWikiDirectory` | required |
| `/invites/:token` | `pages/InviteRedeem` | required |
| `/share-links/:token` | `pages/ShareLinkRedeem` | required |

## Development

This app expects `apps/api` and `apps/collab-server` to be running (see the [root README](../../README.md#getting-started)).

```bash
cp .env.example .env
pnpm dev            # from this directory, or `pnpm --filter web dev` from the repo root
```

Open <http://localhost:5173>.

## Environment variables

| Variable | Description |
| --- | --- |
| `VITE_API_BASE_URL` | `apps/api` REST base URL (default `http://localhost:3000`) |
| `VITE_COLLAB_WS_URL` | `apps/collab-server` WebSocket URL for Yjs sync (default `ws://localhost:4000/ws`) |

Both are compile-time constants baked into the production build — changing them requires a rebuild, not just a runtime env change.

## Scripts

```bash
pnpm dev         # vite dev server
pnpm build       # tsc -b && vite build
pnpm preview     # preview the production build locally
pnpm typecheck   # tsc --noEmit
```

## State management

Zustand stores under [`src/store`](./src/store): `auth`, `document`, `pinned`, `profile`, `search`, `shell`, `team`, `theme`, `wiki` — each owns one functional domain and roughly mirrors the page/route split above.
