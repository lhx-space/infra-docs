## 1. 通用组件与基础设施

- [x] 1.1 创建 `apps/web/src/components/shared/EmptyState.tsx`：通用空内容占位组件（图标 + 文案 + 可选操作按钮），不依赖任何数据，供各页面 `Content` 区域在未接入真实内容前使用，类似路由未匹配时展示 404 的思路
- [x] 1.2 补充 shadcn/ui 组件：`command`（搜索弹窗用，其余表格相关组件延后到接入 `DocumentTable` 时再装）
- [x] 1.3 创建 `apps/web/src/lib/avatar.ts`：`getAvatarUrl(user)`，基于 `username`/`id` 生成确定性头像 URL（如 DiceBear），预留未来接入真实 `avatarUrl` 字段的判断分支

## 2. Sidebar 状态 Store

- [x] 2.1 创建 `apps/web/src/store/shell.ts`：`sidebarCollapsed`、`sidebarWidth`、`toggleSidebar`、`setSidebarWidth`，持久化到 localStorage（参考 `store/theme.ts` 的持久化写法）
- [x] 2.2 创建 `apps/web/src/store/pinned.ts`（或合并进 `shell.ts`）：`pinnedWikiIds`、`togglePinWiki`，持久化到 localStorage

## 3. AppShell 布局

- [x] 3.1 创建 `apps/web/src/components/shell/Sidebar.tsx`：折叠图标 + 站点图标 + 站点标题
- [x] 3.2 创建 `apps/web/src/components/shell/UserMenu.tsx`：触发按钮仅展示头像（`lib/avatar.ts` 生成，`onError` 兜底为用户名首字母圆形头像），点击弹出菜单，菜单内含用户详情（头像+用户名+邮箱）→ `Appearance` 子菜单（浅色/深色/跟随系统，内联原 `ThemeToggle` 逻辑）→ 退出登录；独立于 `Sidebar`，在 `AppShell` 中以 `fixed right-3 top-3` 固定在页面右上角
- [x] 3.3 删除 `components/theme/ThemeToggle.tsx`（逻辑已内联进 `UserMenu` 的 Appearance 子菜单），确认无其他引用
- [x] 3.4 在 `Sidebar` 中实现导航区：Search 入口（仿输入框按钮样式）、Home 入口（含高亮态）、Wiki 分组入口 + 置顶列表、首页文档列表（此时 Wiki/文档列表数据均为空数组即可，不需要 mock）
- [x] 3.5 实现 Sidebar 折叠为整体隐藏：折叠后 `Content` 占满剩余宽度，同时在页面左上角固定悬浮渲染一个独立的展开按钮（点击后恢复展开）
- [x] 3.6 实现 Sidebar 右边缘拖拽调整宽度：hover 边缘出现可拖拽光标样式，拖拽时实时更新宽度并写入 `store/shell.ts`，设置最小/最大宽度常量（200px/480px）做双向钳制，`mouseup`/组件卸载时正确清理监听
- [x] 3.7 创建 `apps/web/src/components/shell/AppShell.tsx`：`Sidebar` + `<Outlet />` 的两栏布局容器，并挂载 `UserMenu` 到页面右上角
- [x] 3.8 在 `router/routes.tsx` 新增鉴权路由分组：`{ layout: AppShell, meta: { requiresAuth: true }, children: [...] }`，替换现有裸露的 Home 路由挂载方式

## 4. 页面骨架（Content 先用 EmptyState 占位）

- [x] 4.1 创建 `apps/web/src/pages/Storage.tsx`：挂载为根路径 `/` 的默认页面（不高亮任何 Sidebar 导航项），`Content` 渲染 `EmptyState`
- [x] 4.2 调整 `apps/web/src/pages/Home.tsx`：挂载到独立路由 `/home`（点击 Sidebar 的 Home 入口时高亮该导航项），移除原有登出按钮/用户信息 header（已迁移进 Sidebar），`Content` 渲染 `EmptyState`；原有 Tiptap 编辑器暂不迁移进来
- [x] 4.3 创建 `apps/web/src/pages/wiki/WikiList.tsx`：挂载路由 `/wiki`，`Content` 渲染 `EmptyState`（后续替换为 Card 网格）
- [x] 4.4 创建 `apps/web/src/pages/wiki/WikiDetail.tsx`：挂载路由 `/wiki/:wikiId`，`Content` 渲染 `EmptyState`（后续替换为文章列表）

## 5. 搜索弹窗

- [x] 5.1 创建 `apps/web/src/components/search/SearchDialog.tsx`：基于 shadcn `command` 组件实现弹窗骨架（输入框 + 空态提示，暂不接真实数据）
- [x] 5.2 在 `Sidebar` 的 Search 入口（仿输入框按钮）接入 `SearchDialog` 的开关状态

## 6. 验证（本阶段）

- [x] 6.1 运行 `pnpm --filter web typecheck`，确保新增代码无类型错误
- [x] 6.2 手动验证：登录后默认进入 `/`，Sidebar 折叠/展开（整体隐藏 + 左上角展开按钮）、拖拽调宽（含最小宽度）、刷新后状态保持均正常
- [x] 6.3 手动验证：`/home`、`/wiki`、`/wiki/:wikiId` 路由可达，均展示 `EmptyState`，Home 导航高亮态正确
- [x] 6.4 手动验证：Search 入口可打开/关闭弹窗；右上角头像点击后弹出菜单，用户详情展示正常，`Appearance` 子菜单可切换主题并高亮当前选中项，退出登录正常跳转 `/login`；折叠 Sidebar 后头像菜单依然可见可用

---

## 后续迭代（暂不实现，待上面骨架验证通过后再排期）

## 7. 文档表格组件（Manage Storage / Home 共用）

- [ ] 7.1 安装 `@tanstack/react-table`；补充 shadcn/ui 组件：`table`、`dialog`、`select`、`checkbox`、`popover`、`calendar`
- [ ] 7.2 创建 `apps/web/src/lib/mock-data.ts`：定义文档（`id/name/size/type/location/createdAt/updatedAt`）与 Wiki（`id/name/createdAt`）的 mock 数据与类型
- [ ] 7.3 创建 `apps/web/src/components/data-table/DocumentTable.tsx`：列定义（Name/Size/Created/Modified/操作列）、排序、行选择
- [ ] 7.4 实现行 hover 显示勾选框与操作列 `⋯` 菜单（`dropdown-menu`），菜单含"删除"
- [ ] 7.5 实现勾选后的批量操作工具条（批量删除）
- [ ] 7.6 实现点击行（非勾选框/操作列区域）跳转到文档详情路由
- [ ] 7.7 `Storage.tsx` 补充筛选区（Name 输入、类型 `select`、location、时间范围 `popover`+`calendar`），接入 `DocumentTable` 替换 `EmptyState`
- [ ] 7.8 `Home.tsx` 接入 `DocumentTable`（不同数据源/默认筛选/列配置），替换 `EmptyState`

## 8. Wiki 工作区真实内容

- [ ] 8.1 `WikiList.tsx` 替换为 Card 网格展示 Wiki 列表，含"新建 Wiki"入口（`dialog` 表单）、编辑、删除
- [ ] 8.2 `WikiDetail.tsx` 接入 `DocumentTable` 展示该 Wiki 下的文章列表，支持增删改查
- [ ] 8.3 实现 Wiki 卡片/详情页的"置顶"操作，接入 `store/pinned.ts`，同步更新 Sidebar 置顶列表

## 9. 收尾验证

- [ ] 9.1 手动验证：Manage Storage 筛选/排序/行选择/批量删除/点击进入详情均正常
- [ ] 9.2 手动验证：Search 弹窗默认列出最近文档，输入关键字后过滤正常
- [ ] 9.3 手动验证：创建 Wiki → 卡片展示 → 进入详情 → 增删改文章 → 置顶后出现在 Sidebar 置顶列表 → 取消置顶后消失
