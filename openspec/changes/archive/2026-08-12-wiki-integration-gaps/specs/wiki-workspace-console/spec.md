## MODIFIED Requirements

### Requirement: 设置面板 - Basic Information 管理
设置面板 SHALL 提供修改名称、修改简介、更换封面图的操作；仅 `OWNER` 角色 SHALL 能看到并执行删除工作区操作，删除前 MUST 要求二次确认；仅 `OWNER` 角色 SHALL 能看到并执行转移归属团队操作，转移前 MUST 明确告知"转移后不在新团队内的原有成员将立即失去访问权限"，并要求二次确认。

#### Scenario: EDITOR 及以上可修改基本信息
- **WHEN** 角色为 `EDITOR` 或 `OWNER` 的用户在设置面板修改名称/简介/封面图并提交
- **THEN** 系统调用对应接口更新工作区信息

#### Scenario: VIEWER 看不到基本信息编辑操作
- **WHEN** 角色为 `VIEWER` 的用户打开设置面板
- **THEN** 名称/简介/封面图的编辑控件不可交互或不展示

#### Scenario: OWNER 删除工作区需二次确认
- **WHEN** `OWNER` 点击删除工作区
- **THEN** 系统弹出二次确认提示，确认后才真正调用删除接口

#### Scenario: OWNER 转移归属团队
- **WHEN** `OWNER` 在设置面板选择一个自己所属的其他团队作为转移目标并确认
- **THEN** 系统弹出提示"转移后不在新团队内的原有成员将立即失去访问权限"，确认后调用转移接口，工作区归属更新为目标团队

#### Scenario: 只属于一个团队时不展示转移入口
- **WHEN** `OWNER` 只属于自己的个人 Team（没有其他可选团队）
- **THEN** 设置面板不展示"转移团队"操作区域

#### Scenario: 非 OWNER 看不到转移团队入口
- **WHEN** 角色为 `EDITOR` 或 `VIEWER` 的用户打开设置面板
- **THEN** 转移团队操作不展示或不可交互
