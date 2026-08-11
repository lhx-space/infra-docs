## 1. 中间件实现

- [x] 1.1 扩展 `apps/api/src/services/auth.ts`：导出 `toPublicUser`（当前是模块内部函数），供 `/me` handler 复用
- [x] 1.2 创建 `apps/api/src/middlewares/require-auth.ts`：实现 `requireAuth` 中间件——解析 `Authorization: Bearer <token>`，调用 `services/token.ts` 的 `verifyAccessToken` 校验，成功则将 `{ id: Number(sub) }` 写入 `req.user` 并 `next()`，失败统一返回 `401 { error: 'unauthorized' }`
- [x] 1.3 在同文件或独立的类型声明文件中用 `declare global` 扩展 `Express.Request`，新增 `user?: { id: number }` 字段

## 2. `/me` 接口

- [x] 2.1 创建 `apps/api/src/handlers/user.ts`：实现 `meHandler`，读取 `req.user.id`，调用 `findUserById` 查询用户，不存在则返回 `401 { error: 'unauthorized' }`，存在则调用 `toPublicUser` 后返回 `200 { user }`
- [x] 2.2 创建 `apps/api/src/routes/user.ts`：定义 `userRouter`，挂载 `GET /me` → `[requireAuth, meHandler]`
- [x] 2.3 在 `apps/api/src/routes/index.ts` 中挂载 `router.use('/me', userRouter)`（或 `router.use(userRouter)` 视路由前缀写法而定），确认不影响现有 `/healthz`、`/auth` 路由

## 3. 验证

- [x] 3.1 运行 `pnpm --filter api typecheck`，确认 `req.user` 类型声明生效、无类型错误
- [x] 3.2 手动验证：不带 `Authorization` header 请求 `GET /me`，确认返回 `401 { error: 'unauthorized' }`
- [x] 3.3 手动验证：先调用 `/auth/login` 拿到 `accessToken`，带上 `Authorization: Bearer <accessToken>` 请求 `GET /me`，确认返回 `200` 且响应体不含 `password` 字段
- [x] 3.4 手动验证：使用一个已过期或篡改过的 token 请求 `GET /me`，确认返回 `401 { error: 'unauthorized' }`（而不是 500）
- [x] 3.5 确认 `/healthz`、`/auth/register`、`/auth/login` 等现有接口行为不受影响（无需携带 `Authorization` header 仍可正常访问）
