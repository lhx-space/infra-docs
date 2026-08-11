## ADDED Requirements

### Requirement: 按标识符精确查找用户
已登录用户 SHALL 能通过一个精确的用户名或邮箱查找到对应的已注册用户；系统 MUST 按输入是否包含 `@` 判断走邮箱查找或用户名查找（与登录接口的判断方式一致），不支持模糊匹配或前缀搜索。

#### Scenario: 按用户名精确查找成功
- **WHEN** 已登录用户提交一个精确匹配某已注册账号 username 的标识符
- **THEN** 系统返回该用户的公开信息（id、username、avatarUrl）

#### Scenario: 按邮箱精确查找成功
- **WHEN** 已登录用户提交一个包含 `@` 且精确匹配某已注册账号 email 的标识符
- **THEN** 系统返回该用户的公开信息

#### Scenario: 查找不到对应用户
- **WHEN** 提交的标识符不匹配任何已注册用户
- **THEN** 系统返回 `404 user_not_found`

### Requirement: 查找结果不泄露敏感字段
查找接口返回的用户信息 SHALL 只包含公开字段（id、username、avatarUrl），MUST NOT 返回 email、密码哈希等敏感或可被用于验证账号存在性之外目的的字段。

#### Scenario: 返回体不含 email
- **WHEN** 查找成功并返回用户信息
- **THEN** 返回体中不包含 email 字段

### Requirement: 查找接口需要登录
未登录请求 SHALL 无法调用该查找接口，系统 MUST 返回 `401 unauthorized`。

#### Scenario: 未登录调用被拒绝
- **WHEN** 请求未携带有效的登录凭证
- **THEN** 系统返回 `401 unauthorized`，不执行任何查找
