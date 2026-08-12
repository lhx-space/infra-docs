## REMOVED Requirements

### Requirement: 按标识符精确查找用户
**Reason**：Team 模型上线后，"添加 Wiki 成员"流程已经从"精确查找用户名/邮箱"改为"从所属 Team 成员列表勾选"（见 `team-workspace-model`），这个查找接口在前端已经零调用，继续保留只是死代码。
**Migration**：`GET /users/lookup` 接口、`lookupUserHandler`、前端 `services/user.ts` 的 `lookupUser`/`LookupUserResult`、`store/wiki.ts` 的 `lookupUser` action 一并删除；`findUserByEmail`/`findUserByUsername` 这两个 model 函数因登录逻辑（`services/auth.ts`）仍在使用，不删除。

### Requirement: 查找结果不泄露敏感字段
**Reason**：同上，随查找能力一起退役。
**Migration**：无需额外迁移，字段脱敏规则不再适用（接口已不存在）。

### Requirement: 查找接口需要登录
**Reason**：同上，随查找能力一起退役。
**Migration**：无需额外迁移。
