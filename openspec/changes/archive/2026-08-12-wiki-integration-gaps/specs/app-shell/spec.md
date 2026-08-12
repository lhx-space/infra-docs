## MODIFIED Requirements

### Requirement: Sidebar 导航结构
`Sidebar` 导航区域 SHALL 从上到下依次包含：团队切换器、`Search` 入口、`Home` 入口、`Wiki` 分组（含创建入口与已 Pin 的 Wiki 列表）。`Search` 入口 SHALL 呈现为一个"仿输入框"样式的按钮（图标 + 占位文字，如"搜索..."），而非纯图标按钮。根路径 `/` 不再单独渲染页面，MUST 重定向到 `/home`。

#### Scenario: Search 入口触发搜索弹窗
- **WHEN** 用户点击 `Sidebar` 中的 `Search` 入口（仿输入框按钮）
- **THEN** 触发搜索弹窗展示，不进行路由跳转，该按钮本身不可直接输入文字

#### Scenario: Home 入口跳转
- **WHEN** 用户点击 `Sidebar` 中的 `Home` 入口
- **THEN** 路由跳转到 Home 页面，且该导航项在 `Sidebar` 中呈高亮/选中态

#### Scenario: Wiki 分组展示已 Pin 列表
- **WHEN** 用户已将至少一个 Wiki 置顶（Pin）
- **THEN** 该 Wiki 出现在 `Sidebar` 的置顶列表中，点击可直接跳转到对应 Wiki 详情页

#### Scenario: 访问根路径重定向到 Home
- **WHEN** 已登录用户访问根路径 `/`
- **THEN** 系统重定向到 `/home`，不展示独立的"Manage Storage"页面

## REMOVED Requirements

### Requirement: 默认落地页不高亮任何导航项
**Reason**：`Manage Storage` 页面已删除（产品方向收敛为 Wiki + 文档模型，不存在脱离 Wiki 的通用文档管理场景），根路径改为重定向到 `/home`，不再有一个"不高亮任何导航项"的独立落地页状态。
**Migration**：访问根路径 `/` 的用户会被重定向到 `/home`，`Home` 导航项会按正常路由匹配规则高亮，不需要额外处理。
