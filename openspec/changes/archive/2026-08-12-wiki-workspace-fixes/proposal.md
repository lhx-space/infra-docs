## Why

`wiki-workspace-api` 和 `wiki-workspace-console` 落地后，在实际验证/回顾代码时发现几处真实缺陷：前端 Pin 一个 Wiki 后如果该 Wiki 被删除（或用户被移出成员），Sidebar 会一直显示裸 UUID 而不是自动清理；`WikiList` 页面没有"已置顶"分区，Pin 的价值没有被体现出来；两处 DiceBear 默认头像/封面的 URL 生成逻辑几乎完全重复；后端成员管理的几个写操作存在竟态条件（TOCTOU）和错误码不干净的问题（并发重复添加成员会返回裸 500 而不是 409，且泄露 Prisma 原始错误信息）。这些都是缺陷修复，不涉及新功能，应该尽快收口，避免留着当技术债。

## What Changes

- 修复：Wiki 被删除或用户被移出成员后，Pin 列表不再残留裸 UUID——`fetchWikis` 成功后自动清理 `pinnedWikiIds` 中已不存在的 id
- 新增：`WikiList` 页面顶部增加"已置顶"分区，展示当前用户 Pin 的 Wiki（复用现有 `WikiCard`）
- 重构：把 `buildDefaultAvatarUrl`（`services/auth.ts`）和 `buildDefaultCoverUrl`（`services/wiki.ts`）重复的 DiceBear URL 生成逻辑提取到 `apps/api/src/utils/dicebear.ts`
- 修复：`Wiki.ownerId` 在成员角色变更后可能变成陈旧引用（不再是任何 `OWNER`，甚至不再是成员）——在 `updateWikiMemberRole`/`removeWikiMember` 涉及 `ownerId` 对应用户变更时同步维护该字段，确保它始终指向一个仍持有 `OWNER` 角色的成员
- 修复：`assertNotRemovingLastOwner` 的检查-执行两步操作包一层事务，消除并发场景下"两个请求同时移除不同 OWNER，最终变成 0 个 OWNER"的竟态条件
- 修复：`addWikiMember` 并发重复添加时，捕获数据库唯一约束冲突（Prisma `P2002`）统一转换成 `409 already_member`，不再让原始 Prisma 错误信息泄露给客户端

## Capabilities

### New Capabilities

（无——本次全部是对已有能力的缺陷修复/加固，不引入新的用户可见能力）

### Modified Capabilities

- `wiki-workspace`：成员角色变更/移除时同步维护 `ownerId`；最后一个 OWNER 保护改为事务内校验；重复添加成员的并发场景返回干净的 `409`
- `wiki-workspace-console`：Pin 列表在 Wiki 消失后自动清理；`WikiList` 页面新增"已置顶"分区

## Impact

- 后端：`apps/api/src/services/wiki.ts`、`apps/api/src/services/auth.ts`、新增 `apps/api/src/utils/dicebear.ts`
- 前端：`apps/web/src/store/pinned.ts`、`apps/web/src/store/wiki.ts`、`apps/web/src/pages/wiki/WikiList.tsx`
- 不涉及数据库 schema 变更，不需要新的 migration
- 不影响现有 API 的请求/响应格式（`409`/`404` 等错误码语义不变，只是覆盖率更完整）
