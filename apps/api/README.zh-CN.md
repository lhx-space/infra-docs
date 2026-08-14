# @app/api

> infra-docs 的 REST API + gRPC server + 后台 worker —— Express、Prisma、BullMQ、MinIO。

**[English](./README.md) | [简体中文](./README.zh-CN.md)**

属于 [infra-docs](../../README.zh-CN.md) monorepo 的一部分，整体架构见[根目录 README](../../README.zh-CN.md)。

## 这个包里有什么

这个包用同一份代码/构建产物实际跑了**两个进程**：

- **`server`**（`src/server.ts`）—— HTTP REST API（Express，默认端口 `3000`），外加一个内部**gRPC server**（默认端口 `4011`），只服务于 `apps/collab-server` 的调用。
- **`worker`**（`src/worker.ts`）—— 独立进程（BullMQ + Redis），跑不进请求处理路径的 CPU 密集任务：视频转码、周期性清理孤儿视频资产。

### REST 路由

[`src/routes`](./src/routes) 下的路由模块：`auth`、`user`、`team`、`wiki`、`document`、`link-preview`、`search`、`upload`、`video`、`health`。

### gRPC 接口（服务提供方）

`apps/api` **实现**（server 方）了 [`/protos/collab/v1/collab.proto`](../../protos/collab/v1/collab.proto) 里定义的两个 gRPC 服务，由 `apps/collab-server`（client 方）调用：

| Service.Method | 调用时机 | 作用 |
| --- | --- | --- |
| `AccessControlService.CheckDocumentRole` | 一个到 `apps/collab-server` 的 WebSocket 连接建立时 | 复用现有的 Wiki 角色鉴权逻辑（含 Team `OWNER` 兜底），判断连接是否放行、以及放行的角色 |
| `DocumentSyncService.SyncDocumentContent` | `apps/collab-server` 周期性持久化触发时 | 把 Yjs 二进制状态转换成 ProseMirror JSON，更新 `Document.content`/搜索文本，判断是否需要生成版本快照 |
| `DocumentSyncService.GetDocumentContent` | 一篇存量文档第一次建立协同连接（`yjsState` 为空）时 | 把现有 `content` 惰性迁移成初始的 Yjs 二进制状态 |

业务规则（角色校验、内容转换、版本快照策略）只在这一侧维护——`apps/collab-server` 从不重新实现这些逻辑，只通过 gRPC 调用。

### 数据模型

[`prisma/models`](./prisma/models) 下的 Prisma 模型：`user`、`team`、`wiki`、`document`、`upload`、`video`。

## 基础设施依赖

- **PostgreSQL** —— 通过 Prisma 访问。跟 `apps/collab-server`（用 `sqlx` 直连）共用同一个数据库。
- **Redis** —— BullMQ 队列，仅 `worker` 进程使用。
- **MinIO**（S3 兼容）—— 文件上传与视频资产（原始 + 转码产物）存储。

## 开发

```bash
cp .env.example .env
pnpm --filter=@app/api run generate:prisma
pnpm --filter=@app/api run migrate:prisma
pnpm dev            # 并行跑 dev:api + dev:worker（tsx watch）
```

或者在仓库根目录用 `make dev-api`（前置条件见[根目录 README](../../README.zh-CN.md#快速开始)——需要先跑起来基于 Docker 的 Postgres/Redis/MinIO）。

## 环境变量

完整列表见 [`.env.example`](./.env.example)，关键几项：

| 变量 | 说明 |
| --- | --- |
| `PORT` | HTTP API 端口（默认 `3000`） |
| `GRPC_PORT` | 内部 gRPC server 端口（默认 `4011`），供 `apps/collab-server` 访问 |
| `DATABASE_URL` | PostgreSQL 连接串（Prisma） |
| `REDIS_URL` | Redis 连接串（BullMQ） |
| `JWT_SECRET` | 访问 token 签名密钥——**必须**跟 `apps/collab-server` 的 `JWT_SECRET` 一致，后者靠这个本地校验签名 |
| `REFRESH_TOKEN_SECRET`、`ACCESS_TOKEN_TTL`、`REFRESH_TOKEN_TTL` | 鉴权 token 相关配置 |
| `CORS_ORIGIN` | 允许跨域的前端来源 |
| `MINIO_ENDPOINT`、`MINIO_ROOT_USER`、`MINIO_ROOT_PASSWORD`、`MINIO_PUBLIC_URL` | MinIO 连接信息与生成文件链接用的对外可访问地址 |

## 脚本

```bash
pnpm dev                        # 并行跑 dev:api + dev:worker（tsx watch）
pnpm build                      # tsup
pnpm start                      # 并行跑 start:api + start:worker（编译产物）
pnpm run generate:prisma        # prisma generate
pnpm run migrate:prisma          # prisma migrate dev
pnpm run migrate:deploy:prisma   # prisma migrate deploy
pnpm run validate:prisma         # prisma validate
pnpm run verify:grpc-proto       # 校验加载到的 .proto 是否包含预期的服务/方法
```

## 技术栈

Express · Prisma (PostgreSQL) · BullMQ (Redis) · MinIO · `@grpc/grpc-js` · Pino · Zod · `fluent-ffmpeg` / `sharp`
