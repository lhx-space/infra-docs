## Requirements

### Requirement: 上传图片并获得可公开访问的 URL
已登录用户 SHALL 能上传一张图片文件，系统 MUST 将其存储到对象存储服务并返回一个可直接公开访问（无需鉴权）的 URL。

#### Scenario: 上传成功
- **WHEN** 已登录用户上传一个合法的图片文件
- **THEN** 系统将文件存入对象存储，返回该文件的公开访问 URL

#### Scenario: 上传后的 URL 可直接访问
- **WHEN** 客户端使用返回的 URL 发起请求（不携带任何鉴权信息）
- **THEN** 系统正常返回图片内容

### Requirement: 上传内容校验
系统 SHALL 校验上传内容的 MIME 类型仅限图片格式，且大小不超过预设上限；不满足条件的上传 MUST 被拒绝，不写入对象存储。

#### Scenario: 拒绝非图片类型
- **WHEN** 用户上传一个非图片类型的文件
- **THEN** 系统返回 `400 invalid_file_type`，不存储该文件

#### Scenario: 拒绝超出大小限制的文件
- **WHEN** 用户上传的文件大小超过预设上限（5MB）
- **THEN** 系统返回 `400 file_too_large`，不存储该文件

### Requirement: 上传图片统一转码为 WebP 并限制最大尺寸
系统 SHALL 在存储前将上传的图片统一转码为 WebP 格式，并将最长边缩放到不超过预设上限（1600px），不保留原始格式与原始尺寸。

#### Scenario: 上传 JPEG/PNG 落地为 WebP
- **WHEN** 用户上传一张 JPEG 或 PNG 格式的图片
- **THEN** 系统转码后存储的对象为 WebP 格式，返回的 URL 以 `.webp` 结尾

#### Scenario: 超大尺寸图片被等比缩放
- **WHEN** 用户上传的图片最长边超过 1600px
- **THEN** 系统按比例缩放到最长边不超过 1600px 后再存储，不改变宽高比

### Requirement: 上传接口需要登录
未登录请求 SHALL 无法调用上传接口，系统 MUST 返回 `401 unauthorized`。

#### Scenario: 未登录调用被拒绝
- **WHEN** 请求未携带有效的登录凭证
- **THEN** 系统返回 `401 unauthorized`，不执行任何上传
