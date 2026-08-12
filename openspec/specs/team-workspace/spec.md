## Requirements

### Requirement: 注册时自动创建个人 Team
用户注册成功后，系统 MUST 在同一事务内自动为其创建一个 `Team`（标记为个人 Team），该用户是该 Team 唯一成员且角色为 `OWNER`；用户不需要任何额外操作即可拥有一个可用的组织归属容器。

#### Scenario: 注册后自动拥有个人 Team
- **WHEN** 用户完成注册
- **THEN** 系统创建一条 `Team` 记录（`isPersonal: true`）及一条对应的 `TeamMember` 记录（`role: OWNER`），用户可立即在该 Team 下创建 Wiki

### Requirement: 个人 Team 禁止删除与离开
标记为个人 Team 的 `Team` SHALL 不能被删除，其唯一成员也 SHALL 不能主动退出；系统 MUST 拒绝任何试图删除或退出个人 Team 的请求。

#### Scenario: 尝试删除个人 Team 被拒绝
- **WHEN** 用户请求删除自己的个人 Team
- **THEN** 系统返回 `403 forbidden`，该 Team 不被删除

#### Scenario: 尝试退出个人 Team 被拒绝
- **WHEN** 用户请求退出自己的个人 Team
- **THEN** 系统返回 `403 forbidden`，成员关系不变

### Requirement: 创建新的团队
已登录用户 SHALL 能创建一个新的（非个人）Team，创建成功后系统 MUST 原子性地将创建者写入为该 Team 的 `OWNER`。

#### Scenario: 创建团队成功
- **WHEN** 已登录用户提交合法的团队名称请求创建团队
- **THEN** 系统创建一条 `Team` 记录（`isPersonal: false`），并同时创建一条对应的 `TeamMember` 记录（`role: OWNER`）

### Requirement: 基于角色的团队成员管理
Team 只设 `OWNER`、`MEMBER` 两级角色；仅 `OWNER` 角色 SHALL 能变更成员角色、移除成员、生成邀请链接、删除团队；非 `OWNER` 请求这些操作 MUST 被拒绝。

#### Scenario: OWNER 移除成员
- **WHEN** Team 的 `OWNER` 移除一个非自己的 `MEMBER`
- **THEN** 该成员的 `TeamMember` 记录被删除

#### Scenario: 非 OWNER 无法管理团队
- **WHEN** `MEMBER` 请求移除其他成员、变更角色、生成邀请链接或删除团队
- **THEN** 系统均返回 `403 forbidden`

### Requirement: 团队至少保留一个 OWNER
系统 MUST 阻止导致团队没有任何 `OWNER` 成员的操作（移除最后一个 OWNER、将最后一个 OWNER 降级）；该检查与实际的更新/删除操作 MUST 在同一个数据库事务内完成，避免并发请求各自读到过期的 OWNER 数量而同时通过检查。

#### Scenario: 唯一 OWNER 尝试自我移除
- **WHEN** 团队当前只有一个 `OWNER`，该 `OWNER` 请求移除自己
- **THEN** 系统返回 `409 last_owner_required`，该成员记录不被删除

#### Scenario: 并发移除两个不同的 OWNER
- **WHEN** 团队恰好存在两个 `OWNER`，两个移除/降级其中一个 OWNER 的请求几乎同时到达
- **THEN** 系统 MUST 保证最终结果团队仍至少保留一个 `OWNER`，不允许两个请求都成功

### Requirement: 团队邀请链接
Team 的 `OWNER` SHALL 能生成邀请链接作为加入该 Team 的唯一途径，不支持按用户名/邮箱精确查找拉人入队；邀请链接 MUST 固定授予 `MEMBER` 角色，不支持直接生成授予 `OWNER` 的链接；创建者可配置是否限定使用次数与过期时间，且 MUST 能随时手动失效一条已生成的链接。

#### Scenario: 生成不限次数的邀请链接
- **WHEN** `OWNER` 生成一条邀请链接且不设置使用次数上限
- **THEN** 系统创建一条 `TeamInvite` 记录，`maxUses` 为空，在过期或被手动失效前可重复使用

#### Scenario: 生成限定次数的邀请链接
- **WHEN** `OWNER` 生成一条邀请链接并设置使用次数上限为 N
- **THEN** 该链接被使用达到 N 次后，后续兑换请求 MUST 被拒绝

#### Scenario: 手动失效邀请链接
- **WHEN** `OWNER` 对一条尚未过期的邀请链接执行失效操作
- **THEN** 该链接立即不可再被兑换，即使未到 `expiresAt`

### Requirement: 团队邀请链接的兑换
已登录用户 SHALL 能使用一条有效的邀请链接加入对应 Team；兑换 MUST 保证幂等——同一用户重复兑换同一条链接不产生重复的 `TeamMember` 记录，也不计入使用次数。

#### Scenario: 首次兑换成功
- **WHEN** 用户使用一条未过期、未达使用上限的邀请链接
- **THEN** 系统创建一条 `TeamMember` 记录（`role: MEMBER`）及一条 `TeamInviteRedemption` 记录，用户加入该 Team

#### Scenario: 已是成员重复兑换
- **WHEN** 用户使用一条已经加入过的团队的邀请链接
- **THEN** 系统直接返回成功（幂等），不产生新记录，不计入使用次数

#### Scenario: 兑换已过期或已失效的链接
- **WHEN** 用户使用一条已过期或已被手动失效的邀请链接
- **THEN** 系统返回 `410 invite_expired`，不加入团队

#### Scenario: 兑换已达使用上限的链接
- **WHEN** 用户使用一条已达 `maxUses` 上限的邀请链接
- **THEN** 系统返回 `410 invite_exhausted`，不加入团队

### Requirement: 退出团队时的工作区所有权转移
成员主动退出或被 `OWNER` 移除出 Team 时，系统 MUST 在同一事务内清理其在该 Team 下所有 Wiki 里的 `WikiMember` 记录；若清理前该用户是某个 Wiki 唯一显式的 `OWNER`，系统 MUST 同时将该 Wiki 的 `OWNER` 转移给当前 Team 中最早加入且仍持有 `OWNER` 角色的成员。

#### Scenario: 退出后清理非 OWNER 的 Wiki 成员身份
- **WHEN** `MEMBER` 退出 Team，且其在该 Team 下某个 Wiki 里是 `EDITOR`
- **THEN** 该 `WikiMember` 记录被删除，不触发任何转移

#### Scenario: 退出后触发唯一 OWNER 转移
- **WHEN** 用户退出 Team，且其是该 Team 下某个 Wiki 唯一显式的 `OWNER`
- **THEN** 系统删除其 `WikiMember` 记录的同时，为当前 Team 中最早加入且仍是 `OWNER` 的成员写入一条该 Wiki 的 `OWNER` 记录

#### Scenario: 目标用户已在该 Wiki 有较低角色记录
- **WHEN** 触发转移时，接收方（Team OWNER）已在该 Wiki 有一条 `EDITOR`/`VIEWER` 的 `WikiMember` 记录
- **THEN** 系统将该记录升级为 `OWNER`，不插入新行

### Requirement: 删除团队
非个人 Team 的 `OWNER` SHALL 能删除该团队；删除 MUST 要求二次确认，删除后该团队下所有 Wiki 及其成员关系 MUST 被级联删除。

#### Scenario: OWNER 删除多人团队
- **WHEN** 非个人团队的 `OWNER` 确认删除该团队
- **THEN** 该 `Team` 记录及其下所有 `Wiki`、`WikiMember`、`TeamMember` 记录被一并删除
