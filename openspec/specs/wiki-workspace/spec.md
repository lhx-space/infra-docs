## Requirements

### Requirement: 创建工作区
已登录用户 SHALL 能创建一个新的 Wiki 工作区；创建成功后，系统 MUST 原子性地（同一事务内）为创建者写入一条 `role: OWNER` 的 `WikiMember` 记录，创建者不需要额外操作即可获得完整权限。

#### Scenario: 创建工作区成功
- **WHEN** 已登录用户提交合法的工作区名称请求创建工作区
- **THEN** 系统创建一条 `Wiki` 记录（`ownerId` 为该用户），并同时创建一条对应的 `WikiMember` 记录（`role: OWNER`），返回该工作区详情

#### Scenario: 工作区名称校验失败
- **WHEN** 请求体中的工作区名称为空或超出长度限制
- **THEN** 系统返回 `400 invalid_input`，不创建任何记录

### Requirement: 工作区列表仅返回当前用户是成员的工作区
`GET /wikis` SHALL 只返回当前登录用户拥有 `WikiMember` 记录（任意角色）的工作区列表，不 MUST 返回其他用户的工作区，即使当前用户是全局唯一的注册用户。

#### Scenario: 列出我是成员的工作区
- **WHEN** 已登录用户请求工作区列表
- **THEN** 系统返回该用户在 `WikiMember` 表中所有关联的工作区，按工作区 `updatedAt` 倒序排列

#### Scenario: 不返回无关联的工作区
- **WHEN** 存在其他用户创建的、当前用户不是成员的工作区
- **THEN** 该工作区不出现在当前用户的列表结果中

### Requirement: 基于角色的工作区访问权限
系统 SHALL 引入三级角色 `OWNER > EDITOR > VIEWER`，通过 `WikiMember` 表判断当前用户对某个工作区的角色，而非仅依据 `Wiki.ownerId`。所有工作区相关接口 MUST 先校验请求者是否为该工作区的成员且角色满足接口所需的最低等级，不满足时统一返回 `403 forbidden`；工作区不存在时返回 `404 not_found`；请求者根本不是该工作区任何角色的成员时也返回 `403 forbidden`（不泄露工作区是否存在）。

#### Scenario: 非成员访问被拒绝
- **WHEN** 一个已登录但不是该工作区任何成员的用户请求该工作区的详情
- **THEN** 系统返回 `403 forbidden`

#### Scenario: VIEWER 可以查看详情
- **WHEN** 角色为 `VIEWER` 的成员请求工作区详情或成员列表
- **THEN** 系统正常返回数据

#### Scenario: VIEWER 不能重命名
- **WHEN** 角色为 `VIEWER` 的成员请求重命名工作区（`PATCH /wikis/:wikiId`）
- **THEN** 系统返回 `403 forbidden`，工作区名称不变

#### Scenario: EDITOR 可以重命名但不能删除
- **WHEN** 角色为 `EDITOR` 的成员请求重命名工作区
- **THEN** 系统更新工作区名称
- **WHEN** 该 `EDITOR` 请求删除工作区
- **THEN** 系统返回 `403 forbidden`，工作区不被删除

#### Scenario: OWNER 拥有全部权限
- **WHEN** 角色为 `OWNER` 的成员请求重命名、删除工作区，或管理成员（增删成员/变更角色）
- **THEN** 系统均允许执行对应操作

### Requirement: 删除工作区
仅 `OWNER` 角色 SHALL 能删除工作区；删除后，该工作区关联的所有 `WikiMember` 记录 MUST 被级联删除。

#### Scenario: OWNER 删除工作区
- **WHEN** `OWNER` 请求删除某工作区
- **THEN** 该 `Wiki` 记录及其所有 `WikiMember` 记录被一并删除，接口返回成功

#### Scenario: 非 OWNER 删除被拒绝
- **WHEN** `EDITOR` 或 `VIEWER` 请求删除工作区
- **THEN** 系统返回 `403 forbidden`，工作区不被删除

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
