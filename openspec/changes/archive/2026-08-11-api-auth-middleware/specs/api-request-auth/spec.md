## ADDED Requirements

### Requirement: 受保护路由鉴权中间件
系统 SHALL 提供一个可复用的鉴权中间件（`requireAuth`），用于校验请求是否携带有效的 access token；该中间件 MUST 从 `Authorization` header 中按 `Bearer <token>` 格式提取 token；校验通过后 MUST 将 `{ id: number }` 形式的用户标识挂载到 `req.user`，供下游 handler 读取；该中间件 MUST 显式挂载在需要保护的路由上，而不是全局应用到所有路由。

#### Scenario: 携带有效 access token 的请求被放行
- **WHEN** 请求携带 `Authorization: Bearer <有效的 access token>` 访问一个挂载了 `requireAuth` 的路由
- **THEN** 中间件放行请求，`req.user.id` 等于该 token 对应的用户 id，下游 handler 正常执行

#### Scenario: 缺少 Authorization header 被拒绝
- **WHEN** 请求未携带 `Authorization` header 访问一个挂载了 `requireAuth` 的路由
- **THEN** 系统返回 `401` 状态码，响应体为 `{ "error": "unauthorized" }`

#### Scenario: Authorization header 格式不是 Bearer 被拒绝
- **WHEN** 请求携带的 `Authorization` header 不符合 `Bearer <token>` 格式（如缺少 `Bearer ` 前缀、或为空 token）
- **THEN** 系统返回 `401` 状态码，响应体为 `{ "error": "unauthorized" }`

#### Scenario: access token 过期或签名无效被拒绝
- **WHEN** 请求携带的 access token 已过期，或签名校验失败，或算法不匹配
- **THEN** 系统返回 `401` 状态码，响应体统一为 `{ "error": "unauthorized" }`，不区分具体失败原因

#### Scenario: 未挂载中间件的路由不受影响
- **WHEN** 请求访问 `/healthz` 或 `/auth/*` 等未挂载 `requireAuth` 的现有路由
- **THEN** 请求行为与本次改动之前完全一致，不要求携带 `Authorization` header

### Requirement: 当前登录用户信息查询接口
系统 SHALL 提供一个受 `requireAuth` 保护的 `GET /me` 接口，返回当前登录用户的公开信息（不包含密码字段），用于验证鉴权中间件链路是否正常工作。

#### Scenario: 已登录用户查询自己的信息
- **WHEN** 已登录用户携带有效 access token 请求 `GET /me`
- **THEN** 系统返回 `200` 状态码，响应体包含该用户的 `id/email/username/status/createdAt/updatedAt` 字段，不包含 `password` 字段

#### Scenario: 未登录用户请求 /me 被拒绝
- **WHEN** 请求未携带有效 access token 访问 `GET /me`
- **THEN** 系统返回 `401` 状态码，响应体为 `{ "error": "unauthorized" }`

#### Scenario: access token 对应的用户已被删除
- **WHEN** access token 校验通过，但其 `sub` 对应的用户在数据库中已不存在
- **THEN** 系统返回 `401` 状态码，响应体为 `{ "error": "unauthorized" }`，而不是 `404` 或 `500`
