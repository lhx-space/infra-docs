## Context

`wiki-workspace-api`（后端 Wiki/成员 CRUD）和 `wiki-workspace-console`（前端 Card 列表/设置面板/Pin）都已实现并验证通过，但都是 `Int → UUID` 迁移之后、快速迭代出来的第一版。在后续代码复盘时发现几处不依赖新数据模型、可以独立修复的缺陷：

1. `usePinnedStore`（localStorage）和 `useWikiStore`（服务端数据）是两个互相独立的 store，没有任何联动清理机制——Wiki 消失后 Pin 记录变成孤儿数据
2. `WikiList.tsx` 目前只有一个平铺的 Card 网格，Pin 功能除了在 Sidebar 露出一条链接外，在 `WikiList` 本身没有任何体现
3. `services/auth.ts`/`services/wiki.ts` 里两份几乎相同的 DiceBear URL 生成代码，是复制粘贴导致的重复
4. `services/wiki.ts` 里 `Wiki.ownerId` 只在创建时写入，成员角色变更/移除的代码路径完全不感知这个字段，导致它可能变成陈旧引用
5. `assertNotRemovingLastOwner`（最后一个 OWNER 保护）和 `addWikiMember`（重复添加校验）都是"先查询、再执行"的两步操作，没有事务包裹，存在竟态条件

这次改动全部是修复性质，不引入新的数据库字段或迁移。

## Goals / Non-Goals

**Goals:**
- Pin 列表在对应 Wiki 消失后自动清理，不再需要用户手动取消置顶来清掉裸 UUID
- `WikiList` 页面体现 Pin 的价值：顶部单独展示已置顶的 Wiki
- 消除 DiceBear URL 生成的重复代码
- `Wiki.ownerId` 在任意时刻都指向一个仍持有 `OWNER` 角色的成员（如果还存在 OWNER）
- 成员管理相关的两个竟态条件被消除或降级为数据库层面保证的一致性

**Non-Goals:**
- 不实现"Wiki 工作区专属侧边栏"（返回主页入口 + 图标+标题 + 搜索框 + 文章列表 + 内容区）——这依赖尚不存在的 Document/文章模型，留给未来一个专门的 change
- 不实现 Sidebar 里 Pin 条目的树形展开（展开显示文章列表）——同样依赖 Document 模型
- 不改变任何现有 API 的请求/响应字段结构，只改行为正确性（错误码、竟态条件），前端调用方不需要跟着改类型

## Decisions

**1. Pin 清理时机：`fetchWikis()` 成功后统一清理，而不是在每个"让 Wiki 消失"的操作里各自补一次**

`Wiki` 会因为多种原因从当前用户可见列表里消失：自己删除、被踢出成员、别的 OWNER 删除。如果在 `deleteWiki`/`removeMember` 等每个 action 里各自调用一次"清理 pin"，覆盖不全（比如"被别的 OWNER 移出成员"这种当前用户单方面不知道的情况，只有下次 `fetchWikis` 才能发现）。

统一方案：`usePinnedStore` 新增 `pruneMissingWikis(existingIds: string[])`，在 `useWikiStore.fetchWikis()` 成功拿到最新列表后调用一次，把不在 `existingIds` 里的 pinned id 全部移除。这样无论 Wiki 因为什么原因消失，只要触发过一次 `fetchWikis`（页面加载、Sidebar 挂载都会触发），Pin 列表就能自我修正，不需要对每个业务操作单独打补丁。

- **[备选方案]** 在 `deleteWiki` action 里手动调用 `usePinnedStore.getState().togglePinWiki`（如果已 pinned）——实现更直接，但覆盖不了"被移出成员"等当前 action 之外的场景，放弃

**2. DiceBear URL 生成提取到 `apps/api/src/utils/dicebear.ts`**

```ts
export function buildDicebearUrl(style: string, seed: string): string {
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}
```

`services/auth.ts` 调用 `buildDicebearUrl('glass', username)`，`services/wiki.ts` 调用 `buildDicebearUrl('shapes', name)`。纯提取，不改变任何行为（两处生成的 URL 与现在完全一致）。

**3. `ownerId` 同步策略：只在"影响 ownerId 对应用户的 OWNER 身份"时才回写，不做全量重新计算**

`updateWikiMemberRole(wikiId, targetUserId, role)` 和 `removeWikiMember(wikiId, targetUserId)` 里，如果 `targetUserId === wiki.ownerId` 且这次操作导致该用户不再是 `OWNER`（角色改成非 OWNER，或被移除），需要把 `Wiki.ownerId` 重新指向"当前仍是 OWNER 的任意一个成员"（按 `WikiMember.createdAt` 最早的 OWNER，语义上接近"最早加入的现任拥有者"）。如果操作的目标用户不是当前 `ownerId`，或者操作后该用户仍是 OWNER，则不需要任何改动。

- **[备选方案]** 每次任意成员变更都重新计算 `ownerId` → 没必要，绝大多数变更（改 VIEWER 改 EDITOR、添加新成员）根本不涉及 `ownerId` 对应的那个人，全量重算是浪费查询
- **[备选方案]** 干脆废弃 `ownerId` 字段，权限判断本来就完全走 `WikiMember` → 更彻底，但 `ownerId` 目前还承担"Wiki 创建者是谁"这个展示语义（`Wiki.owner` 关系），且改动涉及 schema 变更，超出"修复"这次的范围，留作后续讨论

**4. 最后一个 OWNER 保护：把"查 `countOwners`"和"执行更新/删除"包进同一个 `prisma.$transaction`**

```ts
async function assertNotRemovingLastOwnerAndApply(
  wikiId: string,
  targetUserId: string,
  apply: (tx: PrismaTransactionClient) => Promise<WikiMember>
): Promise<WikiMember> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.wikiMember.findUnique({where: {wikiId_userId: {wikiId, userId: targetUserId}}});
    // ...校验逻辑不变，只是查询和写入现在共享同一个事务连接
    return apply(tx);
  });
}
```

Postgres 默认的 `READ COMMITTED` 隔离级别下，同一事务内的两条语句仍然可能被其他事务的并发写入影响，真正彻底消除竟态需要 `SELECT ... FOR UPDATE` 或者可串行化隔离级别。考虑到这是低频操作（成员管理不是高并发路径），采用 `tx.wikiMember.findUnique` 配合事务内立即执行更新/删除，已经能把"两个请求各自读到旧的 `ownerCount`"这个最常见的竟态窗口大幅收窄（从"两次独立 HTTP 请求的完整耗时"收窄到"一个事务内部的极短窗口"），性价比合适；更严格的行锁留给以后如果真的出现问题再加。

**5. `addWikiMember` 重复添加：改成"依赖数据库唯一约束 + 捕获 P2002"，去掉手动预检查**

现在的写法是"先查 `existing`，没有才 `create`"——两步操作之间有间隙。改成直接尝试 `create()`，用 `try/catch` 捕获 Prisma 的唯一约束冲突错误码 `P2002`，转换成 `WikiError(409, 'already_member')`。这样无论并发与否，"是否已是成员"这件事完全交给数据库的唯一约束保证，不存在检查和执行不一致的窗口。

- **[备选方案]** 保留预检查，额外加 `try/catch` 兜底 P2002 → 两段防御逻辑同时存在，冗余且容易让人误以为预检查是必须的，去掉预检查更干净

## Risks / Trade-offs

- **[风险] `ownerId` 重新指向"最早加入的现任 OWNER"这个规则是新引入的隐性语义** → 目前没有任何 UI 依赖 `ownerId` 排序展示，风险仅限于未来如果有人假设"`ownerId` 一定是最初创建者"会踩坑；已在 `services/wiki.ts` 的注释里明确写清楚这个字段现在的更新规则
- **[风险] 事务包裹后，`updateWikiMemberRole`/`removeWikiMember` 的数据库往返次数不变但事务边界变长** → 影响可忽略，成员管理是低频操作，不在任何性能敏感路径上
- **[权衡] 不做"文章列表"相关的 UI/Sidebar 改动** → 用户原始诉求里提到的"Wiki 工作区专属侧边栏"和"Pin 可展开文章树"都需要 Document 模型才有真实数据，这次只修复不依赖新模型的部分，避免做出一个"看起来能点但永远空"的半成品 UI

## Migration Plan

- 无数据库 schema 变更，不需要 migration
- 部署顺序：后端修复（3 处）→ 前端修复（2 处），互相没有强依赖，可以分批部署
- 回滚：任意一个修复都是独立的行为修正，出问题可以单独 revert 对应文件，不影响其他修复
