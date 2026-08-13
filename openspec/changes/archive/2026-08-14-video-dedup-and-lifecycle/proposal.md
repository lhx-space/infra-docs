## Why

`video-hls-embed` 上线时故意选择了"`VideoAsset` 不做引用计数/去重"（design.md 决策 6），当时的判断是"视频上传大多是独占内容，去重价值低"。但实际验证发现两个更紧迫的问题：

1. **完全没有引用生命周期管理**：文档删除、视频节点被替换/移除时，对应的 `VideoAsset` 记录、MinIO 里的 HLS 产物、原始文件都不会被清理，是一个持续增长的存储泄漏（`image-upload-dedup` 已经给图片补上了这一层，视频从上线起就一直缺）。
2. **重复转码的代价比图片高得多**：命中一次图片去重省的是一次 `sharp` 转码；命中一次视频去重省的是一次完整的 `ffmpeg` HLS 转码（CPU 密集、耗时随视频长度线性增长）。手抖重复上传同一文件、或同一段视频被复用到多篇文档，都会触发完全重复的转码算力浪费。

同时，转码本身的 CPU 占用也有明确能改善的地方：`ffmpeg` 调用目前没有限制自身线程数，与 worker 的并发上限（2）叠加后容易在核心数有限的机器上互相抢核；转码 preset 用的是默认 `medium`，牺牲一部分画质换转码速度是合理的取舍。

## What Changes

- 视频上传接口 `POST /videos` 新增内容寻址去重：上传前计算原始文件哈希，命中已存在记录时跳过转码，直接复用现有资产并将引用计数加一（**BREAKING**：`VideoAsset` 新增 `sha256` 唯一索引与 `refCount` 字段，需要数据库迁移）
- 新增视频引用释放机制：文档内容更新/恢复历史版本导致某个 `assetId` 的引用次数减少时、文档被删除时，对应释放引用计数；引用计数归零时清理 `VideoAsset` 记录与其在对象存储中的全部产物（HLS 清单/分片/封面帧，以及可能残留的原始文件）
- 上传接口的响应体从固定 `{assetId, status: 'processing'}` 调整为返回资产的完整当前状态（`status`/`hlsUrl`/`posterUrl`/`error`），去重命中已就绪资产时前端可以立即展示，不需要再等一轮轮询（**BREAKING**：响应体新增字段，`status` 不再恒为 `processing`）
- `ffmpeg` 转码调用显式限制线程数（跟 worker 并发上限配合，避免同机器上多个转码任务互相抢核），并将编码 preset 从 `medium` 调整为更快的档位

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `video-transcoding`：新增"重复上传自动去重"与"引用计数生命周期管理"两条需求（对齐 `file-upload` 已有的图片去重模式）；修改"接受原始视频文件上传并立即返回处理中状态"这条需求的响应体约定，不再假定状态恒为 `processing`

## Impact

- **数据模型**：`VideoAsset` 新增 `sha256`（唯一）、`refCount`（默认 1）字段，需要一条新的 Prisma migration
- **后端**：`services/video.ts`（上传去重逻辑）、`models/video-asset.ts`（哈希查找/引用计数原子操作）、`services/document.ts`（`updateDocument`/`deleteDocument` 新增视频引用 diff 与释放调用）、`services/document-version.ts`（`restoreVersion` 同样需要 diff）、`jobs/process-video-transcode.ts`（`ffmpeg` 线程数/preset 调整）
- **前端**：`apps/web/src/services/video.ts`、`packages/tiptap-editor` 的 `video-uploader-registry.ts`/`slash-command.ts` 需要适配上传响应体的新字段（去重命中已就绪资产时直接插入 `ready` 状态节点，不再总是插入 `processing`）
- **无新增外部依赖**，复用现有的 sha256 计算方式（跟 `services/storage.ts` 图片去重同款）与 Prisma/MinIO 客户端
