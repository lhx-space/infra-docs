## Why

现有模型下，每个 Wiki 独立管理成员，添加成员必须精确输入对方的用户名或邮箱（不好记，体验差），也没有"一群人共享多个 Wiki"的容器概念，更没有分享链接、申请加入这类协作场景里常见的能力。需要引入一层轻量的租户（Team）概念，把"人从哪来"（加入 Team）和"权限判断"（对具体 Wiki 的角色）解耦，同时补上 Wiki 级别的分享与申请能力，为后续多人协同编辑打好组织架构的地基。

## What Changes

- 新增 `Team` 实体：每个用户注册时自动拥有一个"个人 Team"，作为唯一的组织归属容器——个人即团队，没有"个人模式"和"团队模式"两套概念，也不需要任何转换操作
- Team 支持邀请链接（可选一次性或多次使用、可设过期时间、可手动失效重新生成），作为加入 Team 的唯一方式，不支持精确查找拉人入队
- `Wiki` 新增归属 `teamId`（必填）；**BREAKING**：添加 Wiki 成员的方式收紧为"该用户必须已经是该 Wiki 所属 Team 的成员"，不再支持对任意已注册用户精确查找后直接添加
- 权限判断新增一条运行时规则：Team 的 `OWNER` 对该 Team 下所有 Wiki 默认视为 `OWNER`，不落库、不需要跟 Wiki 层做任何同步
- 成员退出（或被移除出）Team 时，若其是某个 Wiki 唯一的显式 `OWNER`，系统在同一事务内自动将该 Wiki 的 `OWNER` 转移给当前 Team 的 `OWNER`
- 新增 Wiki 分享链接：分享者只能生成一个不超过自己当前角色的链接，且该链接只对同一 Team 内的成员生效
- 新增"申请加入" Wiki 机制：Team 成员能看到该 Team 下有哪些 Wiki（仅名称/简介/封面等元信息），但看不到具体内容或成员名单；Wiki 的 `OWNER` 需要显式开启才允许申请，审批走条件更新防止并发下的状态覆盖
- 现有 Wiki 设置面板里"按用户名/邮箱查找添加成员"的交互，改为"从所属 Team 成员列表中勾选"

## Capabilities

### New Capabilities
- `team-workspace`：Team 的创建（含注册时自动创建个人 Team）、成员管理（`OWNER`/`MEMBER` 角色、唯一 OWNER 保护）、邀请链接的生成/使用/失效、退出与删除的生命周期规则（含 Wiki OWNER 自动转移）
- `wiki-sharing`：Wiki 级别的分享链接（角色不超过创建者、限定同 Team 内生效）、申请加入机制（仅元信息可见、审批流程、并发安全）、Team 成员对 Team 内 Wiki 的"存在性可见但内容不可见"边界

### Modified Capabilities
- `wiki-workspace`：`Wiki` 新增 `teamId` 归属；「工作区成员管理」调整为要求目标用户已是所属 Team 的成员；权限判断新增 Team `OWNER` 运行时兜底规则；新增"退出 Team 时 Wiki `OWNER` 自动转移"的行为
- `wiki-workspace-console`：「设置面板 - Members 与分享权限管控」的添加成员交互调整为从 Team 成员列表选择，不再走精确查找

## Impact

- **数据库**：新增 `Team`/`TeamMember`/`TeamInvite`/`TeamInviteRedemption`/`WikiShareLink`/`WikiJoinRequest` 六张表；`Wiki` 新增 `teamId`（必填）、`allowJoinRequest` 字段；需要一次性数据迁移——为每个现有用户创建个人 Team，并回填现有 `Wiki.teamId`
- **后端**：`requireWikiRole` 中间件改造为两级查询（先判断 Team `OWNER`，再查 `WikiMember`）；`addWikiMember` 的校验规则收紧为"目标用户必须是同 Team 成员"；新增 Team、邀请链接、分享链接、申请加入相关的 handler/service/route
- **前端**：Wiki 创建与设置面板的"添加成员"UI 改造为从 Team 成员列表勾选；新增 Team 管理入口、邀请链接生成与兑换页面、Wiki 分享入口、申请加入入口
- **`user-lookup` 接口**：不再被 Wiki 成员管理调用，本次不做任何改动或废弃处理，留作后续候选清理项
