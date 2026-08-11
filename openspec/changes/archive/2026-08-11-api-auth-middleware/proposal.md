## Why

`user-auth` capability 已经实现了注册/登录/刷新/登出，能签发 access token，但目前没有任何路由真正校验这个 token——`services/token.ts` 里的 `verifyAccessToken` 从未被调用过。后续要做的 Wiki/Document 相关接口全部依赖"当前请求是谁发起的"，如果没有一个统一的鉴权中间件，每个新接口都要各自重复写 token 解析逻辑，容易出现遗漏或不一致的校验方式。这是解锁后续所有受保护接口开发的前置依赖，应该单独先做。

## What Changes

- 新增 Express 鉴权中间件 `requireAuth`：从 `Authorization: Bearer <token>` 中提取并校验 access token，校验通过后把 `{ id: userId }` 挂载到 `req.user`；校验失败统一返回 `401 { error: 'unauthorized' }`
- 扩展 Express 的 `Request` 类型声明，新增 `user?: { id: number }` 字段，供中间件写入、下游 handler 读取
- 新增一个受保护的验证性接口 `GET /me`：返回当前登录用户的公开信息（复用现有 `findUserById` + `toPublicUser` 逻辑），用于验证整条鉴权链路（前端已登录 → 携带 accessToken → 中间件放行 → 拿到用户信息）
- 统一 401 响应体格式（`{ error: string }`），与现有 `services/auth.ts` 里 `AuthError` 的错误体格式保持一致，前端 `lib/http.ts` 的 401 静默刷新重试逻辑无需改动即可复用

## Capabilities

### New Capabilities
- `api-request-auth`: 受保护路由的鉴权中间件（access token 校验、`req.user` 注入、401 响应契约），以及一个用于验证链路的 `/me` 接口

### Modified Capabilities
（无——不改动 `user-auth`/`auth-rate-limiting` 现有需求，仅新增一个独立的、被其他路由依赖的中间件能力）

## Impact

- **新增文件**：`apps/api/src/middlewares/require-auth.ts`（中间件本体）、类型声明扩展（`express` 的 `Request` 增强，可放在 `middlewares/require-auth.ts` 内或独立的 `types/express.d.ts`）
- **修改文件**：`apps/api/src/routes/index.ts`（挂载 `/me` 路由）；新增 `apps/api/src/handlers/user.ts`（或复用 `handlers/auth.ts`）承载 `/me` 的处理函数
- **不涉及数据库变更**：复用现有 `User` 表和 `services/token.ts` 的 `verifyAccessToken`，无需新增 Prisma migration
- **前端无需改动**：`http.ts` 已经在所有请求上带 `Authorization` header 并处理 401 重试，中间件行为与其约定的契约一致
- **后续依赖方**：下一个 change（Wiki/Document API）会直接复用 `requireAuth` 中间件保护其路由，本次是那部分工作的前置依赖
