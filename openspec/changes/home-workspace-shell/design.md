## Context

前端路由体系已经在 `web-auth-integration` change 中搭好一套"类 vue-router 配置化路由 + layout 节点"的模式（`AppRouteConfig` 支持 `layout`/`meta`/`children`，`build-routes.tsx` 负责把 layout 包裹成 `<Layout><Outlet/></Layout>`，`AuthLayout` 是已有的一个 layout 示例）。当前登录成功后直接渲染 `pages/Home.tsx`（一个裸的 Tiptap 编辑器 + 顶部登出按钮），没有侧边栏、没有文档管理、没有 Wiki 概念。

本次要在鉴权路由分组下新增一个 `AppShell` layout（Sidebar + Content），并在其下挂载多个具体页面：默认落地页 Manage Storage、Home、Wiki 列表/详情。搜索是 Sidebar 触发的全局弹窗，不对应独立路由。

后端目前只有 `user-auth`/`auth-rate-limiting` 两个能力，没有文档、Wiki 相关的数据接口，本次改动范围内文档/Wiki 数据先用前端 mock/本地状态占位。

## Goals / Non-Goals

**Goals:**
- 搭建可复用的 `AppShell`（Sidebar 折叠 + 品牌区 + 导航）作为登录后所有页面的统一容器
- 提供一套可复用的"文档表格"组件（排序、筛选、行选择、批量操作、点击进入详情），Manage Storage 与 Home 两个页面共享同一套表格、传入不同的数据/配置
- 提供 Wiki 工作区的卡片列表 + 详情文章列表的页面骨架
- 提供 Sidebar 触发的搜索弹窗（关键字搜索 + 最近文档列表）
- 提供 Pin（置顶）机制：文档或 Wiki 被 Pin 后出现在 Sidebar 对应列表中

**Non-Goals:**
- 不实现真实的文档/Wiki 后端接口与数据库模型（本次只搭前端结构，数据先 mock，接口留给后续 change）
- 不实现文档内容协同编辑的具体功能变更（Tiptap 编辑器本身不在本次范围）
- 不实现拖拽排序、文件夹嵌套等高级文件管理能力
- 不做移动端适配优化（本次先保证桌面端体验）

## Decisions

**1. AppShell 复用现有 `layout` 路由节点模式，而不是在每个页面里手写 Sidebar**
- 沿用 `web-auth-integration` 里 `AuthLayout` 的做法：在 `routes.tsx` 新增一个 `{ layout: AppShell, meta: { requiresAuth: true }, children: [...] }` 分组，Manage Storage/Home/Wiki 等页面作为 children，页面组件本身不关心自己被套了什么布局
- 备选方案：每个页面各自 import Sidebar——会导致 Sidebar 状态（折叠/展开）难以在页面间保持一致，且重复代码多，不采用

**2. Sidebar 折叠状态：zustand store + localStorage 持久化，模式与已有 `store/theme.ts` 一致**
- 新增 `store/shell.ts`，管理 `sidebarCollapsed: boolean`、`sidebarWidth: number` 及 `togglePin`/`pinnedIds` 等 UI 态；持久化到 `localStorage`，避免刷新后折叠状态/宽度丢失
- 折叠是"整体隐藏"而不是"收窄为图标条"：`sidebarCollapsed = true` 时 `Sidebar` 整体不占空间（`Content` 占满），同时在页面固定位置（如左上角）渲染一个独立的展开按钮，与 `Sidebar` 内部的折叠按钮是两个不同的挂载点、但共用同一个 store 状态
- 备选方案：只用组件内 `useState`——折叠状态无法跨路由保持（AppShell 本身作为 layout 是常驻的，理论上组件不会被卸载，但为了后续可能的持久化需求和其他组件读取折叠状态，仍选择 store 而非纯本地状态

**2.1 Sidebar 宽度可拖拽调整：右边缘拖拽手柄 + `min-width` 限制**
- 在 `Sidebar` 右侧渲染一个几像素宽的透明拖拽热区，`onMouseDown` 后监听 `document` 级别的 `mousemove`/`mouseup` 计算宽度差值，实时写入 `store/shell.ts` 的 `sidebarWidth`（而不是用 CSS `resize` 属性，因为需要限制最小宽度并联动持久化）
- 最小宽度、最大宽度各设一个常量（`SIDEBAR_MIN_WIDTH = 200`、`SIDEBAR_MAX_WIDTH = 480`），拖拽计算出的宽度用 `Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, nextWidth))` 双向钳制，避免只做了最小宽度限制导致可以无限拖宽
- 拖拽调整宽度与"折叠"是两个独立状态：折叠时 `Sidebar` 不渲染（宽度设置不生效），展开时宽度生效
- 备选方案：CSS 原生 `resize: horizontal`——浏览器原生支持但样式/手柄不可定制、不方便做最小宽度以外的定制交互（如拖拽时的视觉反馈），不采用

**3. 数据表格：引入 `@tanstack/react-table`（headless）+ shadcn `table` 组件做展示层**
- Manage Storage 需要排序（Size/Created/Modified）、行选择（批量操作）、筛选（Name/类型/位置/时间范围），这些是 `@tanstack/react-table` 的标准能力（`getSortedRowModel`、`getFilteredRowModel`、`rowSelection` state），手写这套状态机成本高且容易出 bug
- Home 页面复用同一个表格组件，通过 props 传入不同的列配置/数据源/默认排序，做到"结构一样、内容不同"
- 备选方案：手写 `<table>` + 本地 state 管理排序/选择——量小时可行，但本次要求的交互（排序、批量操作、hover 出勾选框）组合起来已经接近成熟表格库的能力，手写维护成本更高，不采用

**4. 搜索弹窗：shadcn `command`（基于 cmdk）组件**
- `command` 组件天然支持"输入框 + 列表 + 键盘导航"，符合"点击后弹出弹窗进行搜索，并列出最新文档"的交互；弹窗开关状态放在 Sidebar 的搜索按钮本地 state 即可，不需要全局路由
- 备选方案：`dialog` + 手写 input/list——功能上可以做，但要重新实现 `command` 已经内置的键盘导航/高亮匹配，不采用

**5. Wiki 详情页作为独立路由（`/wiki/:wikiId`），而不是弹窗/侧滑**
- "点击后开新的页面"符合用户描述，Wiki 详情本质是另一个文档列表视图，值得有自己的 URL（可分享、可前进后退），沿用 AppShell 作为其 layout

**6. 默认落地页 `/`（Manage Storage）与 Sidebar「Home」入口路径分离**
- 根据需求："进入首页后 Sidebar 一个也没有选中，默认展示的是 Manage Storage 页面"；而 Sidebar 上还有一个独立的 `Home` 导航项，点进去是"结构类似但内容调整过"的另一个页面
- 因此路由设计为：`/`（Manage Storage，默认态，不高亮任何 Sidebar 项）、`/home`（Home 页面，高亮 Sidebar 的 Home 项）、`/wiki`、`/wiki/:wikiId`
- 这是对需求的一种合理拆解，如果理解有误需要在 tasks 阶段前确认（见 Open Questions）

**7. Mock 数据层：延后到真正接入 `DocumentTable` 时再引入**
- 本次 Shell 骨架搭建阶段不需要任何 mock 数据——`Storage`/`Home`/`Wiki` 等页面的 `Content` 区域在没有接入真实表格/内容之前，统一渲染通用的 `EmptyState` 组件（纯展示，不依赖数据），逻辑上类似"路由未匹配时展示 404 页"——没有内容就展示空状态，不需要先造一批假数据来"演示表格能不能转"
- 等后续迭代真正实现 `DocumentTable`（决策 3）时，再引入 `lib/mock-data.ts` 或直接接后端接口，字段结构到那个阶段再定义

**8. 分阶段实现：先搭 Shell + 导航骨架，`Content` 区域用通用 `EmptyState` 组件占位，`DocumentTable`/Tiptap 集成延后**
- 本次先完成 `AppShell`/`Sidebar`（折叠、拖拽调宽、导航结构、路由分组）与各页面的路由骨架；`Storage`/`Home`/`Wiki` 等页面在还没接入 `DocumentTable`（见决策 3）之前，`Content` 区域先渲染一个通用的 `components/shared/EmptyState.tsx`（图标 + 文案 + 可选操作按钮），作为所有"暂未接入真实内容"页面的统一占位，不依赖任何数据
- `EmptyState` 不是临时脚手架，而是长期复用的通用组件——以后任何页面出现"筛选后无结果"、"列表为空"等场景都可以复用它，只是当前阶段被用来表示"页面骨架已就位、具体内容还没做"
- 现有 `pages/Home.tsx` 里的 Tiptap 编辑器暂不迁移/整合进本次的页面骨架，`Home`/`Storage`/`Wiki` 详情页的真实内容（表格、编辑器）都作为后续迭代任务，与本次"Shell 骨架搭建"解耦
- 备选方案：一次性把表格、mock 数据和路由骨架都做完——工作量集中、反馈周期长，且表格相关的产品细节（Open Questions 里提到的批量操作范围、`/` 与 `/home` 差异等）还没敲定，先做骨架能更快验证导航/布局本身是否符合预期，不采用

**9. 用户菜单：仅头像触发，弹出菜单内含用户详情 + Appearance 子菜单 + 退出登录，独立于 Sidebar 固定悬浮在页面右上角**
- 用户没有真实头像时（当前 `AuthUser` 类型本身也没有 `avatarUrl` 字段），用一个基于 `username`（或 `id`）作为 seed 的确定性头像生成服务（如 DiceBear：`https://api.dicebear.com/9.x/<style>/svg?seed=<username>`）拼出头像 URL，保证同一用户每次展示的默认头像稳定不变，而不是每次刷新随机变化
- 封装成 `lib/avatar.ts` 的一个小工具函数 `getAvatarUrl(user)`，未来后端如果提供了真实 `avatarUrl` 字段，只需在该函数里加一层"优先用真实头像，否则 fallback 到生成头像"的判断，调用方不用改
- 新增独立组件 `components/shell/UserMenu.tsx`，挂载在 `AppShell` 层（而非 `Sidebar` 内部），以 `fixed right-3 top-3 z-50` 定位在页面右上角；这样 `Sidebar` 折叠/隐藏时用户菜单依然可见，两者是完全独立的挂载点
- 触发按钮**只展示头像**（不展示用户名文字），点击后弹出的 `DropdownMenuContent` 依次包含：`DropdownMenuLabel` 展示用户详情（头像+用户名+邮箱，纯展示不可点击）→ 分隔线 → `DropdownMenuSub`「Appearance」（hover/点击展开二级子菜单，内含浅色/深色/跟随系统三个选项，当前生效项带勾选标记）→ 分隔线 → 「退出登录」（`variant="destructive"`）
- 主题被视为**用户偏好**，因此不再是独立于用户身份的全局按钮或 `Sidebar` 常驻入口，而是归入同一个"用户菜单"里，逻辑上与"退出登录"平级——都是跟用户账号相关的操作/设置
- 备选方案 A：头像旁展示用户名文字——占用页面右上角更多横向空间，且用户名已经在点击后的详情区展示，顶部只需要一个紧凑的头像入口即可，不采用
- 备选方案 B：主题切换单独放在 `Sidebar` 里（本次改造前的方案）——`Sidebar` 折叠后主题入口跟着消失，且主题作为"用户偏好"这一属性更适合和账号相关操作放在一起而不是导航结构里，不采用

**10. `ThemeToggle` 独立组件下线，逻辑内联进 `UserMenu` 的 Appearance 子菜单**
- 原 `components/theme/ThemeToggle.tsx`（独立的主题切换下拉按钮）已删除，其"三态选项 + 勾选高亮"的渲染逻辑直接内联到 `UserMenu.tsx` 的 `DropdownMenuSub` 内，复用同一个 `useThemeStore`
- 影响范围：登录/注册页面（`AuthLayout` 下）本身不挂载 `AppShell`/`UserMenu`，因此依然没有主题切换入口——这两个页面本身不涉及"已登录用户"概念，与用户偏好菜单挂载在一起是合理的范围收窄，维持之前的已知 trade-off

**11. Search 入口样式：Sidebar 内的"仿输入框"按钮**
- 渲染为一个 `<button>`，视觉上做成输入框的样子（圆角边框 + 搜索 icon + 占位文字"搜索..."），点击后打开 `SearchDialog`；按钮本身 `disabled` 真实输入行为（不接 `onChange`），所有输入都发生在弹窗内的 `command` 输入框里
- 备选方案：Sidebar 里放一个可以直接输入的 `Input`，输入时才弹出结果面板（更像 Algolia DocSearch 那种内嵌体验）——交互更复杂（需要处理"输入框本身是否要在弹窗打开后保持焦点同步"），本次先用更简单的"点击打开弹窗"模式，不采用

## Risks / Trade-offs

- [Risk] 引入 `@tanstack/react-table` 增加一个新依赖和学习成本 → Mitigation：该库是 shadcn 官方 "Data Table" 范例推荐搭配，社区文档/示例成熟，风险可控
- [Risk] Mock 数据阶段的字段结构如果和后续真实后端接口字段不一致，接入时需要改表格列定义 → Mitigation：提前参考通用文件管理字段命名（`name/size/type/location/createdAt/updatedAt`），降低返工概率
- [Risk] `/` 与 `/home` 两个相似页面并存，容易让用户困惑"两个页面到底有什么区别" → Mitigation：先按需求拆分实现，后续可根据实际使用反馈合并或强化差异化（见 Open Questions）
- [Trade-off] Sidebar 折叠状态用 zustand+localStorage 而非纯路由/URL 记录——折叠状态是纯 UI 偏好，不需要可分享/可回退，选择更轻量的本地持久化方案
- [Risk] 拖拽调整宽度若不正确清理 `document` 上的 `mousemove`/`mouseup` 监听，可能导致内存泄漏或拖拽状态"粘滞"（松开鼠标后仍在调整）→ Mitigation：`mouseup` 时务必移除监听，并在组件卸载时兜底清理（`useEffect` cleanup）
- [Risk] 头像生成服务（DiceBear 等）是第三方外部依赖，若该服务不可用会导致头像位置加载失败 → Mitigation：`<img>` 增加 `onError` 兜底展示用户名首字母的纯色圆形头像，不阻塞页面其他功能
- [Trade-off] 登录/注册页面不再有主题切换入口（原全局悬浮按钮移入 Sidebar，而 Sidebar 只在登录后可见）→ 可接受的范围收窄，用户登录后设置的主题偏好本身是全局持久化的，只是切换入口暂时只在登录后可用

## Open Questions

- `/`（默认 Manage Storage）与 `/home`（Home 导航项）具体的内容差异是什么？当前设计先假设两者共享同一套表格组件、仅数据源/默认筛选不同，需要在实现前进一步确认，或在 tasks 阶段留一个"待产品/设计确认"的检查点
- 批量操作具体包含哪些动作（目前明确的只有"删除"，"其他操作"具体是什么）？
- Wiki 的"文章列表"页面是否复用 Manage Storage 的表格组件，还是需要独立的列表样式？本设计默认复用同一套表格组件（一致性优先），如有出入需求阶段调整
