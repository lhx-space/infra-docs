## 1. 数据库：Schema 与数据迁移

- [x] 1.1 `prisma/schema.prisma` 新增 `Team`/`TeamRole` enum/`TeamMember`
- [x] 1.2 新增 `TeamInvite`/`TeamInviteRedemption`
- [x] 1.3 新增 `WikiShareLink`/`WikiJoinRequest`/`JoinRequestStatus` enum
- [x] 1.4 `Wiki` 新增 `teamId`（先允许为空）、`allowJoinRequest`（默认 `false`）字段，生成 migration
- [x] 1.5 编写一次性数据回填脚本：为每个现有 `User` 创建个人 `Team`（`isPersonal: true`，该用户 `OWNER`）
- [x] 1.6 回填脚本：为每个现有 `Wiki` 设置 `teamId` 为创建者（`ownerId`）的个人 Team
- [x] 1.7 回填脚本：为每个现有 `Wiki` 的非创建者 `WikiMember`，一并加入该 Wiki 所属 Team（角色 `MEMBER`），保证历史数据满足"成员必先是同 Team"的新规则
- [x] 1.8 在本地/测试环境验证回填脚本幂等（重复执行不产生重复记录），随后将 `Wiki.teamId` 改为必填，生成第二个 migration

## 2. 后端：Team 基础模块

- [x] 2.1 `models/team.ts`：`createTeam`、`findTeamById`、`updateTeam`、`deleteTeam`（含个人 Team 删除保护）
- [x] 2.2 `models/team-member.ts`：`createTeamMember`、`findTeamMember`、`listTeamMembers`、`countOwners`、`findAnyOtherOwner`（复用 `wiki-member` 的排序思路）、`deleteTeamMember`、`updateTeamMemberRole`
- [x] 2.3 `services/team.ts`：`createTeam`（含二次确认删除、事务化唯一 OWNER 保护，复用 `services/wiki.ts` 已验证的事务模式）
- [x] 2.4 `services/auth.ts` 的注册流程：在创建 `User` 的同一事务内调用创建个人 `Team` 的逻辑
- [x] 2.5 `handlers/team.ts` + `routes/team.ts`：`POST /teams`、`GET /teams/mine`、`PATCH /teams/:teamId`、`DELETE /teams/:teamId`
- [x] 2.6 `handlers/team-member.ts`：`GET /teams/:teamId/members`、`PATCH /teams/:teamId/members/:userId`（改角色）、`DELETE /teams/:teamId/members/:userId`（移除/退出复用同一接口，区分是否是自己）

## 3. 后端：团队邀请链接

- [x] 3.1 `models/team-invite.ts`：`createTeamInvite`、`findValidInvite`（校验过期/失效/次数）、`revokeTeamInvite`
- [x] 3.2 `models/team-invite-redemption.ts`：`createRedemption`（依赖 `@@unique([inviteId, userId])` 保证幂等）、`countRedemptions`
- [x] 3.3 `services/team-invite.ts`：生成邀请链接（校验角色固定 `MEMBER`）、兑换邀请链接（幂等、次数校验、过期校验，全部在同一事务内完成"计数+创建成员+创建兑换记录"）
- [x] 3.4 `handlers/team-invite.ts` + 路由：`POST /teams/:teamId/invites`、`POST /invites/:token/redeem`、`DELETE /teams/:teamId/invites/:inviteId`（失效）

## 4. 后端：权限判断改造与成员管理收紧

- [x] 4.1 `middlewares/require-wiki-role.ts` 改造为两级查询：先查当前用户是否为该 Wiki 所属 Team 的 `OWNER`（直接放行），否则查 `WikiMember`
- [x] 4.2 `services/wiki.ts` 的 `addWikiMember`：新增校验"目标 `userId` 必须是该 Wiki 所属 Team 的成员"，不满足返回 `404 user_not_found`
- [x] 4.3 `services/wiki.ts` 的 `createWiki`：新增 `teamId` 参数（默认取创建者个人 Team），写入 `Wiki.teamId`
- [x] 4.4 新增 `services/wiki.ts` 的 `transferWikiTeam`：仅 `OWNER` 可调用，更新 `teamId`，转移后不在新 Team 的现有 `WikiMember` 立即失效（下一次权限判断即体现，不需要主动清理记录）

## 5. 后端：退出团队时的工作区所有权转移

- [x] 5.1 `services/team.ts` 的"退出/移除团队成员"逻辑：在同一事务内，找出该用户在该 Team 下所有 Wiki 的 `WikiMember` 记录
- [x] 5.2 对其中该用户是唯一显式 `OWNER` 的 Wiki，`upsert` 一条 `WikiMember`（`OWNER`）给当前 Team 中最早加入且仍持有 `OWNER` 的成员
- [x] 5.3 删除该用户在这些 Wiki 下的原 `WikiMember` 记录（跟 5.2 在同一事务）
- [x] 5.4 对非 `OWNER` 角色的 `WikiMember`，直接删除，不触发转移

## 6. 后端：工作区分享链接与申请加入

- [x] 6.1 `models/wiki-share-link.ts`：`createShareLink`、`findValidShareLink`、`revokeShareLink`
- [x] 6.2 `services/wiki-share-link.ts`：生成时校验"角色不超过创建者当前角色"；兑换时校验"用户必须是该 Wiki 所属 Team 成员"，否则返回需要先加入团队的提示
- [x] 6.3 `handlers/wiki-share-link.ts` + 路由：`POST /wikis/:wikiId/share-links`、`POST /share-links/:token/redeem`、`DELETE .../share-links/:id`
- [x] 6.4 `models/wiki-join-request.ts`：`upsertJoinRequest`、`findPendingRequest`、`updateRequestStatus`（条件更新：`WHERE status = 'PENDING'`）
- [x] 6.5 `services/wiki-join-request.ts`：发起申请（校验 `allowJoinRequest` 开启、非已成员、冷却时间）、审批（批准时创建 `WikiMember`，全部在事务内）
- [x] 6.6 `handlers/wiki-join-request.ts` + 路由：`POST /wikis/:wikiId/join-requests`、`GET /wikis/:wikiId/join-requests`（OWNER 视角待审批列表，实现中发现的必要补充）、`PATCH /wikis/:wikiId/join-requests/:id`（批准/拒绝）
- [x] 6.7 `handlers/team.ts` 新增 `GET /teams/:teamId/wikis`：仅返回元信息（名称/简介/封面/`allowJoinRequest`/我是否已是成员），不返回内容或成员名单
- [x] 6.8 `handlers/wiki.ts` 的 `updateWikiInfoSchema` 新增 `allowJoinRequest` 字段的读写（仅 `OWNER`）

## 7. 前端：Team 状态层与管理页面

- [x] 7.1 `services/team.ts`：对应上面所有 Team/邀请/成员接口的薄封装
- [x] 7.2 `store/team.ts`：`myTeams`、`fetchMyTeams`、`createTeam`、`deleteTeam`、成员管理 action
- [x] 7.3 新增团队管理页面/入口（Sidebar）：团队列表、成员列表、生成/失效邀请链接（`TeamSettingsDialog` + `CreateTeamDialog`）
- [x] 7.4 邀请链接兑换页面：`/invites/:token`，登录后调用兑换接口并展示结果（未登录复用现有 `RequireAuth` 重定向，不单独做登录后回跳）

## 8. 前端：Wiki 创建与设置面板改造

- [x] 8.1 `CreateWikiDialog.tsx`：新增归属 Team 选择（只属于个人 Team 时自动选中，隐藏选择器）
- [x] 8.2 `WikiMembersTab.tsx`：把"输入用户名/邮箱查找"改为"从所属 Team 成员列表勾选"；团队无可选成员时展示引导邀请的提示
- [x] 8.3 `WikiBasicInfoTab.tsx`：新增 `allowJoinRequest` 开关（仅 `OWNER` 可见可改）

## 9. 前端：工作区分享与申请入口

- [x] 9.1 新增"分享"入口（角色选择器上限跟随当前用户角色动态收窄，落在 `WikiMembersTab.tsx` 里，附带 `/share-links/:token` 兑换页）
- [x] 9.2 团队工作区目录页面（`/teams/:teamId/wikis`）：展示元信息卡片、"申请加入"按钮（未开放时不展示）
- [x] 9.3 该 Wiki 的 `OWNER` 视角新增"待审批申请"列表 + 批准/拒绝操作（同样落在 `WikiMembersTab.tsx` 里）

## 10. 验证

- [x] 10.1 `pnpm --filter api typecheck` + `pnpm --filter web typecheck`
- [x] 10.2 curl 验证：注册自动创建个人 Team、个人 Team 禁止删除/退出
- [x] 10.3 curl 验证：邀请链接生成/兑换（幂等、次数上限、过期、手动失效）
- [x] 10.4 curl 验证：添加 Wiki 成员收紧为"必须同 Team”，非同 Team 用户返回 `404`
- [x] 10.5 curl 验证：Team OWNER 无 `WikiMember` 记录也能管理 Wiki；降级后立即失去该兜底权限
- [x] 10.6 curl 验证：退出团队触发唯一 OWNER 的 Wiki 所有权转移（含"接收方已有低角色记录被升级"场景）
- [x] 10.7 curl 验证：分享链接角色不超过创建者、非同 Team 用户兑换被拒绝
- [x] 10.8 curl 验证：申请加入的开关默认关闭、并发审批只有一个生效、冷却时间生效
- [x] 10.9 浏览器验证：创建 Wiki 选择团队、设置面板从团队成员列表添加成员、团队设置面板（成员/邀请链接）
- [x] 10.10 清理验证过程中产生的测试数据
