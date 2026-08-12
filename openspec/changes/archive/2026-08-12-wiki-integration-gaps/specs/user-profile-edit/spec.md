## ADDED Requirements

### Requirement: 编辑资料入口
`UserMenu` 弹出菜单 SHALL 在用户详情区域下方提供"编辑资料"入口，点击后打开资料编辑弹窗；该入口 MUST 对所有已登录用户可见（不区分角色，编辑对象永远是当前登录用户自己）。

#### Scenario: 点击编辑资料入口
- **WHEN** 用户点击 `UserMenu` 中的"编辑资料"菜单项
- **THEN** 系统打开资料编辑弹窗，弹窗内预填当前用户已有的 `nickname`/`bio`/头像

### Requirement: 编辑并保存资料字段
资料编辑弹窗 SHALL 提供昵称、简介两个文本字段和一个头像上传入口；提交时系统 MUST 调用 `PATCH /me/profile` 保存这三个字段，请求体 MUST 只包含 `nickname`/`avatarUrl`/`bio`，MUST NOT 包含或透传 `gender`/`birthday`/`phone`。

#### Scenario: 保存昵称与简介
- **WHEN** 用户修改昵称和简介后提交保存
- **THEN** 系统调用保存接口，成功后弹窗关闭，`UserMenu` 展示的昵称/简介立即更新为最新值

#### Scenario: 上传并保存头像
- **WHEN** 用户在弹窗中选择一张本地图片作为头像并提交保存
- **THEN** 系统先调用现有的通用图片上传接口获得图片 URL，再连同昵称/简介一起提交保存；成功后 `UserMenu` 的头像立即更新为该图片

#### Scenario: 保存失败时的提示
- **WHEN** 保存请求失败（网络错误或服务端异常）
- **THEN** 弹窗保持打开并展示错误提示，用户输入的内容不丢失，可重新提交

### Requirement: 保存接口的字段边界
`PATCH /me/profile` SHALL 只接受并更新 `nickname`/`avatarUrl`/`bio` 三个字段；请求体中即使携带 `gender`/`birthday`/`phone` 等其他字段，系统 MUST 忽略这些字段，MUST NOT 更新它们的值。

#### Scenario: 请求体携带非白名单字段
- **WHEN** 请求体中包含 `gender`/`birthday`/`phone` 等字段
- **THEN** 系统忽略这些字段，只处理 `nickname`/`avatarUrl`/`bio`，对应数据库列的值不发生变化

#### Scenario: 未登录调用被拒绝
- **WHEN** 请求未携带有效的登录凭证
- **THEN** 系统返回 `401 unauthorized`，不执行任何更新
