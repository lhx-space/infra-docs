## 1. Dependencies & Config

- [x] 1.1 安装依赖：`bcryptjs`、`jose`、`cookie-parser`、`express-rate-limit`（dependencies）；`@types/bcryptjs`、`@types/cookie-parser`（devDependencies）
- [x] 1.2 在 `apps/api/src/env.ts` 补充配置项：`REFRESH_TOKEN_SECRET`（与 `JWT_SECRET` 分开用途）、`ACCESS_TOKEN_TTL`（默认 `15m`）、`REFRESH_TOKEN_TTL`（默认 `7d`）
- [x] 1.3 同步更新 `apps/api/.env`、`.env.example` 新增的环境变量

## 2. Token 签发/校验（jose 封装）

- [x] 2.1 新增 `apps/api/src/services/token.ts`：封装 `signAccessToken`/`verifyAccessToken`、`signRefreshToken`/`verifyRefreshToken`，显式指定 `algorithms: ['HS256']`
- [x] 2.2 Access Token payload 至少包含 `sub`（userId），Refresh Token payload 包含 `sub` + `jti`（用于 Redis 白名单查找）
- [x] 2.3 校验函数需区分"签名/过期无效"与"算法不匹配"两类错误，便于上层返回统一的 401

## 3. 密码哈希

- [x] 3.1 新增 `apps/api/src/services/password.ts`：封装 `hashPassword`（bcrypt salt rounds=10）、`verifyPassword`
- [x] 3.2 确认所有涉及密码的日志、错误信息不会输出明文或哈希值

## 4. Refresh Token 白名单（Redis）

- [x] 4.1 在 `apps/api/src/cache/index.ts` 新增 `allowRefreshToken(userId, jti, ttlSeconds)`、`isRefreshTokenAllowed(userId, jti)`、`revokeRefreshToken(userId, jti)`，Key 格式 `refresh:<userId>:<jti>`
- [x] 4.2 TTL 与 Refresh Token 有效期保持一致，避免 Redis Key 与 JWT 过期时间不同步

## 5. Service 层业务逻辑

- [x] 5.1 新增 `apps/api/src/services/auth.ts`：`register(input)` —— 校验 email/username 唯一性、哈希密码、调用 `models/user.ts` 创建用户
- [x] 5.2 `login(identifier, password)` —— 按 email 或 username 查用户、校验密码、签发 Access+Refresh Token、写入 Redis 白名单
- [x] 5.3 `refresh(refreshToken)` —— 校验 Refresh Token 签名与白名单、旧 token 出白名单、签发并记录新的 Access+Refresh Token（Rotation）
- [x] 5.4 `logout(refreshToken)` —— 从白名单移除对应 `jti`
- [x] 5.5 登录失败（用户不存在 / 密码错误）返回统一的通用错误，不区分两种失败原因

## 6. Handler 层（请求解析/响应组装）

- [x] 6.1 新增 `apps/api/src/handlers/auth.ts`：用 `zod` 定义 `register`/`login` 的请求体 schema 并校验
- [x] 6.2 `login`/`refresh` 成功后，设置 Refresh Token Cookie（`httpOnly`、`secure`（生产环境）、`sameSite=lax`、`path=/auth`【实现阶段由 `/auth/refresh` 修正为 `/auth`，否则 `/auth/logout` 读不到该 Cookie】、`maxAge` 对齐 Refresh Token TTL），响应体只返回 Access Token + 用户公开字段
- [x] 6.3 `logout` 处理函数清除 Refresh Token Cookie
- [x] 6.4 统一处理 service 层抛出的错误，映射到合适的 HTTP 状态码（400/401/409）

## 7. 路由层改造

- [x] 7.1 改写 `apps/api/src/routes/auth.ts`：移除占位实现，仅挂载 `handlers/auth.ts` 的处理函数
- [x] 7.2 新增 `POST /auth/refresh` 路由
- [x] 7.3 `login`、`register` 路由挂载限流中间件（见任务组 8）

## 8. 限流中间件

- [x] 8.1 新增 `apps/api/src/middlewares/rate-limit.ts`：基于 `express-rate-limit` 创建 `loginRateLimiter`（5 次/15 分钟）、`registerRateLimiter`（20 次/15 分钟）
- [x] 8.2 当 `env.NODE_ENV !== 'production'` 时，导出 no-op 中间件（直接 `next()`），保证 `routes/auth.ts` 里的挂载代码无需 if/else

## 9. App 接入

- [x] 9.1 在 `apps/api/src/app.ts` 挂载 `cookie-parser` 中间件（放在 `express.json()` 之后即可）

## 10. 验证

- [x] 10.1 `tsc --noEmit` 类型检查通过
- [x] 10.2 手动/脚本验证：注册 → 登录（拿到 Access Token + Refresh Cookie）→ 用 Refresh Token 刷新（旧 token 失效、拿到新 token）→ 登出（Refresh Token 失效，Cookie 被清除）全流程
- [x] 10.3 验证重复使用已轮换的 Refresh Token 会被拒绝（401）
- [x] 10.4 验证开发环境下连续多次调用 `/auth/login` 不会被限流；生产环境（`NODE_ENV=production` 本地模拟）超过阈值会返回 429
