## 1. 当前团队状态层

- [x] 1.1 在 `store/team.ts` 里新增 `currentTeamId` 状态与 `setCurrentTeamId` action
- [x] 1.2 持久化到 `localStorage`（key: `current-team-id`），跟 `store/pinned.ts`/`store/shell.ts` 的持久化方式保持一致的实现模式
- [x] 1.3 初始化逻辑：`fetchMyTeams` 拉取完成后，若本地记录的 teamId 不在最新 `teams` 列表中，回退为 `teams.find(t => t.isPersonal)`
- [x] 1.4 暴露 `useCurrentTeam()` hook，返回当前团队的完整对象（不只是 id）

## 2. Sidebar 团队切换器

- [x] 2.1 新增 `TeamSwitcher.tsx` 组件：展示当前团队名称（个人 Team 显示"个人空间"）+ 下拉箭头，点击展开列出 `teams` 全部选项（基于现有 `DropdownMenu` 组件实现）
- [x] 2.2 选中某项时调用 `setCurrentTeamId`，关闭下拉，不做任何路由跳转
- [x] 2.3 将 `TeamSwitcher` 挂载到 `Sidebar.tsx` 最顶部（品牌区下方，搜索框上方）
- [x] 2.4 移除 `Sidebar.tsx` 原有的"团队"平铺列表区块；团队设置/团队工作区目录浏览两个入口保留，挪进了切换器下拉菜单每行的 hover 操作里，不丢功能

## 3. Sidebar 团队区块按当前团队筛选

- [x] 3.1 `Sidebar.tsx` 的"Wiki"分区（全部列表）改为 `wikis.filter(w => w.teamId === currentTeamId)` 后再渲染
- [x] 3.2 置顶列表保持不受 `currentTeamId` 筛选，已加注释说明这是有意的豁免
- [x] 3.3 "新建 Wiki"入口默认使用 `currentTeamId` 作为归属团队

## 4. Wiki 列表页 (`WikiList.tsx`) 收紧为当前团队视图

- [x] 4.1 读取 `currentTeamId`，对 `wikis` 做同样的 `teamId` 过滤后再渲染常规网格
- [x] 4.2 "已置顶"分区保持跨团队展示，常规网格应用过滤
- [x] 4.3 空态文案区分"当前团队没有 Wiki"与"整个账号没有任何 Wiki"

## 5. `CreateWikiDialog.tsx` 移除团队选择器

- [x] 5.1 移除团队选择的 `<select>` UI 及相关 `teamId` 本地 state
- [x] 5.2 创建请求直接使用 `currentTeam?.id` 作为 `teamId` 参数
- [x] 5.3 移除组件内不再需要的 `useTeamStore`/`fetchMyTeams` 调用，改用 `useCurrentTeam()`

## 6. 跨团队打开 Wiki 时静默跟随切换

- [x] 6.1 `WikiDetail.tsx` 加载 wiki 数据后，比较 `wiki.teamId` 与 `currentTeamId`，不一致时调用 `setCurrentTeamId(wiki.teamId)`
- [x] 6.2 用 `useEffect` 依赖 `[wiki, currentTeamId, setCurrentTeamId]`，只在 `wiki` 引用变化时重新判断，避免死循环

## 7. 验证

- [x] 7.1 `pnpm --filter web typecheck`
- [x] 7.2 浏览器验证：切换器能列出个人空间 + 已加入团队，切换后 Sidebar Wiki 列表与 `/wiki` 页面内容同步更新，URL 与 loading 状态均无变化
- [x] 7.3 浏览器验证：置顶列表在切换团队后仍展示其他团队的置顶条目（`已置顶（跨团队）`分区）
- [x] 7.4 浏览器验证：点击置顶列表中归属另一团队的 Wiki，Sidebar 顶部团队名静默切换为该 Wiki 所属团队，无确认弹窗（覆盖了"从任意路径打开跨团队 Wiki"这一类场景，全局搜索目前仍是 UI 骨架、无真实数据可点，机制已具备）
- [x] 7.5 浏览器验证：创建 Wiki 时不再出现团队选择器，弹窗文案明确提示归属团队，创建后的 Wiki 正确归属当前团队
- [x] 7.6 浏览器验证：清空 `localStorage` 后刷新，当前团队回退为个人空间
- [x] 7.7 清理验证过程中产生的测试数据（账号/团队/Wiki 已删除，截图已清理）
