## MODIFIED Requirements

### Requirement: 工作区成员管理
仅 `OWNER` 角色 SHALL 能添加成员、变更成员角色、移除成员；添加成员时 MUST 通过 `userId` 指定一个已存在且已经是该工作区所属 Team 成员的用户，不再支持对任意已注册用户精确查找后直接添加；"该用户是否已是成员"的唯一性判断 MUST 由数据库唯一约束保证，不依赖"先查询再写入"的应用层预检查，确保并发场景下也不会产生重复的 `WikiMember` 记录。

#### Scenario: OWNER 添加同团队用户为成员
- **WHEN** `OWNER` 提交一个已经是该工作区所属 Team 成员、且尚未是该工作区成员的 `userId` 及目标角色请求添加成员
- **THEN** 系统创建一条对应的 `WikiMember` 记录，返回成功

#### Scenario: 添加不存在的用户
- **WHEN** `OWNER` 提交的 `userId` 不对应任何已注册用户
- **THEN** 系统返回 `404 user_not_found`，不创建记录

#### Scenario: 添加不属于同团队的用户
- **WHEN** `OWNER` 提交的 `userId` 对应一个已注册用户，但该用户不是这个工作区所属 Team 的成员
- **THEN** 系统返回 `404 user_not_found`（不额外区分"用户存在但不在团队"，避免泄露该用户是否存在），不创建记录

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

### Requirement: 工作区归属团队
每个 Wiki SHALL 归属且仅归属一个 Team（`teamId`）；创建工作区时 MUST 指定归属的 Team（默认为创建者的个人 Team），创建后可由该工作区的 `OWNER` 转移到创建者所属的另一个 Team。

#### Scenario: 创建工作区默认归属个人 Team
- **WHEN** 用户未指定归属 Team 直接创建工作区
- **THEN** 系统将该工作区的 `teamId` 设置为创建者的个人 Team

#### Scenario: 创建工作区指定归属团队
- **WHEN** 用户在创建工作区时指定一个自己所属的非个人 Team
- **THEN** 系统将该工作区的 `teamId` 设置为指定的 Team

#### Scenario: 转移工作区归属团队
- **WHEN** 工作区的 `OWNER` 将其转移到自己所属的另一个 Team
- **THEN** 系统更新该工作区的 `teamId`；转移后不在新 Team 内的原有 `WikiMember` 立即失去访问权限，需重新通过新 Team 的成员关系获得权限

### Requirement: 基于团队所有者的运行时权限兜底
系统 SHALL 在权限判断时，先检查当前用户是否为该 Wiki 所属 Team 的 `OWNER`，是则直接视为该 Wiki 的 `OWNER`，不再查询 `WikiMember` 表；此兜底权限 MUST 优先于该 Wiki 中任何显式的 `WikiMember` 记录（即使该记录的角色低于 `OWNER`），且不需要与 `WikiMember` 表做任何数据同步。

#### Scenario: 团队 OWNER 无需显式成员记录即可管理工作区
- **WHEN** 用户是某工作区所属 Team 的 `OWNER`，但在该工作区没有任何 `WikiMember` 记录
- **THEN** 系统仍允许其执行 `OWNER` 权限范围内的所有操作

#### Scenario: 团队 OWNER 的兜底权限不受低角色记录限制
- **WHEN** 用户是某工作区所属 Team 的 `OWNER`，同时在该工作区存在一条角色为 `VIEWER` 的 `WikiMember` 记录
- **THEN** 系统仍按 `OWNER` 权限放行，不受该 `VIEWER` 记录限制

#### Scenario: 失去团队 OWNER 身份后兜底权限立即失效
- **WHEN** 用户被降级为该 Team 的 `MEMBER`
- **THEN** 系统立即不再对其名下该 Team 的工作区给予兜底 `OWNER` 权限，其权限回退到该工作区显式 `WikiMember` 记录中的角色（如果没有记录则视为非成员）
