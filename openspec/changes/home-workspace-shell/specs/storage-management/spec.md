## ADDED Requirements

### Requirement: 默认落地页展示 Manage Storage
系统 SHALL 将 Manage Storage 页面作为登录后访问根路径的默认展示内容，用于统一管理用户已创建的文档。

#### Scenario: 访问根路径展示 Manage Storage
- **WHEN** 已登录用户访问应用根路径
- **THEN** `Content` 区域展示 Manage Storage 的筛选区与文档表格

### Requirement: 文档筛选
Manage Storage 页面 SHALL 提供筛选区，支持按 Name（关键字）、类型（select）、位置（location）、时间范围（创建/修改时间）筛选表格中的文档。

#### Scenario: 按名称筛选
- **WHEN** 用户在 Name 筛选框输入关键字
- **THEN** 表格实时/提交后只展示名称包含该关键字的文档

#### Scenario: 按类型筛选
- **WHEN** 用户在类型下拉中选择某个类型
- **THEN** 表格只展示该类型的文档

#### Scenario: 按时间范围筛选
- **WHEN** 用户通过时间选择器选定一个日期范围
- **THEN** 表格只展示创建时间或修改时间落在该范围内的文档

### Requirement: 文档表格列与排序
Manage Storage 表格 SHALL 包含 Name、Size、Created（创建时间）、Modified（最后修改时间）、操作列；其中 Size、Created、Modified 列 MUST 支持点击列头切换升序/降序排序。

#### Scenario: 按 Size 排序
- **WHEN** 用户点击 Size 列头
- **THEN** 表格按文件大小升序重新排列；再次点击切换为降序

#### Scenario: 按 Modified 排序
- **WHEN** 用户点击 Modified 列头
- **THEN** 表格按最后修改时间重新排列，并可再次点击切换排序方向

### Requirement: 行操作菜单
表格每一行的操作列 SHALL 默认隐藏，仅在该行被 hover 时显示"更多操作"（`⋯`）图标；点击该图标 MUST 展开操作菜单，菜单中包含删除等操作。

#### Scenario: hover 显示操作图标
- **WHEN** 鼠标 hover 到某一行
- **THEN** 该行右侧显示 `⋯` 操作图标，未 hover 的行不显示

#### Scenario: 删除单个文档
- **WHEN** 用户点击某一行的 `⋯` 图标并选择"删除"
- **THEN** 弹出确认后该文档从表格中移除

### Requirement: 行选择与批量操作
表格每一行最前面 SHALL 默认隐藏勾选框，仅在该行被 hover 或已被选中时显示；用户勾选一项或多项后 MUST 进入批量操作模式，可对已选中的文档执行批量操作（至少包含批量删除）。

#### Scenario: hover 显示勾选框
- **WHEN** 鼠标 hover 到某一行且该行未被选中
- **THEN** 该行最前面显示勾选框，鼠标移出且未勾选时勾选框恢复隐藏

#### Scenario: 勾选后进入批量操作模式
- **WHEN** 用户勾选一项或多项文档
- **THEN** 表格上方/工具区展示批量操作入口（如批量删除），且已勾选的行保持勾选框常显

#### Scenario: 批量删除
- **WHEN** 用户勾选多项文档并点击批量删除
- **THEN** 弹出确认后所有被选中的文档从表格中移除，批量操作模式退出

### Requirement: 点击行进入文档详情
表格中除勾选框和操作列之外的行区域 SHALL 支持点击，点击后跳转到该文档的具体内容页面。

#### Scenario: 点击文档行跳转
- **WHEN** 用户点击某一行的 Name 或其他非勾选框/操作列区域
- **THEN** 路由跳转到该文档对应的详情/编辑页面

#### Scenario: 点击勾选框不触发跳转
- **WHEN** 用户点击行首的勾选框
- **THEN** 该行进入选中态，不发生路由跳转
