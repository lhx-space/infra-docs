## ADDED Requirements

### Requirement: `/me` 响应包含用户资料字段
`GET /me` 的响应体 SHALL 在现有 `user` 字段基础上新增 `profile` 字段，取值来自当前用户关联的 `UserProfile` 记录，仅包含 `nickname`/`avatarUrl`/`bio` 三个字段；用户没有对应的 `UserProfile` 记录时，`profile` MUST 为 `null`，而不是报错或省略该字段。`profile` 中 MUST NOT 包含 `gender`/`birthday`/`phone` 等未被前端消费场景使用的字段。

#### Scenario: 用户存在完整 profile 记录
- **WHEN** 已登录用户请求 `GET /me`，且该用户在 `UserProfile` 表中有对应记录（`nickname`/`avatarUrl`/`bio` 均有值）
- **THEN** 响应体的 `profile` 字段包含这三个字段的当前值

#### Scenario: 用户没有 profile 记录
- **WHEN** 已登录用户请求 `GET /me`，且该用户在 `UserProfile` 表中没有对应记录
- **THEN** 响应体的 `profile` 字段为 `null`，请求仍返回 `200`，不报错

#### Scenario: profile 记录部分字段为空
- **WHEN** 已登录用户的 `UserProfile` 记录存在，但 `nickname`/`avatarUrl`/`bio` 中某些字段为空
- **THEN** 响应体的 `profile` 字段中对应字段返回 `null`，而不是省略该字段或报错

#### Scenario: 敏感字段不被返回
- **WHEN** 已登录用户请求 `GET /me`
- **THEN** 响应体的 `profile` 字段中不包含 `gender`/`birthday`/`phone` 字段

### Requirement: 用户菜单展示扩展后的资料信息
前端用户菜单（点击右上角头像后弹出的菜单）的用户详情区域 SHALL 在挂载时静默请求一次 `GET /me`，并使用返回的 `profile` 数据丰富展示：存在 `nickname` 时优先展示 `nickname`（否则展示 `username`）；存在 `bio` 时在详情区展示该简介文本。该请求失败时 MUST 静默降级，保留原有仅展示 `username`/`email` 的展示效果，不得阻塞菜单打开或展示错误提示。

#### Scenario: 拉取成功且资料完整
- **WHEN** 用户菜单挂载后成功拉取到 `profile`（`nickname`/`bio` 均有值）
- **THEN** 点击头像打开菜单后，详情区展示 `nickname` 作为主要名称、`email`，并展示 `bio` 文本

#### Scenario: 拉取成功但 profile 为 null
- **WHEN** 用户菜单挂载后成功请求 `/me`，但返回的 `profile` 为 `null`
- **THEN** 详情区展示效果与本次改动前一致：仅展示 `username`、`email`，不展示额外资料

#### Scenario: 请求失败时静默降级
- **WHEN** 用户菜单挂载时请求 `/me` 失败（网络错误或服务端异常）
- **THEN** 详情区仍正常展示已有的 `username`、`email`，不弹出错误提示，也不影响菜单的其他功能（Appearance 切换主题、退出登录）

### Requirement: 头像优先使用真实资料图片
用户头像的展示逻辑 SHALL 在 `profile.avatarUrl` 存在且非空时优先使用该地址渲染头像；当 `avatarUrl` 不存在或为空时，MUST 回退到现有的基于用户名确定性生成的头像逻辑。

#### Scenario: 存在真实头像地址
- **WHEN** 当前用户的 `profile.avatarUrl` 是一个非空字符串
- **THEN** 用户菜单触发按钮和详情区的头像图片均使用该地址渲染

#### Scenario: 不存在真实头像地址
- **WHEN** 当前用户的 `profile` 为 `null`，或 `profile.avatarUrl` 为 `null`/空字符串
- **THEN** 头像继续使用基于 `username` 生成的确定性头像（现有 `lib/avatar.ts` 逻辑），行为与本次改动前一致
