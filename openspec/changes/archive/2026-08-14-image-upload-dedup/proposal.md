## Why

当前 `uploadImage`（`apps/api/src/services/storage.ts`）每次上传都无条件转码并写入一个全新的 MinIO 对象，即使上传内容与已存在的对象完全相同（同一张封面图被反复上传、不同 Wiki/Document 恰好用了同一张图）也会各存一份，长期会造成对象存储的冗余占用与成本浪费。已经确认了内容寻址 + 引用计数的技术方案（sha256 命中即复用、未命中才转码落盘、替换/清空时释放引用、归零时尝试删除），现在落地成正式变更。

## What Changes

- 新增一张对象元数据表，记录已上传对象的 `sha256`（对上传原始文件内容计算）、所在 bucket/objectKey、大小、MIME 类型、引用计数 `refCount`
- 上传流程改为：先计算原始文件内容的 sha256 查表——**命中**则跳过转码与 MinIO 写入，直接复用已有对象的公开 URL，并将该记录 `refCount + 1`；**未命中**则维持现有的转码（统一转 WebP + 限宽 1600px）流程，写入 MinIO 成功后新建一条记录（`refCount = 1`）
- Wiki/Document 更新 `coverImage` 字段导致旧图不再被引用（替换为新图或清空）时，若旧 URL 命中某条记录，MUST 将其 `refCount - 1`；`refCount` 归零时尝试同步删除对应的 MinIO 对象，删除失败仅记录日志、不阻塞主流程、不回滚元数据变更
- 不改变现有上传接口 `POST /uploads/image` 的请求/响应结构，对前端消费方完全透明

## Capabilities

### New Capabilities
（无——本次不引入新的用户可感知能力，只是在已有能力内部增强存储效率）

### Modified Capabilities
- `file-upload`：新增"内容寻址去重"与"引用计数生命周期管理"相关需求，上传成功返回的 URL 语义不变（仍然是可直接公开访问的 URL），但相同内容的多次上传不再各自占用独立的存储对象

## Impact

- `apps/api/src/services/storage.ts`：`uploadImage` 增加去重查找/落库逻辑，新增 `releaseImageRef(url)` 供替换/清空封面图时调用
- `apps/api/prisma/models/`：新增 `UploadedObject`（或同名含义）模型 + 迁移
- `apps/api/src/models/`：新增对应的数据访问函数（按 sha256 查找、`refCount` 原子自增/自减）
- `apps/api/src/services/wiki.ts`、`apps/api/src/services/document.ts`：`updateWikiInfo`/`updateDocument` 涉及 `coverImage` 变更的路径接入 `releaseImageRef`
- 不涉及前端改动、不涉及现有 API 契约变更
