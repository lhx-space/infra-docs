## ADDED Requirements

### Requirement: 团队成员可浏览团队内工作区目录（仅元信息）
Team 成员 SHALL 能查看该 Team 下所有 Wiki 的存在性与元信息（名称、简介、封面、是否已是我的成员、是否可申请加入），系统 MUST NOT 在该目录接口中返回任何 Wiki 内容（文档列表/正文）或成员名单；此接口与"仅返回我已加入的工作区"的现有列表接口分开，互不影响。

#### Scenario: 查看团队内的工作区目录
- **WHEN** Team 成员请求 `GET /teams/:teamId/wikis`
- **THEN** 系统返回该 Team 下所有 Wiki 的元信息列表，每项标注当前用户是否已是成员

#### Scenario: 目录不泄露内容与成员信息
- **WHEN** 请求返回该目录列表
- **THEN** 返回体 MUST NOT 包含任何文档数据或该 Wiki 的 `WikiMember` 列表

#### Scenario: 非该 Team 成员无法查看
- **WHEN** 一个不是该 Team 成员的已登录用户请求该目录接口
- **THEN** 系统返回 `403 forbidden`

### Requirement: 工作区分享链接
Wiki 的 `OWNER` 或 `EDITOR` SHALL 能生成一条分享链接并指定该链接授予的角色；系统 MUST 校验指定角色不超过创建者当前在该 Wiki 的角色，超出则拒绝；分享链接 MUST 仅对与该 Wiki 同属一个 Team 的成员有效。

#### Scenario: 生成不超过自身角色的分享链接
- **WHEN** 角色为 `EDITOR` 的用户生成一条授予 `VIEWER` 或 `EDITOR` 的分享链接
- **THEN** 系统创建对应的 `WikiShareLink` 记录

#### Scenario: 生成超出自身角色的分享链接被拒绝
- **WHEN** 角色为 `EDITOR` 的用户尝试生成一条授予 `OWNER` 的分享链接
- **THEN** 系统返回 `403 forbidden`，不创建该链接

### Requirement: 工作区分享链接的兑换
已登录用户 SHALL 能使用一条有效的分享链接获得对应角色；若该用户不是这条链接所属 Wiki 的 Team 成员，系统 MUST 拒绝并提示需要先加入对应团队，不允许绕过团队边界直接获得工作区权限。

#### Scenario: 团队成员兑换分享链接成功
- **WHEN** 该 Wiki 所属 Team 的成员使用一条未过期、未失效的分享链接
- **THEN** 系统为其创建（或升级）对应角色的 `WikiMember` 记录

#### Scenario: 非团队成员兑换分享链接被拒绝
- **WHEN** 一个不属于该 Wiki 所属 Team 的用户使用分享链接
- **THEN** 系统拒绝并返回需要先加入对应团队的提示，不创建 `WikiMember` 记录

### Requirement: 工作区申请加入开关
Wiki 的 `allowJoinRequest` 开关 SHALL 默认关闭；仅 `OWNER` 能开启或关闭该开关；开关关闭时，该 Wiki 在团队工作区目录中不展示"申请加入"入口。

#### Scenario: 默认关闭申请入口
- **WHEN** 一个未被 OWNER 显式开启过申请开关的 Wiki 出现在团队工作区目录中
- **THEN** 该 Wiki 条目不展示"申请加入"入口

#### Scenario: OWNER 开启申请入口
- **WHEN** `OWNER` 将 `allowJoinRequest` 设置为开启
- **THEN** 该 Wiki 此后在团队工作区目录中展示"申请加入"入口

### Requirement: 申请加入工作区
Team 成员且尚非该 Wiki 成员的用户 SHALL 能对已开启申请开关的 Wiki 发起加入申请；被拒绝后 MUST 有冷却时间（默认 24 小时）才能再次申请；系统 MUST 保证同一用户对同一 Wiki 至多存在一条有效（非历史覆盖）的申请记录。

#### Scenario: 发起申请成功
- **WHEN** Team 成员对一个已开启申请开关且自己尚非成员的 Wiki 发起申请
- **THEN** 系统创建一条 `status: PENDING` 的 `WikiJoinRequest` 记录

#### Scenario: 冷却期内重复申请被拒绝
- **WHEN** 用户在被拒绝后 24 小时内对同一 Wiki 再次申请
- **THEN** 系统返回 `429 too_many_requests`，不更新申请记录

#### Scenario: 未开启申请开关时无法申请
- **WHEN** 用户对一个 `allowJoinRequest` 为关闭状态的 Wiki 发起申请
- **THEN** 系统返回 `403 forbidden`

### Requirement: 审批加入申请
该 Wiki 任意一个 `OWNER` SHALL 能批准或拒绝待处理的加入申请；审批操作 MUST 通过条件更新（仅当申请当前状态为 `PENDING` 时才允许变更）实现，确保两个 `OWNER` 几乎同时处理同一条申请时不会互相覆盖对方的结果。

#### Scenario: 批准申请
- **WHEN** `OWNER` 批准一条 `status: PENDING` 的申请
- **THEN** 系统将该记录状态更新为 `APPROVED`，并为申请人创建对应角色的 `WikiMember` 记录

#### Scenario: 两个 OWNER 并发处理同一条申请
- **WHEN** 两个 `OWNER` 几乎同时对同一条 `PENDING` 申请分别执行批准和拒绝
- **THEN** 系统 MUST 保证只有一个操作生效（先完成的生效），后完成的操作因状态已变化而返回冲突提示，不会出现状态被覆盖或该用户同时获得成员身份又被记为拒绝的矛盾结果
