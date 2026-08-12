## ADDED Requirements

### Requirement: Wiki 工作区创建
系统 SHALL 允许用户创建新的 Wiki 工作区（提供名称等基础信息），创建成功后该 Wiki 出现在 Wiki 列表页中。

#### Scenario: 创建 Wiki
- **WHEN** 用户在 Wiki 列表页点击"新建 Wiki"并填写名称后提交
- **THEN** 新的 Wiki 以卡片形式出现在列表中

### Requirement: Wiki 列表 Card 展示
Wiki 列表页的 `Content` 区域 SHALL 以 Card 形式展示每一个 Wiki 工作区，每个卡片 MUST 支持编辑、删除操作。

#### Scenario: 展示 Wiki 卡片列表
- **WHEN** 用户进入 Wiki 列表页
- **THEN** 已创建的 Wiki 以卡片网格形式展示，每张卡片包含名称等基础信息

#### Scenario: 删除 Wiki
- **WHEN** 用户对某个 Wiki 卡片执行删除操作并确认
- **THEN** 该 Wiki 从列表中移除，若该 Wiki 已被 Pin，同时从 Sidebar 的置顶列表中移除

### Requirement: Wiki 详情页文章列表
点击 Wiki 卡片 SHALL 跳转到该 Wiki 专属的详情页面（独立路由），详情页展示该 Wiki 下的文章/文档列表，并支持对文章的增删改查。

#### Scenario: 点击卡片进入详情页
- **WHEN** 用户点击某个 Wiki 卡片
- **THEN** 路由跳转到该 Wiki 的详情页（如 `/wiki/:wikiId`），展示该 Wiki 下的文章列表

#### Scenario: 详情页内文章增删改查
- **WHEN** 用户在 Wiki 详情页创建、编辑或删除一篇文章
- **THEN** 文章列表相应更新，变更只影响当前 Wiki 范围内的文章

### Requirement: Wiki 置顶（Pin）到 Sidebar
系统 SHALL 允许用户将 Wiki 置顶，置顶后的 Wiki MUST 出现在 `Sidebar` 的 `Wiki` 分组的置顶列表中，方便快速访问。

#### Scenario: Pin 一个 Wiki
- **WHEN** 用户对某个 Wiki 执行"置顶"操作
- **THEN** 该 Wiki 立即出现在 `Sidebar` 的置顶列表中

#### Scenario: 取消置顶
- **WHEN** 用户对已置顶的 Wiki 执行"取消置顶"
- **THEN** 该 Wiki 从 `Sidebar` 置顶列表中移除，但仍保留在 Wiki 列表页中
