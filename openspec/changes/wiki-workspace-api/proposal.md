## Why

前端 Sidebar 已经搭好了 Wiki 分组入口和 `WikiList.tsx`/`WikiDetail.tsx` 页面骨架，但目前全部渲染 `EmptyState`——因为后端还没有 Wiki（工作区）相关的数据模型和接口。鉴权中间件（`requireAuth`）已经跑通，现在需要补上第一块真实业务数据：Wiki 的建表与增删改查，并且要在协议里就把"可分享"这件事的权限模型定下来，而不是等以后再返工表结构。

## What Changes

- 新增 Prisma 模型 `Wiki`（工作区元数据：`id/name/ownerId/createdAt/updatedAt`）
- 新增 Prisma 模型 `WikiMember`（工作区成员关联表：`wikiId/userId/role`，`role` 枚举 `OWNER/EDITOR/VIEWER`），创建 Wiki 时自动为创建者写入一条 `OWNER` 记录
- 新增基于角色的权限判断：`VIEWER` 可读，`EDITOR`（含 `OWNER`）可改名，仅 `OWNER` 可删除工作区、管理成员（增删成员、变更角色）
- 新增 Wiki 增删改查接口：列出"我是成员的"工作区列表、创建、查看详情、重命名、删除
- 新增工作区成员管理接口：列出成员、添加成员（按 `userId`）、变更成员角色、移除成员
- 以上所有接口均挂载 `requireAuth`，权限判断落在 `WikiMember` 而非简单的 `ownerId` 字段判断
- 本轮**不包含** Document（文章）模型与接口、不包含前端页面接入（`WikiList.tsx`/`WikiDetail.tsx` 仍暂时渲染 `EmptyState`），均留给后续 change

## Capabilities

### New Capabilities
- `wiki-workspace`: Wiki 工作区的建表、增删改查、基于角色（OWNER/EDITOR/VIEWER）的成员管理与权限判断行为契约

### Modified Capabilities
（无，不改动 `user-auth`、`auth-rate-limiting`、`api-request-auth` 现有契约，只是新增消费方）

## Impact

- **数据库**：新增 `wikis`、`wiki_members` 表（Prisma migration），`WikiMember` 与 `User`/`Wiki` 均为外键关联，`onDelete: Cascade`
- **受影响代码**：新增 `apps/api/src/models/wiki.ts`、`apps/api/src/models/wiki-member.ts`、`apps/api/src/services/wiki.ts`、`apps/api/src/middlewares/require-wiki-role.ts`、`apps/api/src/handlers/wiki.ts`、`apps/api/src/routes/wiki.ts`；`apps/api/src/routes/index.ts` 挂载新路由
- **不影响**：前端代码（本轮不接入）、`Document`/Yjs 内容持久化（留给下一个 change）、现有 `/auth/*`、`/me` 接口行为
