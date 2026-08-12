## 1. 清理 `user-lookup` 死代码

- [x] 1.1 删除 `apps/api/src/handlers/user.ts` 里的 `lookupUserHandler`（保留 `meHandler`）
- [x] 1.2 删除 `apps/api/src/routes/user.ts` 里 `/users/lookup` 的路由挂载
- [x] 1.3 确认 `findUserByEmail`/`findUserByUsername` 仍被 `services/auth.ts` 使用，不删除这两个 model 函数
- [x] 1.4 删除 `apps/web/src/services/user.ts` 里的 `lookupUser`/`LookupUserResult`
- [x] 1.5 删除 `apps/web/src/store/wiki.ts` 里的 `lookupUser` action 及类型导出
- [x] 1.6 全局搜索确认没有遗留引用（`grep lookupUser`），跑 typecheck 确认两端干净

## 2. Wiki 归属团队转移 UI

- [x] 2.1 `WikiBasicInfoTab.tsx` 新增"转移团队"区块：仅 `canDelete`（即 OWNER）展示；下拉列出 `useTeamStore.teams` 中排除当前 `wiki.teamId` 的团队
- [x] 2.2 只有一个可选团队（即用户所属团队里排除当前团队后为空）时，整个区块不展示
- [x] 2.3 确认转移前弹出二次确认，文案包含"转移后不在新团队内的原有成员将立即失去访问权限"
- [x] 2.4 确认调用 `useWikiStore.transferWikiTeam`，成功后更新本地 `wiki.teamId` 展示（复用 store 已有的更新逻辑）

## 3. `SearchDialog` 接入真实 Wiki 搜索

- [x] 3.1 `SearchDialog.tsx` 读取 `useWikiStore.wikis`，输入框为空时展示 `usePinnedStore` 对应的置顶 Wiki 列表
- [x] 3.2 有关键字输入时，按 `name`/`description` 做大小写不敏感的包含匹配，实时过滤
- [x] 3.3 无匹配结果/无置顶时分别展示对应空态文案，空态文案注明"当前仅支持按 Wiki 名称/简介搜索"
- [x] 3.4 点击（或键盘选中回车）结果后关闭弹窗并 `navigate` 到 `/wiki/:wikiId`

## 4. `Home.tsx` 接入真实内容

- [x] 4.1 展示置顶 Wiki 分区（跨团队，复用 `usePinnedStore` + `useWikiStore.wikis` + 现有 `WikiCard`），没有置顶时不展示该分区
- [x] 4.2 展示当前团队 Wiki 分区（`useCurrentTeam()` + `teamId` 过滤），当前团队没有 Wiki 时展示引导创建的空态（含跳转 `/wiki` 或直接打开 `CreateWikiDialog` 的入口）
- [x] 4.3 两个分区都需要处理点击卡片进入设置面板 / 进入详情页的现有交互，不重新实现 `WikiCard` 逻辑

## 5. 移除 `Storage.tsx`，根路径重定向

- [x] 5.1 删除 `apps/web/src/pages/Storage.tsx`
- [x] 5.2 `router/routes.tsx` 里 `/` 对应路由改为重定向到 `/home`（用 `Navigate` 或路由配置的 redirect 能力，视现有路由类型定义支持的方式）
- [x] 5.3 确认 `Sidebar`/`PageHeader` 等组件里没有残留对 `/`（Storage）路由的引用（如导航高亮判断逻辑）

## 6. 用户资料编辑

- [x] 6.1 后端：`handlers/user.ts` 新增 `updateProfileHandler`，只解构请求体里的 `nickname`/`avatarUrl`/`bio` 三个字段传给已存在的 `upsertUserProfile`，显式忽略其他字段
- [x] 6.2 后端：`routes/user.ts` 新增 `PATCH /me/profile`，挂 `requireAuth`
- [x] 6.3 前端：`services/user.ts` 新增 `updateProfile(input)`，`store/profile.ts` 新增 `updateProfile` action（调用成功后用返回值更新本地 `profile`）
- [x] 6.4 前端：新建 `components/shell/ProfileSettingsDialog.tsx`：昵称 `Input`、简介 `textarea`、头像上传（复用 `CreateWikiDialog` 里"点击上传→调 `/uploads/images`→拿 URL"的现成逻辑），打开时预填当前 `profile` 数据
- [x] 6.5 前端：`UserMenu.tsx` 用户详情区域下方新增"编辑资料"菜单项，接入 `ProfileSettingsDialog` 的开关状态
- [x] 6.6 保存成功后确认 `UserMenu` 的 `displayName`/头像/`bio` 立即反映最新值，不需要刷新页面

## 7. 验证

- [x] 7.1 `pnpm --filter api typecheck` + `pnpm --filter web typecheck`
- [x] 7.2 curl 验证：`GET /users/lookup` 返回 404（路由已不存在）——已登录状态下确认，未登录时会先被其他路由的全局 `requireAuth` 拦成 401（既有架构行为，不是本次改动引入）
- [x] 7.3 浏览器验证：转移团队——有多个团队时选择目标团队转移成功，二次确认文案正确，原团队立即看不到该 Wiki、目标团队立即看到；过程中发现并修复了一个真实 bug：转移成功后设置面板不关闭会导致面板持有的 `wiki` 快照过期（转移目标下拉框还在用旧 `teamId` 过滤），已新增 `onTransferred` 回调在转移成功后关闭面板，修复后重新验证通过
- [x] 7.4 浏览器验证：搜索——输入 Wiki 名称/简介关键字能正确过滤，未输入时展示置顶空态提示，点击结果正确跳转并关闭弹窗
- [x] 7.5 浏览器验证：Home 页面展示当前团队 Wiki 网格，切换 Sidebar 团队后分区随之更新（本次验证账号未置顶任何 Wiki，跨团队置顶分区的"不展示"分支已覆盖；置顶展示分支复用的是已验证过的 `WikiList`/`Sidebar` 同款逻辑）
- [x] 7.6 浏览器验证：访问根路径 `/` 正确重定向到 `/home`
- [x] 7.7 curl 验证：`PATCH /me/profile` 请求体携带 `gender`/`phone` 时被忽略，查库确认 `gender` 仍为默认值 `UNKNOWN`、`phone`/`birthday` 仍为空；未登录调用返回 `401`
- [x] 7.8 浏览器验证：编辑资料——修改昵称后保存，`UserMenu` 立即反映最新值，无需刷新页面
- [x] 7.9 清理验证过程中产生的测试数据（测试账号/团队/Wiki 已删除，截图已清理）
