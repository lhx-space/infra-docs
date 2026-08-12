## Why

`team-workspace-model` 引入了 Team 概念后，用户加入的多个 Team 只是 Sidebar 里一个平铺列表，点进去是一个独立的目录页。这带来一个真实的体验问题：打开任意一个具体的 Wiki 编辑时，界面上没有任何东西告诉用户"这是我的个人空间，还是某个团队的"；Sidebar 的"全部 Wiki"和置顶列表也是把个人空间和所有已加入团队的 Wiki 混在一起展示，浏览时分不清归属。需要引入一个明确的"当前团队"上下文——类似 Notion/Slack 的 workspace 切换器，但切换本身应该是纯前端状态变化，不发生页面跳转或整页刷新。

## What Changes

- 新增全局"当前团队"（`currentTeamId`）状态，持久化在客户端（不落库、不需要新接口），默认选中用户的个人 Team
- Sidebar 顶部新增团队切换器：列出用户所属的全部 Team（含个人 Team，展示为"个人空间"），选中后瞬间切换当前团队上下文，不发生路由跳转
- Sidebar 结构调整为"全局区（搜索/Home/置顶）+ 团队区（当前团队的 Wiki 列表、新建入口）"：置顶列表保留跨团队展示，不受当前团队筛选；"Wiki"分区（全部列表）以及以后的文章树只展示当前团队的内容
- `/wiki` 列表页语义从"跨团队汇总"收紧为"当前团队的工作区列表"；**BREAKING**：不再提供跨团队汇总视图，跨团队查找改由现有全局搜索（`SearchDialog`）承担
- `CreateWikiDialog` 移除归属 Team 的手动选择器，新建 Wiki 默认直接归属当前选中的团队
- 打开一个不属于当前团队的 Wiki（通过搜索结果、分享链接、直接 URL 访问等路径）时，系统 MUST 静默将当前团队切换为该 Wiki 所属团队，不弹出确认提示

## Capabilities

### New Capabilities
- `team-switcher`：当前团队上下文状态的定义与持久化、Sidebar 团队切换器交互、置顶/搜索/Home 相对当前团队的范围豁免、打开跨团队 Wiki 时的静默跟随切换

### Modified Capabilities
- `wiki-workspace-console`：Wiki 列表页收紧为"当前团队视图"（不再是跨团队汇总）；创建工作区对话框移除归属 Team 手动选择器，改为直接使用当前团队；置顶分区的展示范围明确不受当前团队筛选影响

## Impact

- **前端**：新增 `store/team-context.ts`（或在现有 `store/team.ts` 里加 `currentTeamId` 字段）+ localStorage 持久化；`Sidebar.tsx` 顶部新增切换器组件，"Wiki"分区改为按 `currentTeamId` 过滤 `useWikiStore.wikis`（利用已存在的 `Wiki.teamId` 字段，纯前端过滤，不需要新接口）；`WikiList.tsx` 改为读取当前团队并过滤展示；`CreateWikiDialog.tsx` 移除团队选择器 UI 与相关 state；`WikiDetail.tsx`（或未来的专属 Shell）挂载时同步 `currentTeamId`
- **后端**：无接口变更（`GET /wikis` 语义保持不变，仍返回"我是成员的全部工作区"，筛选完全在前端进行）
- **不涉及**：数据库结构、权限模型均不变
