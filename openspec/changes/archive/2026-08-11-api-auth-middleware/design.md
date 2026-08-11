## Context

`services/token.ts` 已经实现了 `verifyAccessToken(token): Promise<AccessTokenPayload>`，能区分 `expired`/`algorithm_mismatch`/`invalid` 三类校验失败（`TokenVerificationError`）。`services/auth.ts` 里已有 `toPublicUser`（剔除 `password` 字段）和 `findUserById` 可以直接复用。目前 `app.ts` 只挂了 `/healthz`、`/auth` 两组路由，没有任何"受保护"路由的先例，需要建立一套后续所有受保护路由都会遵循的模式。

## Goals / Non-Goals

**Goals:**
- 提供一个可复用的 Express 中间件，统一完成"从请求中取 token → 校验 → 注入 `req.user` → 放行或 401"这条链路
- 401 的响应体格式与现有 `AuthError` 保持一致（`{ error: string }`），确保前端 `lib/http.ts` 里已经写好的 401 静默刷新重试逻辑不用改
- 提供 `/me` 作为该中间件的第一个使用示例和验证手段

**Non-Goals:**
- 不做基于角色/资源归属的权限判断（如"这篇文档是不是你的"）——这个中间件只回答"你是谁"，不回答"你能不能做这件事"；后者留给下一个 change（Wiki/Document API）在各自的 handler/service 里做 `ownerId` 判断
- 不涉及 Wiki/Document 的分享表（`role`/`WikiMember` 等）设计——这是下一个 change 的范围，本次只交付"谁在请求"这一层
- 不改动现有 `/auth/*` 路由的行为（它们本身不需要鉴权）

## Decisions

**1. 中间件从 `Authorization: Bearer <token>` header 读取 access token，不读 cookie**
- Access token 按现有设计（`web-auth-integration` change）只存前端内存，通过 `Authorization` header 携带，refresh token 才走 httpOnly cookie；两者职责分离，中间件只关心 access token，不动 `cookie-parser` 已经在处理的 refresh cookie
- 备选方案：也支持从某个 cookie 读 access token——现有前后端约定里 access token 从不落 cookie，没有这个需求，不做，避免多一条不会被用到的解析路径

**2. 校验失败统一映射为 `401 { error: 'unauthorized' }`，不区分 expired/invalid 暴露给客户端**
- `TokenVerificationError` 内部有 `kind`（`expired`/`algorithm_mismatch`/`invalid`），但中间件层不需要把这个细节暴露给前端——前端的重试逻辑只关心"401 就尝试 refresh"，不需要知道具体是哪种失败，减少攻击面（不透露 token 失效的具体原因）
- 服务端日志里可以记录 `kind` 便于排查，但响应体统一
- 备选方案：把 `kind` 一起返回（如 `{ error: 'token_expired' }`）——对前端当前的重试逻辑没有增量价值，且更容易被滥用来探测 token 状态，不采用

**3. `req.user` 通过 TypeScript 模块扩展（`declare global` 增强 `express.Request`）注入，不用 `res.locals`**
- `req.user?: { id: number }` 比 `res.locals.user` 在下游 handler 里用起来更符合 Express 生态里"鉴权信息挂在 `req` 上"的通行做法（如 Passport.js 的 `req.user`），类型声明放在中间件文件同目录的 `types.d.ts` 或直接在 `require-auth.ts` 里用 `declare global`
- 备选方案：新建一个独立的 `context.ts` 用 `AsyncLocalStorage` 传递用户信息——对于当前同步的 Express 中间件链路是过度设计，`req.user` 已经足够，不采用

**4. `/me` 接口直接复用 `findUserById` + `toPublicUser`，不新建 service 方法**
- `services/auth.ts` 里的 `toPublicUser` 目前是模块内部函数（未导出），需要导出后在新的 handler 里复用；`findUserById` 已经导出，可直接用
- 备选方案：在 `services/` 下新建 `user.ts` service 层——目前只有一个"查自己"的需求，直接在 handler 里组合现有函数即可，等后续 Wiki/Document 涉及更复杂的用户相关查询时再考虑拆 service 层，不过度提前抽象

**5. 中间件放在路由挂载层面按需应用，不做全局 `app.use`**
- `app.use(requireAuth)` 会把 `/healthz`、`/auth/*` 也保护起来，这是错的——`requireAuth` 应该在 `routes/index.ts` 里以 `router.use('/me', requireAuth, meRouter)` 或每个受保护路由单独挂载的方式应用，未来 Wiki/Document 路由同理
- 备选方案：白名单机制（全局挂载 + 排除列表）——路由一多容易漏加白名单导致误伤，显式按需挂载更安全、更符合最小权限原则

## Risks / Trade-offs

- [Risk] 如果后续开发者忘记给新路由加 `requireAuth`，会导致本该受保护的接口裸奔 → Mitigation：约定"新增业务路由默认视为受保护，除非显式说明公开"，并在下一个 change 的 tasks 里第一步就是挂中间件，形成习惯性检查点
- [Trade-off] 401 响应不区分失败原因，牺牲了一点调试便利性，换来更小的攻击面——服务端日志里仍保留 `kind` 用于排查，这个信息不对外暴露即可，可接受
- [Risk] `declare global` 扩展 `Express.Request` 如果类型声明文件没有被 `tsconfig` 正确 include，会导致 `req.user` 类型丢失（变成 `any` 或报错）→ Mitigation：实现时先跑一次 `pnpm typecheck` 确认下游 handler 里 `req.user` 类型推导正确
