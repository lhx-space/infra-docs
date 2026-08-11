## Why

`apps/api` 目前的 `routes/auth.ts` 只是路由占位（`login`/`logout`/`register` 直接返回 `{status: 'ok'}`），没有真正的鉴权逻辑；`env.ts` 里已经预留了 `JWT_SECRET` 但从未被使用。项目已经有 `User`/`UserProfile` 的 Prisma model 和数据访问层（`models/user.ts`），现在需要补齐密码加密、Token 签发/校验、Refresh Token 轮换与吊销、登录限流等能力，让 Auth 模块真正可用，并按既定分层（`routes` → `handlers` → `services` → `models`）落地。

## What Changes

- 新增密码哈希能力：使用 `bcryptjs` 对注册密码加密、登录时校验
- 新增 Access/Refresh Token 机制：使用 `jose` 签发与校验 JWT
  - Access Token：短期有效（15 分钟），HS256 签名，通过响应体返回，前端以 `Authorization: Bearer` 携带
  - Refresh Token：长期有效（7~30 天），存放于 `httpOnly` + `secure` + `sameSite=lax` 的 Cookie，`path` 限定为 `/auth/refresh`
  - Refresh Token 支持轮换（Rotation）：每次刷新即作废旧 token、发放新 token
  - Redis 中维护 Refresh Token 白名单（按 `userId` + `jti`），支撑主动吊销（登出/多端管理）
- 新增登录/注册接口限流：使用 `express-rate-limit`，仅在生产环境（`NODE_ENV=production`）启用，开发环境跳过
- 补齐真正的业务逻辑分层：
  - `services/auth.ts`：注册、登录、登出、刷新 Token 的业务规则
  - `handlers/auth.ts`：请求参数校验（`zod`）、调用 service、组装响应/错误、Cookie 读写
  - `routes/auth.ts`：仅保留路由挂载，移除内联的假实现
- **BREAKING**：`POST /auth/login`、`/auth/register`、`/auth/logout` 的响应结构从占位 `{status:'ok'}` 变为真实的用户/Token 结构；新增 `POST /auth/refresh` 接口

## Capabilities

### New Capabilities
- `user-auth`：用户注册、登录、登出、Access/Refresh Token 签发与刷新、Refresh Token 轮换与吊销、登录态所需的密码校验规则
- `auth-rate-limiting`：登录/注册接口的请求频率限制策略（生产环境启用、开发环境关闭）

### Modified Capabilities
（无——项目此前不存在任何已发布的 spec，均为新增）

## Impact

- **新增依赖**：`bcryptjs`、`@types/bcryptjs`（dev）、`jose`、`cookie-parser`、`@types/cookie-parser`（dev）、`express-rate-limit`
- **受影响代码**：
  - `apps/api/src/routes/auth.ts`（移除占位实现，改为纯路由挂载）
  - `apps/api/src/handlers/auth.ts`（新增）
  - `apps/api/src/services/auth.ts`（新增）
  - `apps/api/src/services/token.ts`（新增，封装 `jose` 签发/校验逻辑）
  - `apps/api/src/models/user.ts`（可能新增按需查询方法，复用现有 CRUD）
  - `apps/api/src/cache/index.ts`（复用 `getJSON`/`setJSON` 存 Refresh Token 白名单，或新增专用方法）
  - `apps/api/src/app.ts`（挂载 `cookie-parser` 中间件）
  - `apps/api/src/env.ts`（补充 Access/Refresh Token 有效期等配置项）
- **依赖的基础设施**：Redis（Refresh Token 白名单）、Postgres（现有 `users` 表，密码字段存 bcrypt hash）
- **不受影响**：`UserProfile` 表结构、现有 `db/prisma.ts` 连接层
