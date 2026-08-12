## ADDED Requirements

### Requirement: 当前团队上下文与持久化
系统 SHALL 维护一个"当前团队"（`currentTeamId`）的客户端状态，用于筛选 Sidebar 团队区块展示的内容；该状态 MUST 持久化在客户端本地（不落库、不经由任何新增接口同步）；首次没有本地记录时 MUST 默认选中用户的个人 Team；若本地记录的 Team 已不在用户当前所属的 Team 列表中，系统 MUST 回退为默认选中个人 Team。

#### Scenario: 首次访问默认选中个人 Team
- **WHEN** 用户登录后本地没有任何"当前团队"的历史记录
- **THEN** 系统将当前团队默认设置为该用户的个人 Team

#### Scenario: 切换后持久化
- **WHEN** 用户通过切换器选中另一个 Team
- **THEN** 系统将该选择写入本地持久化存储，刷新页面后仍保持这次选择

#### Scenario: 记录的团队已失效时回退
- **WHEN** 本地记录的"当前团队"不在用户当前所属的 Team 列表中（例如已被移出该团队）
- **THEN** 系统回退为默认选中该用户的个人 Team，不报错、不阻塞页面渲染

### Requirement: Sidebar 团队切换器
Sidebar 顶部 SHALL 展示一个团队切换器，列出当前用户所属的全部 Team（含个人 Team，展示为"个人空间"）；选中另一个 Team MUST 立即更新当前团队上下文，且该操作 MUST NOT 触发路由跳转或重新拉取 Team/Wiki 列表数据（筛选基于已加载在内存中的数据完成）。

#### Scenario: 切换团队立即生效
- **WHEN** 用户在切换器中选中一个不同于当前团队的 Team
- **THEN** Sidebar 团队区块（Wiki 列表等）立即刷新为该 Team 的内容，页面 URL 与路由状态不变

#### Scenario: 切换器展示全部所属团队
- **WHEN** 用户打开团队切换器
- **THEN** 列表中包含用户的个人 Team 与其加入的所有其他 Team

### Requirement: 打开跨团队工作区时静默跟随切换
当用户通过任意路径（全局搜索结果、分享链接、直接访问 URL 等）打开一个不属于当前团队的 Wiki 时，系统 MUST 静默将当前团队切换为该 Wiki 所属的 Team，不弹出确认提示、不打断用户操作。

#### Scenario: 从搜索结果打开其他团队的 Wiki
- **WHEN** 用户点击全局搜索结果中一个归属于非当前团队的 Wiki
- **THEN** 系统在进入该 Wiki 页面的同时，将当前团队静默切换为该 Wiki 所属的 Team，Sidebar 团队区块同步更新，不出现任何确认弹窗

#### Scenario: 已经在当前团队内打开 Wiki 不触发切换
- **WHEN** 用户打开一个已经归属当前团队的 Wiki
- **THEN** 当前团队上下文不发生变化

### Requirement: 全局区元素不受当前团队筛选
搜索、Home 入口、Sidebar 置顶列表 SHALL 展示不受当前团队上下文影响的内容；切换当前团队 MUST NOT 导致置顶列表中归属其他团队的条目消失。

#### Scenario: 切换团队后置顶列表保持不变
- **WHEN** 用户置顶了归属团队 A 的一个 Wiki，随后将当前团队切换为团队 B
- **THEN** Sidebar 置顶列表中仍然展示该团队 A 的 Wiki，不因当前团队变更而隐藏

#### Scenario: 搜索结果不受当前团队限制
- **WHEN** 用户在全局搜索中输入关键词
- **THEN** 搜索结果覆盖用户可见的全部工作区，不因当前团队上下文而收窄范围
