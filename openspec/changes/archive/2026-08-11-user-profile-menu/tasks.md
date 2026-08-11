## 1. 后端：`/me` 响应扩展

- [x] 1.1 创建 `apps/api/src/services/user.ts`：新增 `toPublicProfile`（把 `UserProfile` 收窄成 `{ nickname, avatarUrl, bio }`，`null` 记录返回 `null`）和 `getMe(userId)`（用 `findUserWithProfile` 查询，组装成 `{ user: PublicUser, profile: PublicProfile | null }`）
- [x] 1.2 修改 `apps/api/src/handlers/user.ts`：`meHandler` 改为调用 `services/user.ts` 的 `getMe`，返回值直接作为响应体（保留现有 401 分支逻辑）

## 2. 前端：请求层与头像逻辑

- [x] 2.1 创建 `apps/web/src/services/user.ts`：定义 `UserProfile`/`MeResponse` 类型，`getMe(): Promise<MeResponse>` 调用 `http.get('/me')`
- [x] 2.2 修改 `apps/web/src/lib/avatar.ts`：`getAvatarUrl` 增加可选参数 `avatarUrl?: string | null`，有值时直接返回，否则走原有 DiceBear 生成逻辑

## 3. 前端：UserMenu 展示扩展

- [x] 3.1 修改 `apps/web/src/components/shell/UserMenu.tsx`：新增 `useEffect`，在 `user` 存在时挂载调用 `getMe()`，结果存入局部 `useState<UserProfile | null>`，请求失败时静默捕获（保持 `profile` 为 `null`，不抛出、不提示）；`useEffect` 依赖 `user?.id`（而非整个 `user` 对象，避免后台静默刷新 token 产生的新对象引发重复请求），并用局部 `ignore` 标记防止过期请求覆盖最新状态；`StrictMode` 下 effect 双调用导致的重复网络请求交给 `getMe()` 内置的 `dedupe()` 去重（见 2.3）
- [x] 2.3 创建 `apps/web/src/lib/request-dedupe.ts`：通用的 `dedupe(key, factory)` Singleflight 工具；`services/user.ts` 的 `getMe()` 用它包装；`lib/http.ts` 的 `refreshAccessToken` 同步重构为使用该工具（替换掉原来手写的模块级 `refreshPromise` 变量）
- [x] 3.2 `UserAvatar` 子组件增加 `avatarUrl` 参数并传给 `getAvatarUrl`，头像按钮和详情区两处调用都传入当前 `profile?.avatarUrl`
- [x] 3.3 详情区（`DropdownMenuLabel` 内）主要名称展示改为 `profile?.nickname ?? user.username`；`profile?.bio` 存在时在 email 下方追加一行展示（截断/多行省略，避免菜单过高）

## 4. 验证

- [x] 4.1 运行 `pnpm --filter api typecheck` 和 `pnpm --filter web typecheck`，确认无类型错误
- [x] 4.2 手动验证：给测试账号在数据库里插入一条 `UserProfile` 记录（nickname/avatarUrl/bio 都有值），登录后打开用户菜单，确认展示 nickname、bio、真实头像
- [x] 4.3 手动验证：换一个没有 `UserProfile` 记录的账号登录，确认用户菜单展示效果与改动前一致（username/email + 生成头像），不报错
- [x] 4.4 手动验证：临时改错 `VITE_API_BASE_URL` 或断网模拟 `/me` 请求失败，确认用户菜单仍能正常打开、展示已有 username/email，Appearance 和退出登录功能不受影响
