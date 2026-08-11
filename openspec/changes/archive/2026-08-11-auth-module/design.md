## Context

`apps/api` 采用四层结构：`routes`（路由挂载）→ `handlers`（请求解析/响应组装）→ `services`（业务规则）→ `models`（Prisma 数据访问）。`db/prisma.ts`（Prisma + `@prisma/adapter-pg`）与 `cache/index.ts`（ioredis，已有 `getJSON`/`setJSON`）两条连接层已就位。`users` 表（`models/user.ts`）已具备 `email`/`username`/`password`/`status` 字段，`password` 目前只是明文占位字段，尚未接入真实加密与登录态。

`routes/auth.ts` 当前是空壳实现，`env.ts` 已预留 `JWT_SECRET` 但未使用。本设计要把 Auth 模块从占位补齐为可用的注册/登录/登出/刷新流程。

## Goals / Non-Goals

**Goals:**
- 用 `bcryptjs` 完成密码哈希与校验
- 用 `jose` 签发/校验 Access Token（短期，Header 传递）与 Refresh Token（长期，Cookie 传递）
- 支持 Refresh Token 轮换（Rotation）与主动吊销（登出即失效）
- 登录/注册接口在生产环境启用限流，开发环境关闭
- 补齐 `handlers/auth.ts`、`services/auth.ts`，把业务逻辑从路由里挪出来

**Non-Goals:**
- 不做第三方 OAuth/SSO 登录（如微信、Google 登录）
- 不做多因素认证（MFA/2FA）
- 不做基于角色的权限系统（RBAC），本次只做"是否登录"这一层鉴权
- 不引入分布式限流存储（`rate-limit-redis`），当前单实例部署，内存 store 足够，后续多实例再补

## Decisions

### 1. JWT 库：`jose` 而非 `jsonwebtoken`
- `jose` 强制在签发/校验时显式声明算法，规避 `jsonwebtoken` 历史上出现过的 algorithm confusion 类漏洞
- `jose` 纯 TypeScript、内置类型，不需要额外 `@types` 包；`jsonwebtoken` 需要 `@types/jsonwebtoken`，且社区类型定义常滞后
- 若后续接入第三方 IdP（OIDC/JWKS 验签），`jose` 的 `createRemoteJWKSet` 可直接复用；`jsonwebtoken` 需另装 `jwks-rsa`
- 代价：API 略啰嗦（HMAC secret 需要 `new TextEncoder().encode(secret)` 转成 `Uint8Array`），可接受

### 2. Token 分工：Access Token（Header）+ Refresh Token（Cookie）
- Access Token：HS256，15 分钟有效期，放响应体，由前端存内存、以 `Authorization: Bearer` 携带 —— 不落 `localStorage`，降低 XSS 窃取长期凭证的风险
- Refresh Token：HS256，7~30 天有效期（用不同的签名密钥或相同密钥不同 `aud`/`typ` claim 区分，防止 Access Token 被误用为 Refresh Token），存 `httpOnly + secure + sameSite=lax` Cookie，`path` 限定为 `/auth`（**实现阶段修正**：最初设计为 `/auth/refresh`，但 `logout` 挂载在 `/auth/logout`，浏览器按 Cookie 路径匹配规则根本不会把 `path=/auth/refresh` 的 Cookie 带到 `/auth/logout`，导致登出无法读取、吊销 Refresh Token；改为 `/auth` 后仍限定在 auth 路由命名空间内，不暴露给全站其他路由，同时 `login`/`register`/`refresh`/`logout` 均可正常读取）
- 备选方案考虑过"两个 Token 都放 Cookie"：放弃，因为 Access Token 需要跨域场景下灵活附加到请求头，且高频请求场景 Cookie 自动携带会增加不必要的网络开销

### 3. Refresh Token 轮换 + Redis 白名单
- 每次 `/auth/refresh` 成功后，旧 Refresh Token 立即作废（从白名单删除），发放新的 Refresh Token（新 `jti`）—— 防止 Token 泄露后被无限期重放
- Redis Key 设计：`refresh:<userId>:<jti>` → `1`，TTL 与 Refresh Token 有效期一致，登出/轮换时主动 `DEL`
- 校验流程：先验 JWT 签名与过期时间，再查 Redis 确认该 `jti` 仍在白名单中，两者都通过才算有效 —— 纯校验 JWT 签名不足以支持"主动吊销"，因为 JWT 本身是无状态的

### 4. 限流：`express-rate-limit`，仅生产环境挂载
- 在 `middlewares/rate-limit.ts` 中按 `env.NODE_ENV === 'production'` 条件性导出中间件（开发环境导出 no-op passthrough），保持 `routes/auth.ts` 里的挂载代码始终一致，不需要 if/else 散落在路由文件里
- 限流维度：先按 IP 限制（`express-rate-limit` 默认维度），登录接口设置更严格的窗口（如 5 次/15 分钟），注册接口稍宽松
- 当前单实例部署，用默认内存 store；多实例部署时需迁移到 `rate-limit-redis`（记录为后续待办，不在本次范围）

### 5. 密码哈希：`bcryptjs`（纯 JS）而非 `bcrypt`（原生绑定）
- `bcrypt` 需要 node-gyp 原生编译，在容器化/CI 环境经常有编译坑；`bcryptjs` 纯 JS 实现，兼容性更好，性能差异在当前用户规模下可忽略
- Salt rounds 使用 10（业界常见默认值，兼顾安全与性能）

## Risks / Trade-offs

- **[风险] Refresh Token 存 Cookie，若前后端非同域部署，`sameSite=lax` 可能导致跨站请求丢失 Cookie** → 缓解：先按当前同域/子域部署假设实现；若未来前端与 API 完全跨域，需改 `sameSite=none` + `secure` + 额外 CSRF Token 防护，记录为 Open Question
- **[风险] Redis 白名单增加了 Refresh 流程对 Redis 可用性的依赖，Redis 不可用时用户无法刷新 Token** → 缓解：`cache/index.ts` 已有重试策略（8 次重试后放弃），Redis 短暂不可用时刷新失败，用户需要重新登录，属于可接受的降级；不做"Redis 挂了就跳过白名单校验"这种降级，避免安全性被牺牲
- **[风险] `bcryptjs` 纯 JS 实现，CPU 密集哈希在高并发注册/登录场景可能阻塞事件循环** → 缓解：当前用户规模小，暂不做 worker 线程池；若后续量级上升，可评估切换 `bcrypt` 原生版或引入队列
- **[Trade-off] 不引入 `rate-limit-redis`，多实例部署时限流形同虚设** → 已知限制，当前单实例部署下可接受，后续扩容时需补上

## Migration Plan

1. 安装依赖：`bcryptjs`、`@types/bcryptjs`、`jose`、`cookie-parser`、`@types/cookie-parser`、`express-rate-limit`
2. `env.ts` 补充配置项：`ACCESS_TOKEN_TTL`、`REFRESH_TOKEN_TTL`、`REFRESH_TOKEN_SECRET`（与 `JWT_SECRET` 区分用途，分别用于 Access/Refresh 签名）
3. 新增 `services/token.ts`（jose 签发/校验封装）、`services/auth.ts`（注册/登录/登出/刷新业务逻辑）
4. 新增 `handlers/auth.ts`（zod 校验入参、调用 service、组装响应、读写 Cookie）
5. 改造 `routes/auth.ts`：移除占位实现，挂载 `handlers/auth.ts` 中的处理函数 + 限流中间件，新增 `POST /auth/refresh` 路由
6. `app.ts` 挂载 `cookie-parser` 中间件
7. 无需数据库迁移（复用现有 `users` 表结构），`password` 字段语义从"明文占位"变为"bcrypt hash"
8. 回滚策略：本次改动集中在应用层代码与依赖，无破坏性 schema 变更，直接回退代码即可，无需数据回滚

## Open Questions

- 前端与 API 部署形态（同域 / 子域 / 完全跨域）尚未最终确认，影响 Cookie 的 `sameSite` 取值，暂按同域/子域假设实现
- 是否需要支持"多端同时登录"（多个 Refresh Token 并存）？当前设计按 `userId + jti` 存白名单，天然支持多端并存，登出默认只吊销当前这一枚 Refresh Token，不影响其他设备——如需"登出所有设备"需额外接口，本次不做
