## 1. 数据库 Schema

- [ ] 1.1 在 `apps/api/prisma/schema.prisma` 新增 `Wiki` 模型：`id/name/ownerId/createdAt/updatedAt`，`ownerId` 关联 `User`
- [ ] 1.2 新增 `WikiRole` 枚举：`OWNER/EDITOR/VIEWER`
- [ ] 1.3 新增 `WikiMember` 模型：`id/wikiId/userId/role/createdAt`，`wikiId`+`userId` 联合唯一约束，`onDelete: Cascade` 关联 `Wiki` 与 `User`
- [ ] 1.4 运行 `pnpm --filter api prisma migrate dev` 生成迁移并应用到本地数据库

## 2. Models 层

- [ ] 2.1 创建 `apps/api/src/models/wiki.ts`：`createWiki`、`findWikiById`、`listWikisByUserId`（通过 `WikiMember` 反查）、`updateWikiName`、`deleteWiki`
- [ ] 2.2 创建 `apps/api/src/models/wiki-member.ts`：`createWikiMember`、`findWikiMember(wikiId, userId)`、`listWikiMembers(wikiId)`、`countOwners(wikiId)`、`updateWikiMemberRole`、`deleteWikiMember`

## 3. 权限中间件

- [ ] 3.1 创建 `apps/api/src/middlewares/require-wiki-role.ts`：定义角色权重（`OWNER:3/EDITOR:2/VIEWER:1`），`requireWikiRole(minRole)` 从 `req.params.wikiId` + `req.user.id` 查 `WikiMember`，不存在返回 `403 forbidden`、工作区不存在返回 `404 not_found`、权重不够返回 `403 forbidden`；通过后将角色挂到 `req.wikiRole`（`declare global` 扩展 `Express.Request`，风格对齐 `require-auth.ts`）

## 4. Service 层

- [ ] 4.1 创建 `apps/api/src/services/wiki.ts`：定义 `WikiError extends Error`（`status`+`message`），风格对齐 `services/auth.ts` 的 `AuthError`
- [ ] 4.2 实现 `createWiki(userId, name)`：用 `prisma.$transaction` 原子性地创建 `Wiki` + `role: OWNER` 的 `WikiMember`
- [ ] 4.3 实现 `listMyWikis(userId)`：按 `WikiMember` 反查，结果按 `Wiki.updatedAt` 倒序
- [ ] 4.4 实现 `renameWiki(wikiId, name)`、`deleteWiki(wikiId)`（纯数据操作，权限已由中间件前置校验，不重复判断角色）
- [ ] 4.5 实现 `listWikiMembers(wikiId)`、`addWikiMember(wikiId, targetUserId, role)`（校验目标用户存在→`WikiError(404, 'user_not_found')`，已是成员→`WikiError(409, 'already_member')`）
- [ ] 4.6 实现 `updateWikiMemberRole(wikiId, targetUserId, role)`、`removeWikiMember(wikiId, targetUserId)`：变更/移除前先 `countOwners(wikiId)`，若操作对象是唯一 `OWNER` 且目标角色非 `OWNER`（或执行移除），抛出 `WikiError(409, 'last_owner_required')`

## 5. Handler + 路由

- [ ] 5.1 创建 `apps/api/src/handlers/wiki.ts`：`listWikisHandler`、`createWikiHandler`（zod 校验 `name: min(1).max(100)`）、`getWikiHandler`、`renameWikiHandler`、`deleteWikiHandler`；统一 `catch` 后把 `WikiError` 映射为对应状态码（对齐 `handlers/auth.ts` 的 `respondToServiceError` 写法）
- [ ] 5.2 在同文件或新建 `apps/api/src/handlers/wiki-member.ts`：`listMembersHandler`、`addMemberHandler`（zod 校验 `userId: number`、`role: enum`）、`updateMemberRoleHandler`、`removeMemberHandler`
- [ ] 5.3 创建 `apps/api/src/routes/wiki.ts`：挂载 `requireAuth` + 资源路由——`GET/POST /wikis`、`GET/PATCH/DELETE /wikis/:wikiId`（详情/重命名/删除分别挂 `requireWikiRole('VIEWER'|'EDITOR'|'OWNER')`）、`GET/POST /wikis/:wikiId/members`（`VIEWER`/`OWNER`）、`PATCH/DELETE /wikis/:wikiId/members/:userId`（`OWNER`）
- [ ] 5.4 在 `apps/api/src/routes/index.ts` 挂载 `wikiRouter`

## 6. 验证

- [ ] 6.1 运行 `pnpm --filter api typecheck`，确保新增代码无类型错误
- [ ] 6.2 curl 验证：登录用户创建工作区 → 自动成为 OWNER → 能查看/重命名/删除
- [ ] 6.3 curl 验证：OWNER 添加第二个测试账号为 `VIEWER` → 该账号能查看详情但重命名/删除返回 `403`
- [ ] 6.4 curl 验证：OWNER 把该账号角色改为 `EDITOR` → 能重命名，删除仍返回 `403`
- [ ] 6.5 curl 验证：非成员账号访问该工作区详情返回 `403`；访问不存在的 `wikiId` 返回 `404`
- [ ] 6.6 curl 验证：唯一 OWNER 尝试移除自己/把自己降级，返回 `409 last_owner_required`
- [ ] 6.7 curl 验证：添加不存在的 `userId` 返回 `404 user_not_found`；重复添加同一成员返回 `409 already_member`
- [ ] 6.8 清理验证过程中创建的测试数据（工作区、临时测试账号）
