## ADDED Requirements

### Requirement: 搜索范围为全部可访问 Wiki，不受当前团队筛选
`SearchDialog` SHALL 对当前用户可访问的全部 Wiki（不区分归属团队）进行搜索，范围与当前团队上下文（`currentTeamId`）无关，遵循 `team-switcher` 已定义的"搜索不受当前团队筛选"规则；本次不包含文档内容搜索（Document 模型尚不存在）。

#### Scenario: 搜索结果覆盖所有团队
- **WHEN** 用户输入的关键字匹配归属团队 A 与团队 B 的 Wiki
- **THEN** 搜索结果同时包含这两个团队的 Wiki，不受当前选中团队限制

### Requirement: 未输入关键字时展示置顶列表
搜索弹窗在输入框为空时 SHALL 展示当前用户已置顶的 Wiki 列表，作为快捷跳转入口；没有任何置顶时展示空态提示。

#### Scenario: 打开弹窗未输入内容
- **WHEN** 搜索弹窗刚打开且输入框为空，用户已置顶至少一个 Wiki
- **THEN** 弹窗展示已置顶的 Wiki 列表

#### Scenario: 没有任何置顶时的空态
- **WHEN** 搜索弹窗刚打开且输入框为空，用户没有置顶任何 Wiki
- **THEN** 弹窗展示"暂无置顶内容"的空态提示，而非空白

### Requirement: 按关键字过滤 Wiki
用户输入关键字后，系统 SHALL 对 Wiki 的名称和简介做大小写不敏感的包含匹配，实时过滤展示结果；无匹配结果时展示空态提示。

#### Scenario: 按名称匹配
- **WHEN** 用户输入的关键字是某个 Wiki 名称的子串
- **THEN** 该 Wiki 出现在搜索结果中

#### Scenario: 按简介匹配
- **WHEN** 用户输入的关键字是某个 Wiki 简介的子串，但不匹配名称
- **THEN** 该 Wiki 仍出现在搜索结果中

#### Scenario: 无匹配结果
- **WHEN** 输入的关键字不匹配任何可访问 Wiki 的名称或简介
- **THEN** 弹窗展示"暂无匹配结果"提示

### Requirement: 选中结果跳转并关闭弹窗
用户选中一个搜索结果（点击或键盘选中回车）后，系统 SHALL 关闭弹窗并跳转到该 Wiki 的详情页。

#### Scenario: 点击结果跳转
- **WHEN** 用户点击某个搜索结果
- **THEN** 弹窗关闭，路由跳转到该 Wiki 的详情页（`/wiki/:wikiId`）
