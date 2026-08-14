# @app/api

> The REST API + gRPC server + background worker for infra-docs — Express, Prisma, BullMQ, and MinIO.

**[English](./README.md) | [简体中文](./README.zh-CN.md)**

Part of the [infra-docs](../../README.md) monorepo. See the [root README](../../README.md) for the overall architecture.

## What's in here

This package actually runs **two processes** from the same codebase/build:

- **`server`** (`src/server.ts`) — the HTTP REST API (Express, default port `3000`), plus an internal **gRPC server** (default port `4011`) that only `apps/collab-server` talks to.
- **`worker`** (`src/worker.ts`) — a separate process (BullMQ + Redis) for CPU-bound jobs kept out of the request path: video transcoding and periodic cleanup of orphaned video assets.

### REST surface

Route modules under [`src/routes`](./src/routes): `auth`, `user`, `team`, `wiki`, `document`, `link-preview`, `search`, `upload`, `video`, `health`.

### gRPC surface (server side)

`apps/api` **implements** (server) two gRPC services defined in [`/protos/collab/v1/collab.proto`](../../protos/collab/v1/collab.proto), consumed by `apps/collab-server` (client):

| Service.Method | Called when | Does |
| --- | --- | --- |
| `AccessControlService.CheckDocumentRole` | A WebSocket connection to `apps/collab-server` is established | Reuses the existing Wiki-role authorization logic (with Team-`OWNER` fallback) to decide whether the connection is granted, and at what role |
| `DocumentSyncService.SyncDocumentContent` | Periodic persistence tick from `apps/collab-server` | Converts the Yjs binary state to ProseMirror JSON, updates `Document.content`/search text, and decides whether a version snapshot is due |
| `DocumentSyncService.GetDocumentContent` | First-ever collaborative connection to a legacy document (empty `yjsState`) | Lazily migrates the existing `content` into an initial Yjs binary state |

Business rules (role checks, content conversion, version-snapshot policy) live exclusively on this side — `apps/collab-server` never re-implements them, only calls over gRPC.

### Data model

Prisma models under [`prisma/models`](./prisma/models): `user`, `team`, `wiki`, `document`, `upload`, `video`.

## Infrastructure dependencies

- **PostgreSQL** — via Prisma. Shared with `apps/collab-server` (which connects directly via `sqlx`).
- **Redis** — BullMQ queues, used by the `worker` process only.
- **MinIO** (S3-compatible) — file uploads and video assets (raw + transcoded).

## Development

```bash
cp .env.example .env
pnpm --filter=@app/api run generate:prisma
pnpm --filter=@app/api run migrate:prisma
pnpm dev            # concurrently runs dev:api + dev:worker (tsx watch)
```

Or from the repo root: `make dev-api` (see the [root README](../../README.md#getting-started) for prerequisites — Docker-based Postgres/Redis/MinIO must be running first).

## Environment variables

See [`.env.example`](./.env.example) for the full list; the notable ones:

| Variable | Description |
| --- | --- |
| `PORT` | HTTP API port (default `3000`) |
| `GRPC_PORT` | Internal gRPC server port (default `4011`), reachable from `apps/collab-server` |
| `DATABASE_URL` | PostgreSQL connection string (Prisma) |
| `REDIS_URL` | Redis connection string (BullMQ) |
| `JWT_SECRET` | Access-token signing secret — **must match** `apps/collab-server`'s `JWT_SECRET`, which verifies it locally |
| `REFRESH_TOKEN_SECRET`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL` | Auth token configuration |
| `CORS_ORIGIN` | Allowed frontend origin |
| `MINIO_ENDPOINT`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_PUBLIC_URL` | MinIO connection & public URL for generated file links |

## Scripts

```bash
pnpm dev                        # dev:api + dev:worker in parallel (tsx watch)
pnpm build                      # tsup
pnpm start                      # start:api + start:worker in parallel (compiled)
pnpm run generate:prisma        # prisma generate
pnpm run migrate:prisma          # prisma migrate dev
pnpm run migrate:deploy:prisma   # prisma migrate deploy
pnpm run validate:prisma         # prisma validate
pnpm run verify:grpc-proto       # sanity-check the loaded .proto against expected services/methods
```

## Tech stack

Express · Prisma (PostgreSQL) · BullMQ (Redis) · MinIO · `@grpc/grpc-js` · Pino · Zod · `fluent-ffmpeg` / `sharp`
