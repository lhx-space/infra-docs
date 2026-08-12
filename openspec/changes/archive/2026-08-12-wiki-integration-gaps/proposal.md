## Why

产品讨论过程中发现代码库里已经积累了不少"接口有、UI 没接"或"UI 有骨架、数据没接"的缺口：`transferWikiTeam`（转移 Wiki 归属团队）后端接口完整但没有任何入口调用；`user-lookup`（按用户名/邮箱精确查找）在 Team 模型上线后已经零调用，属于废弃但未清理的死代码；`SearchDialog` 是纯 UI 骨架，没有真实数据源；`Home.tsx`/`Storage.tsx` 全是空的 `EmptyState`。这些缺口不清理只会越滚越多，越往后接入成本越高（哪个是真预留、哪个是遗漏都分不清）。这次统一过一遍，能接的接上，确认没用的直接删掉，不再让"看起来做了但点了没用"的假骨架继续累积。

## What Changes

- **删除 `user-lookup` 能力**：确认前端已经零调用（`WikiMembersTab` 早改成了"从团队成员勾选"），后端 `GET /users/lookup` 路由、handler、`services/user.ts` 里的 `lookupUser`、`store/wiki.ts` 里的 `lookupUser` action 一并删除，不再是"标记废弃但留着"的状态
- **补上 Wiki 归属团队转移的 UI 入口**：`WikiBasicInfoTab` 新增"转移团队"操作（仅 `OWNER` 可见），从当前用户所属的其他 Team 中选择目标团队，调用已存在的 `transferWikiTeam`
- **`SearchDialog` 接入真实数据**：搜索范围是当前用户可访问的**全部 Wiki**（跨团队，不受当前团队上下文筛选，遵循 `team-switcher` 已定的"搜索不受当前团队限制"规则），按名称/简介关键字过滤；未输入关键字时默认展示"最近置顶"作为快捷入口。**不包含文档内容搜索**——Document 模型还不存在，这个范围留给 Document 模型上线后的下一个 change
- **`Home.tsx` 接入真实内容**：展示"已置顶的 Wiki"（跨团队）+ "当前团队的 Wiki"快捷入口，复用现有 `WikiCard`，替代空 `EmptyState`
- **移除 `Storage.tsx`（Manage Storage）页面，`/` 重定向到 `/home`**：**BREAKING**。这个页面从最初的应用骨架搭建时就是通用文件管理器的构想（mock 数据、`DocumentTable` 组件），但产品实际方向已经收敛成"Wiki + 文档"模型，不存在脱离 Wiki 的独立"文档"概念，继续留着这个页面只会需要伪造一批不对应任何真实数据的 mock 表格——这正是我们想避免的"假骨架"
- **补上用户资料编辑能力**：`UserProfile` 表（`nickname`/`avatarUrl`/`bio`）和 `upsertUserProfile` model 函数早就存在，`GET /me` 也已经读出来展示在 `UserMenu` 里，但从来没有写入口——新增 `PATCH /me/profile` 接口 + `UserMenu` 里的"编辑资料"入口（弹窗表单：昵称、简介、头像上传，头像复用现有的通用图片上传接口）

## Capabilities

### New Capabilities
- `wiki-search`：`SearchDialog` 接入真实 Wiki 搜索的行为契约（范围、排序、跳转）
- `home-dashboard`：Home 页面展示置顶 Wiki 与当前团队 Wiki 快捷入口的行为契约
- `user-profile-edit`：编辑并保存 `nickname`/`avatarUrl`/`bio` 三个资料字段的行为契约（入口、表单、保存后同步展示）

### Modified Capabilities
- `app-shell`：默认落地页从 `Manage Storage` 改为 `Home`；移除根路径 `/` 单独渲染页面的行为，改为重定向
- `wiki-workspace-console`：设置面板新增"转移团队"操作（仅 `OWNER`，Basic Information 区域）

### Removed Capabilities
- `user-lookup`：按用户名/邮箱精确查找用户的能力整体退役，前后端代码一并删除

## Impact

- **后端**：删除 `GET /users/lookup` 路由、`lookupUserHandler`、`routes/user.ts` 里对应挂载；`findUserByEmail`/`findUserByUsername` 这两个 model 函数如果只被这个 handler 使用则一并清理（需要先确认无其他调用点）；新增 `PATCH /me/profile` 路由 + handler，复用已存在的 `upsertUserProfile`
- **前端**：`services/user.ts` 删除 `lookupUser`/`LookupUserResult`，新增 `updateProfile`；`store/wiki.ts` 删除 `lookupUser` action；`store/profile.ts` 新增 `updateProfile` action；`WikiBasicInfoTab.tsx` 新增转移团队表单；`SearchDialog.tsx` 从骨架改为真实数据绑定；`Home.tsx` 重写；删除 `pages/Storage.tsx`，`router/routes.tsx` 移除对应路由改为根路径重定向；`UserMenu.tsx` 新增"编辑资料"入口 + 新建 `ProfileSettingsDialog.tsx`
- **数据库**：无迁移，全部是既有字段/接口的接入或既有死代码的清理
- **不涉及**：Document 模型、Yjs 协同编辑——这两个仍是下一个 change 的范围，这次不提前做；`gender`/`birthday`/`phone` 三个 profile 字段不在本次编辑范围内（`/me` GET 本来就没返回过，编辑同样不暴露，跟现有"只挑三个字段"的设计保持一致）
