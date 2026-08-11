## 1. 后端：提取 DiceBear URL 工具函数

- [x] 1.1 创建 `apps/api/src/utils/dicebear.ts`：导出 `buildDicebearUrl(style: string, seed: string): string`，行为与现有两处生成逻辑完全一致
- [x] 1.2 `services/auth.ts` 的 `buildDefaultAvatarUrl` 改为调用 `buildDicebearUrl('glass', username)`，删除本地重复实现
- [x] 1.3 `services/wiki.ts` 的 `buildDefaultCoverUrl` 改为调用 `buildDicebearUrl('shapes', name)`，删除本地重复实现

## 2. 后端：`Wiki.ownerId` 同步

- [x] 2.1 在 `apps/api/src/models/wiki.ts` 新增 `updateWikiOwner(wikiId: string, ownerId: string): Promise<Wiki>`，纯数据操作
- [x] 2.2 在 `apps/api/src/models/wiki-member.ts` 新增 `findAnyOtherOwner(wikiId: string, excludeUserId: string): Promise<WikiMember | null>`：按 `createdAt` 升序找一个仍是 `OWNER`、且不是 `excludeUserId` 的成员
- [x] 2.3 `services/wiki.ts` 的 `updateWikiMemberRole`：若 `targetUserId` 等于该工作区当前 `ownerId` 且新角色不是 `OWNER`，在同一事务内查找另一个 OWNER 并调用 `updateWikiOwner` 回写；找不到其他 OWNER 时说明这就是最后一个 OWNER，`assertNotRemovingLastOwner` 已经会先拒绝该请求，不会走到这一步
- [x] 2.4 `services/wiki.ts` 的 `removeWikiMember`：同上逻辑，`targetUserId` 等于当前 `ownerId` 且移除后不再是 OWNER 时，回写 `ownerId`

## 3. 后端：最后一个 OWNER 保护改为事务内校验

- [x] 3.1 `services/wiki.ts` 把 `assertNotRemovingLastOwner` 的查询逻辑与 `updateWikiMemberRoleModel`/`deleteWikiMember` 的实际写入合并进同一个 `prisma.$transaction`，事务内使用同一个 `tx` 客户端完成"查角色 → 查 OWNER 数量 → 校验 → 写入/删除 → （如涉及）回写 ownerId"全部步骤
- [x] 3.2 相应更新 `models/wiki-member.ts` 里被复用的函数，支持接收可选的 `tx` 客户端参数（或在 `services/wiki.ts` 内直接用 `tx.wikiMember.xxx` 调用，不强制修改 model 函数签名，视实现取哪种更符合现有代码风格）

## 4. 后端：`addWikiMember` 去掉预检查，改为捕获唯一约束冲突

- [x] 4.1 `services/wiki.ts` 的 `addWikiMember` 移除"先查 `existing` 再 `create`"的预检查逻辑，直接调用 `createWikiMember`
- [x] 4.2 用 `try/catch` 包裹 `createWikiMember` 调用，捕获 Prisma `PrismaClientKnownRequestError` 且 `code === 'P2002'` 时抛出 `WikiError(409, 'already_member')`，其他错误原样抛出交给上层处理

## 5. 前端：Pin 列表自动清理

- [x] 5.1 `apps/web/src/store/pinned.ts` 新增 `pruneMissingWikis(existingIds: string[]): void`：把不在 `existingIds` 里的 `pinnedWikiIds` 全部移除并持久化
- [x] 5.2 `apps/web/src/store/wiki.ts` 的 `fetchWikis` 成功获取列表后，调用 `usePinnedStore.getState().pruneMissingWikis(wikis.map(w => w.id))`

## 6. 前端：Wiki 列表页新增"已置顶"分区

- [x] 6.1 `apps/web/src/pages/wiki/WikiList.tsx`：从 `usePinnedStore` 读取 `pinnedWikiIds`，结合 `wikis` 计算出 `pinnedWikis` 列表（保持在 `wikis` 中出现的顺序或按置顶时间，其一即可）
- [x] 6.2 当 `pinnedWikis.length > 0` 时，在常规网格上方渲染一个"已置顶"标题 + 独立的 Card 网格（复用现有 `WikiCard`，行为不变）；`pinnedWikis.length === 0` 时不渲染该分区

## 7. 验证

- [x] 7.1 `pnpm --filter api typecheck` + `pnpm --filter web typecheck`，确保无类型错误
- [x] 7.2 curl 验证：并发发送两个"添加同一个 `userId` 为成员"的请求（用 `&` 或客户端并发工具），确认只有一条记录被创建，且非 500 的那一个请求收到 `409 already_member`
- [x] 7.3 curl 验证：创建一个有 2 个 OWNER 的工作区，把 `ownerId` 对应的用户降级为 `EDITOR`，确认工作区 `ownerId` 被更新为另一位 OWNER；再验证移除 `ownerId` 对应用户的场景
- [x] 7.4 curl 验证：唯一 OWNER 自我移除/自我降级仍然返回 `409 last_owner_required`（回归测试，确保事务化改造没有破坏原有行为）
- [x] 7.5 浏览器验证：Pin 一个工作区 → 删除该工作区 → 刷新页面（触发 `fetchWikis`）→ Sidebar 不再显示裸 id
- [x] 7.6 浏览器验证：Pin 至少一个工作区后打开 Wiki 列表页，确认顶部出现"已置顶"分区；取消置顶后分区消失
- [x] 7.7 清理验证过程中产生的测试数据（工作区、测试账号）
