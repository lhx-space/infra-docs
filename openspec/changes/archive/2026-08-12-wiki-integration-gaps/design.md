## Context

这次不是新功能开发，是把已经存在但没接通/没清理的几处缺口收拢掉。五块彼此独立（转移团队 UI、搜索接入、Home 内容、user-lookup 清理、用户资料编辑），但都指向同一个目标：不再让"接口存在但没人调"或"UI 存在但没数据"的状态继续留在代码库里。

## Goals / Non-Goals

**Goals:**
- `transferWikiTeam` 后端能力有对应的 UI 入口可以触发
- `SearchDialog` 有真实数据源，不再是纯骨架
- `Home.tsx` 展示有意义的真实内容，不再是空 `EmptyState`
- `user-lookup` 这条已确认无人使用的路径彻底删除（前端 + 后端），不再是"标记废弃但留着"
- `UserProfile`（`nickname`/`avatarUrl`/`bio`）从"只能读"补上"能编辑保存"，`upsertUserProfile` 这个已经写好的 model 函数终于有 handler 调用它

**Non-Goals:**
- 不做 Document 模型（搜索范围因此只能覆盖 Wiki，不覆盖文档内容，这是本次明确的能力边界，不是遗漏）
- 不重新引入通用"文档管理"页面——`Storage.tsx` 直接删除，不做"先留个空壳等以后再想"
- 不做搜索的服务端全文索引/高亮等高级能力，前端对已加载的 `wikis` 数组做关键字过滤即可满足当前数据量级
- 不开放 `gender`/`birthday`/`phone` 三个 profile 字段的编辑——`/me` GET 从一开始就没返回过这三个字段（见 `user-profile-menu` design.md 的既有决策"只挑三个字段"），编辑接口保持同样的字段边界，不趁机扩大暴露面

## Decisions

### 1. Wiki 归属团队转移：放在 `WikiBasicInfoTab`，不单独开对话框
复用现有"Basic Information"Tab 的布局节奏（跟"删除工作区"区域一样是一个独立的危险操作区块），加一个"转移团队"卡片：下拉选择当前用户所属的其他 Team（`useTeamStore.teams` 过滤掉当前 `wiki.teamId`），确认后调用 `transferWikiTeam`。选项为空（用户只属于一个 Team）时整块不展示，而不是展示一个空下拉——跟其他"条件性展示管理入口"的既有模式一致。

**转移前必须有一个前置警告**：后端行为是"转移后不在新 Team 内的原有 `WikiMember` 立即失去访问权限"（`wiki-workspace` spec 已定义），前端 MUST 在确认弹窗里把这句话显式讲出来，不能只是一个通用的"确定要转移吗"，否则用户会在不知情的情况下把同事踢出访问范围。

### 2. `user-lookup` 清理范围：只删 handler + 路由，不删 `findUserByEmail`/`findUserByUsername`
搜索代码发现 `findUserByEmail`/`findUserByUsername` 这两个 model 函数除了 `lookupUserHandler` 之外，`services/auth.ts`（登录逻辑）也在用——**不能整体删除**，只删 `lookupUserHandler`、`routes/user.ts` 里的 `/users/lookup` 挂载、`services/user.ts` 里的 `lookupUser`/`LookupUserResult`、`store/wiki.ts` 里的 `lookupUser` action。删除前跑一次 typecheck 确认没有遗漏的引用。

### 3. 搜索范围：全部可访问 Wiki，不受当前团队筛选，纯前端过滤
呼应 `team-switcher` 已经定的规则（"搜索结果不受当前团队上下文影响"）——`SearchDialog` 直接读 `useWikiStore.wikis`（已经是"我可访问的全部工作区"，不需要新接口），按 `name`/`description` 做大小写不敏感的关键字包含匹配。未输入关键字时默认展示"已置顶"列表（复用 `usePinnedStore`）作为快捷入口，而不是"最近访问"——因为"最近访问"这个时间戳字段现在完全不存在，伪造一个排序等于制造假数据，这正是本次要避免的事。

### 4. Home 页面内容：置顶 Wiki（跨团队）+ 当前团队 Wiki 快捷网格
两块都是已有数据的直接复用：置顶列表用 `usePinnedStore` + `useWikiStore.wikis` 过滤（不受当前团队限制，跟 Sidebar/WikiList 的"置顶跨团队"规则一致）；下面一块用 `useCurrentTeam()` + `wikis.filter(teamId)` 展示当前团队的 Wiki，复用现成的 `WikiCard`。没有数据时展示 `EmptyState` 并给出"去 Wiki 列表页创建"的引导，而不是留白。

### 5. 移除 `Storage.tsx`，根路径重定向到 `/home`（**BREAKING**）
`router/routes.tsx` 里 `/` 对应的组件从 `Storage` 换成一个重定向（`<Navigate to="/home" replace />` 或等价的路由配置），删除 `pages/Storage.tsx` 文件本身。`app-shell` spec 里"默认落地页展示 Manage Storage"这条 Requirement 相应改写为指向 Home。

### 6. 用户资料编辑：入口放在 `UserMenu`，头像复用现有通用上传接口
`UserMenu` 的弹出菜单里，"用户详情"和"Appearance"之间新增一个"编辑资料"菜单项，点击打开 `ProfileSettingsDialog`（新组件，独立 Dialog，不是 `UserMenu` 内联表单——跟 `WikiSettingsDialog`/`TeamSettingsDialog` 的既有模式一致）。表单三个字段：昵称（`Input`）、简介（`textarea`）、头像（复用 `CreateWikiDialog`/`WikiBasicInfoTab` 里"点击上传 → 调 `/uploads/images` → 拿 URL"这套现成逻辑，不新开一个头像专用上传接口）。

保存调用新增的 `PATCH /me/profile`，后端直接调用已经存在的 `upsertUserProfile`（不需要新写一个 model 函数）；成功后前端把返回的最新 `profile` 写回 `useProfileStore`，`UserMenu` 的展示（`displayName`/`avatarUrl`/`bio`）跟着自动更新，不需要重新拉一次 `/me`。

**字段边界要卡死**：请求体 MUST 只接受 `nickname`/`avatarUrl`/`bio` 三个字段，`gender`/`birthday`/`phone` 即使传了也 MUST 被忽略——这不是"这次没做"，是刻意维持跟 `/me` GET 一致的最小暴露面，不能因为"顺手加个编辑接口"就悄悄放大了这三个敏感字段的可写范围。

## Risks / Trade-offs

- **[风险] 转移团队后原成员突然失去访问权限，可能造成误操作投诉** → 用前置文案说明 + 二次确认兜底（决策 1），服务端行为本身在 `wiki-workspace` spec 里已经是既定规则，这次只是把"知情"这件事补在 UI 上
- **[风险] 搜索只覆盖 Wiki 名称/简介，用户可能以为"搜不到"是 bug** → `SearchDialog` 的空态文案需要明确写"当前仅支持按 Wiki 名称搜索"，管理用户预期，不要让人误以为搜索坏了
- **[权衡] 删除 `Storage.tsx` 是彻底舍弃"通用文档管理"这个方向，而不是保留一个降级版** → 这是有意的：降级版本身也需要伪造数据才能看起来"有内容"，跟本次目标（消灭假骨架）矛盾；真的需要"看所有文档"的能力时，等 Document 模型上线后再评估要不要做，不在这次预留任何过渡态
- **[风险] 编辑资料接口如果不做字段白名单，容易被顺手加成"什么字段都能改"** → 后端 handler 显式只解构 `nickname`/`avatarUrl`/`bio` 三个字段传给 `upsertUserProfile`，不做"整个 body 直接透传"这种偷懒写法（决策 6）

## Migration Plan

- 无数据库迁移
- 后端：删除 handler/路由后跑一次 API 层的路由列表确认 `/users/lookup` 确实 404；`transferWikiTeam` 相关接口不变，纯前端接入
- 前端：`Storage.tsx` 删除是唯一有用户可见路由变化的改动（`/` 的行为从"展示空页面"变成"跳到 Home"），对现有用户是体验提升（不再看到空页面），不需要特殊迁移提示
