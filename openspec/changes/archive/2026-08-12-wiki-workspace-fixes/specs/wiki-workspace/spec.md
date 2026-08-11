## MODIFIED Requirements

### Requirement: 工作区至少保留一个 OWNER
系统 MUST 阻止导致工作区没有任何 `OWNER` 成员的操作（移除最后一个 OWNER、将最后一个 OWNER 降级为其他角色）；该检查与实际的更新/删除操作 MUST 在同一个数据库事务内完成，避免两个并发请求各自读到"仍有多个 OWNER"的过期状态而同时通过检查，最终导致工作区没有任何 OWNER。

#### Scenario: 唯一 OWNER 尝试自我移除
- **WHEN** 工作区当前只有一个 `OWNER`，该 `OWNER` 请求移除自己这条成员记录
- **THEN** 系统返回 `409 last_owner_required`，该成员记录不被删除

#### Scenario: 唯一 OWNER 尝试自我降级
- **WHEN** 工作区当前只有一个 `OWNER`，该 `OWNER` 请求将自己的角色变更为 `EDITOR` 或 `VIEWER`
- **THEN** 系统返回 `409 last_owner_required`，角色不变

#### Scenario: 存在多个 OWNER 时允许降级/移除其中一个
- **WHEN** 工作区存在两个或以上 `OWNER`，其中一个请求移除自己或将自己降级
- **THEN** 系统允许该操作，工作区仍保留至少一个 `OWNER`

#### Scenario: 并发移除两个不同的 OWNER
- **WHEN** 工作区恰好存在两个 `OWNER`，两个移除/降级其中一个 OWNER 的请求几乎同时到达
- **THEN** 系统 MUST 保证最终结果工作区仍至少保留一个 `OWNER`——先完成的请求成功，后完成的请求在重新校验时读到最新的 OWNER 数量并返回 `409 last_owner_required`，不允许两个请求都成功

### Requirement: 工作区成员管理
仅 `OWNER` 角色 SHALL 能添加成员、变更成员角色、移除成员；添加成员时 MUST 通过 `userId` 指定一个已存在的注册用户，不支持邀请未注册用户；"该用户是否已是成员"的唯一性判断 MUST 由数据库唯一约束保证，不依赖"先查询再写入"的应用层预检查，确保并发场景下也不会产生重复的 `WikiMember` 记录。

#### Scenario: OWNER 添加已注册用户为成员
- **WHEN** `OWNER` 提交一个已存在且尚未是成员的 `userId` 及目标角色请求添加成员
- **THEN** 系统创建一条对应的 `WikiMember` 记录，返回成功

#### Scenario: 添加不存在的用户
- **WHEN** `OWNER` 提交的 `userId` 不对应任何已注册用户
- **THEN** 系统返回 `404 user_not_found`，不创建记录

#### Scenario: 添加已是成员的用户
- **WHEN** `OWNER` 提交的 `userId` 已经是该工作区的成员
- **THEN** 系统返回 `409 already_member`，不产生重复记录

#### Scenario: 并发重复添加同一成员
- **WHEN** 两个"添加同一个 `userId` 为成员"的请求几乎同时到达，且该用户此前不是成员
- **THEN** 系统 MUST 保证只有一条 `WikiMember` 记录被创建；先完成的请求返回成功，后完成的请求返回 `409 already_member`（而不是暴露数据库错误细节的 `500`）

#### Scenario: 非 OWNER 无法管理成员
- **WHEN** `EDITOR` 或 `VIEWER` 请求添加成员、变更角色或移除成员
- **THEN** 系统均返回 `403 forbidden`

#### Scenario: OWNER 变更成员角色
- **WHEN** `OWNER` 将某个 `EDITOR`/`VIEWER` 成员的角色变更为其他合法角色
- **THEN** 系统更新该成员的 `role` 字段

#### Scenario: OWNER 移除成员
- **WHEN** `OWNER` 移除一个非自己的成员
- **THEN** 该成员的 `WikiMember` 记录被删除，该用户不再能访问此工作区

## ADDED Requirements

### Requirement: 工作区拥有者引用与实际 OWNER 保持一致
`Wiki.ownerId` 字段 SHALL 在任意时刻都指向一个当前仍持有 `OWNER` 角色的成员（前提是该工作区至少存在一个 OWNER）；当针对 `ownerId` 当前指向的用户执行"变更角色为非 OWNER"或"移除该成员"操作、且操作后该用户不再是 OWNER 时，系统 MUST 自动将 `ownerId` 重新指向另一个仍持有 `OWNER` 角色的成员。

#### Scenario: 降级当前 ownerId 对应的用户
- **WHEN** 工作区存在多个 OWNER，其中被降级的这一位恰好是 `Wiki.ownerId` 当前指向的用户
- **THEN** 系统在降级生效的同时，将 `ownerId` 更新为另一个仍持有 `OWNER` 角色的成员

#### Scenario: 移除当前 ownerId 对应的用户
- **WHEN** 工作区存在多个 OWNER，其中被移除的这一位恰好是 `Wiki.ownerId` 当前指向的用户
- **THEN** 系统在移除该成员的同时，将 `ownerId` 更新为另一个仍持有 `OWNER` 角色的成员

#### Scenario: 变更的成员与 ownerId 无关
- **WHEN** 被变更角色或移除的成员不是 `Wiki.ownerId` 当前指向的用户，或操作后该用户仍是 OWNER
- **THEN** `ownerId` 字段保持不变
