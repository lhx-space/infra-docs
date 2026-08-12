## Why

当前 `apps/web` 登录鉴权链路已经打通，但登录后直接进入的是一个裸的 Tiptap 编辑器页面，没有任何导航结构，用户无法管理已创建的文档、无法在多个"工作区/Wiki"之间切换、也没有搜索入口。需要搭建一套类 Notion 风格的应用主壳（侧边栏 + 内容区），把"文档从哪来、去哪找、怎么组织"这三个基础问题补齐，作为后续所有页面（编辑器、Wiki 详情等）的容器。

## What Changes

- 新增应用主壳布局：左侧 `Sidebar` + 右侧 `Content` 两栏结构，登录后的所有页面（Home、Storage、Wiki 等）共享同一个 Sidebar
- Sidebar 顶部：折叠/展开 icon + 站点 icon + 站点标题
- Sidebar 导航区：
  - `Search` 入口（icon + 输入框触发），点击后弹出搜索弹窗，弹窗默认列出最近文档，支持关键字搜索
  - `Home` 入口
  - `Wiki` 分组：支持创建 Wiki 工作区；分组下方展示已 Pin 的 Wiki 列表
  - 首页创建的文档列表（区别于 Wiki，直接挂在 Home 下的文档）
- 新增默认落地页 **Manage Storage**（进入首页、Sidebar 无任何项处于选中态时展示的默认内容）：
  - 顶部筛选区：Name 关键字、类型（select）、位置（location）、时间范围选择器
  - 表格列：Name、Size（可排序）、Created（创建时间）、Modified（最后修改时间）、操作列（hover 出现 `⋯`，包含删除等操作）
  - 行首 hover 出现勾选框，勾选后进入批量操作模式（支持批量删除等）
  - 点击行（非勾选框区域）跳转到该文档的具体内容页
- 新增 `Home` 页面：结构与 Manage Storage 类似，但内容侧重不同（如"最近/概览"），复用同一套表格组件做差异化配置
- 新增 `Wiki` 工作区页面：
  - Wiki 列表页：Content 区域以 Card 形式展示每个 Wiki（支持创建/编辑/删除）
  - Wiki 详情页：点击某个 Wiki 卡片后进入新页面，展示该 Wiki 下的文章列表
- 新增文档/Wiki 的 **Pin（置顶）** 能力：Pin 后出现在 Sidebar 的"已 Pin 列表"中

## Capabilities

### New Capabilities
- `app-shell`: 登录后应用主壳（Sidebar + Content 布局、折叠状态、站点品牌区、导航结构）的行为契约
- `storage-management`: Manage Storage 默认落地页——文档筛选、表格排序、行选择、批量操作、点击进入文档的行为契约
- `document-search`: Sidebar 搜索入口触发的搜索弹窗——关键字搜索、最近文档列表的行为契约
- `wiki-workspace`: Wiki 工作区的创建/列表（Card 展示）/详情（文章列表）/Pin 到 Sidebar 的行为契约

### Modified Capabilities
（无，本次是纯前端新增页面/布局，不涉及已有 `user-auth`、`auth-rate-limiting` 后端能力的契约变更）

## Impact

- **受影响代码**：`apps/web/src` 新增 `components/shell/`（Sidebar、AppShell 布局）、`pages/Storage.tsx`、`pages/Home.tsx`（重构为共享表格组件的差异化视图）、`pages/wiki/`（Wiki 列表 + 详情）、`components/search/`（搜索弹窗）、路由表 `router/routes.tsx` 新增受鉴权路由分组（挂载 AppShell 作为 layout）
- **依赖**：表格/弹窗相关的 shadcn/ui 组件（`table`、`dialog`/`command`、`select`、`checkbox`、`popover` 用于时间选择器、`dropdown-menu` 用于行操作菜单等）需要补充安装
- **数据/接口**：本次仅搭建前端页面结构与交互，文档/Wiki 的真实数据来源（后端接口）留待后续 change 接入，当前先以本地 mock 数据或空态展示为主
- **不影响**：现有 `web-auth-integration` 的登录/注册/会话逻辑，`AppShell` 作为 `RequireAuth` 保护路由下的新 layout 出现，不改变鉴权逻辑本身
