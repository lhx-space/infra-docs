## Why

`api-auth-middleware` change 已经交付了 `GET /me`，但目前只回传 `User` 表的核心字段（id/email/username/status/时间），数据库里 `UserProfile` 表（nickname/avatarUrl/bio 等）从未被用到。前端右上角的用户菜单点开后，"用户详情"区域现在只能展示 username/email，信息量很单薄，头像也永远是根据用户名生成的占位头像。既然鉴权链路已经打通、`/me` 也已经能正常验证身份，现在正是把这份"用户详情"填充完整的时机。

## What Changes

- 扩展 `GET /me` 的响应，除了现有的 `user` 字段外，新增 `profile` 字段（`nickname`/`avatarUrl`/`bio`，取自 `UserProfile` 表），用户没有 profile 记录时 `profile` 为 `null`，不报错
- 前端 `UserMenu` 组件挂载时静默调用一次 `/me`，把返回的 `profile` 数据用于丰富点击头像后弹出菜单里的用户详情区：优先展示 `nickname`（没有则回退到 `username`）、展示 `bio`（如果有）
- 头像展示逻辑调整：如果 `profile.avatarUrl` 存在则优先使用真实头像，否则继续走现有的确定性生成头像（`lib/avatar.ts`），沿用之前设计里"预留的判断分支"
- 静默请求失败（网络问题等）时不影响原有 username/email 的展示，只是资料区暂时没有额外信息，不阻塞、不报错给用户

## Capabilities

### New Capabilities
- `user-profile-menu`: `/me` 响应扩展出的用户资料字段契约，以及前端用户菜单如何消费这些字段来丰富详情展示

### Modified Capabilities
（无——`/me` 本身的鉴权、401 契约不变，只是在已有响应体基础上新增一个字段，`api-auth-middleware` 这个 change 尚未归档，其现有 spec 不作为本次改动的基线）

## Impact

- **后端**：`apps/api/src/handlers/user.ts` 改为查询 `findUserWithProfile` 而不是 `findUserById`；新增 `services/user.ts`（或在 `models/user-profile.ts` 旁新增一个 mapper）把 `UserProfile` 收窄成 `{ nickname, avatarUrl, bio }` 三个公开字段，不暴露 `gender`/`birthday`/`phone`
- **前端**：`components/shell/UserMenu.tsx` 增加一次 `/me` 拉取（新建 `services/user.ts` 承载该请求）；`lib/avatar.ts` 的 `getAvatarUrl` 增加"优先使用真实头像"的判断分支
- **不涉及数据库 migration**：`UserProfile` 表已经存在于 `prisma/schema.prisma`，本次只是把已有字段通过接口暴露出来
- **不影响现有 `/me` 的 401 契约和 `requireAuth` 中间件行为**
