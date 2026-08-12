## MODIFIED Requirements

### Requirement: 设置面板 - Members 与分享权限管控
设置面板 SHALL 提供成员列表展示、从所属 Team 成员列表中选择并添加成员、变更成员角色、移除成员的操作；这些操作 MUST 仅对当前用户角色为 `OWNER` 的工作区可见可用；添加成员的交互 MUST 从"输入用户名/邮箱查找"改为"从该工作区所属 Team 的成员列表中勾选"，不再提供精确查找输入框。

#### Scenario: OWNER 从团队成员列表添加成员
- **WHEN** `OWNER` 在设置面板打开"添加成员"，从所属 Team 的成员列表中勾选一个尚未是该工作区成员的人并确认
- **THEN** 系统将其添加为指定角色的工作区成员

#### Scenario: 团队成员列表为空时的提示
- **WHEN** `OWNER` 打开"添加成员"，但所属 Team 里没有任何其他尚未加入该工作区的成员
- **THEN** 系统展示"团队内暂无可添加的成员，可先邀请对方加入团队"的提示，并提供跳转到团队邀请链接的入口

#### Scenario: 非 OWNER 看不到成员管理入口
- **WHEN** 角色为 `EDITOR` 或 `VIEWER` 的用户打开设置面板
- **THEN** Members 相关的管理操作不展示或不可交互

## ADDED Requirements

### Requirement: 创建工作区时选择归属团队
创建工作区对话框 SHALL 提供归属 Team 的选择；当用户只属于一个 Team（默认是自己的个人 Team）时，系统 MUST 自动选中且不需要用户手动操作；当用户属于多个 Team 时，MUST 展示可选列表供用户选择。

#### Scenario: 仅属于个人 Team 时自动选中
- **WHEN** 用户只属于自己的个人 Team，打开创建工作区对话框
- **THEN** 归属 Team 自动选中为该个人 Team，不展示额外的选择操作

#### Scenario: 属于多个 Team 时展示选择列表
- **WHEN** 用户属于多个 Team，打开创建工作区对话框
- **THEN** 系统展示用户所属的全部 Team 供其选择归属
