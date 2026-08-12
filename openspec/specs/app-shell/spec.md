## Requirements

### Requirement: 应用主壳整体布局
系统 SHALL 为所有已登录路由提供统一的应用主壳，采用左侧 `Sidebar` + 右侧 `Content` 两栏结构；`Sidebar` MUST 固定在视口左侧，`Content` 区域承载当前路由对应的页面内容。

#### Scenario: 已登录路由共享同一个主壳
- **WHEN** 已登录用户在 Home、Wiki 等页面之间切换
- **THEN** `Sidebar` 保持常驻不重新渲染/不闪烁，只有右侧 `Content` 区域内容随路由变化

#### Scenario: 未登录用户不展示主壳
- **WHEN** 未登录用户被路由守卫重定向到 `/login`
- **THEN** 登录/注册页面不包含 `Sidebar`，仅展示鉴权表单本身

### Requirement: Sidebar 顶部品牌区与折叠
`Sidebar` 顶部 SHALL 展示折叠/展开图标、站点图标与站点标题；点击折叠图标 MUST 将整个 `Sidebar` 隐藏（而非仅收窄为图标条），`Content` 区域随即占满剩余全部宽度；折叠状态 MUST 持久化，页面刷新后保持用户上次设置的折叠/展开状态。

#### Scenario: 点击折叠图标收起整个侧边栏
- **WHEN** 用户点击折叠图标
- **THEN** `Sidebar` 整体隐藏（宽度归零/移出视口），`Content` 区域占满页面剩余全部宽度

#### Scenario: 折叠后仍可重新展开
- **WHEN** `Sidebar` 处于折叠（隐藏）状态
- **THEN** 页面左上角固定悬浮展示一个展开图标（不随 `Content` 滚动），点击后 `Sidebar` 恢复展开，`Content` 区域宽度相应收窄

#### Scenario: 折叠状态刷新后保持
- **WHEN** 用户折叠 `Sidebar` 后刷新页面
- **THEN** `Sidebar` 保持折叠（隐藏）状态，不回到默认展开态

### Requirement: Sidebar 宽度可拖拽调整
`Sidebar` 右侧边缘 SHALL 支持鼠标 hover 后拖拽调整宽度；拖拽过程中 MUST 同时遵守一个最小宽度限制和一个最大宽度限制，拖拽宽度不能小于最小值、也不能大于最大值；调整后的宽度 SHOULD 与折叠状态一样具备持久化能力，刷新后保持用户上次设置的宽度。

#### Scenario: hover 边缘出现可拖拽提示
- **WHEN** 鼠标 hover 到 `Sidebar` 右侧边缘
- **THEN** 鼠标指针变为可拖拽样式（如左右拖动光标），提示该区域可拖拽

#### Scenario: 拖拽调整宽度
- **WHEN** 用户按住 `Sidebar` 右侧边缘并左右拖动
- **THEN** `Sidebar` 宽度随拖拽实时变化，`Content` 区域宽度相应联动收缩/扩大

#### Scenario: 拖拽宽度受最小宽度限制
- **WHEN** 用户拖拽 `Sidebar` 边缘尝试缩小到小于预设最小宽度
- **THEN** `Sidebar` 宽度停在最小宽度，不再继续缩小（即使鼠标继续向左移动）

#### Scenario: 拖拽宽度受最大宽度限制
- **WHEN** 用户拖拽 `Sidebar` 边缘尝试放大到大于预设最大宽度
- **THEN** `Sidebar` 宽度停在最大宽度，不再继续放大（即使鼠标继续向右移动）

### Requirement: 页面右上角用户菜单
应用主壳 SHALL 在页面右上角固定悬浮展示一个仅含当前登录用户头像的按钮，独立于 `Sidebar`（不随 `Sidebar` 折叠/展开而消失或移动）；用户未设置头像时 MUST 使用一个基于用户身份确定性生成的默认头像（如按 `username`/`id` 作为 seed 调用头像生成服务），保证同一用户每次展示的默认头像一致。点击头像 MUST 弹出菜单，菜单内 SHALL 依次包含：用户详情信息（用户名、邮箱等）、`Appearance`（主题偏好，hover/点击后展开二级子菜单进行浅色/深色/跟随系统选择）、退出登录入口。主题被视为用户偏好的一部分，因此与用户详情、退出登录归入同一个菜单，而不是 `Sidebar` 内独立的常驻入口。

#### Scenario: 头像触发按钮仅展示头像
- **WHEN** 用户已登录并进入任意受保护页面
- **THEN** 页面右上角仅展示一个圆形头像按钮，不展示用户名文字

#### Scenario: 用户无头像时使用默认生成头像
- **WHEN** 当前用户没有设置真实头像
- **THEN** 头像按钮展示一个根据该用户身份确定性生成的默认头像，而不是空白或统一的占位图标

#### Scenario: 点击头像展示用户详情菜单
- **WHEN** 用户点击右上角头像按钮
- **THEN** 弹出菜单，顶部展示用户详情信息（头像、用户名、邮箱）

#### Scenario: Appearance 子菜单切换主题
- **WHEN** 用户在弹出菜单中 hover 或点击 `Appearance` 菜单项
- **THEN** 展开二级子菜单，列出浅色/深色/跟随系统三个选项，选中当前生效主题旁展示勾选标记；点击任一选项后全局主题立即切换

#### Scenario: 退出登录
- **WHEN** 用户在弹出菜单中点击"退出登录"
- **THEN** 会话被清除并跳转到 `/login`

#### Scenario: Sidebar 折叠时用户菜单仍可见
- **WHEN** `Sidebar` 处于折叠（隐藏）状态
- **THEN** 页面右上角的用户菜单入口依然正常展示，不随 `Sidebar` 一起隐藏

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

### Requirement: 路由内容区渲染错误的局部兜底展示
应用主壳的路由内容区（`Content` 区域）SHALL 被一层错误边界包裹；当该区域内当前路由对应的页面组件在渲染时抛出未被处理的异常，MUST 只在 `Content` 区域内展示局部兜底提示（而非导致整个页面白屏），`Sidebar`、页面右上角用户菜单等主壳其余部分 MUST 保持正常展示与可交互。

#### Scenario: 页面渲染出错时仅内容区受影响
- **WHEN** 当前路由对应的页面组件在渲染过程中抛出未被处理的异常
- **THEN** `Content` 区域展示局部错误兜底提示，`Sidebar` 与用户菜单不受影响，用户可以正常点击 `Sidebar` 切换到其他页面

#### Scenario: 切换到其他页面后恢复正常
- **WHEN** 用户在内容区展示兜底提示的状态下，通过 `Sidebar` 导航到另一个路由
- **THEN** 新路由对应的页面正常渲染，不再展示兜底提示，不需要整页刷新
