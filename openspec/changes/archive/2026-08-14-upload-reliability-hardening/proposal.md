## Why

真实验证过程中系统性地核对了当前"文件上传"从上传到废弃全链路能覆盖到的环节，确认存在以下几类真实缺口（均有代码依据，非猜测）：

1. **视频孤儿资产**：视频上传成功后，如果用户在结果被真正插入并保存进文档之前刷新/关闭页面（项目里没有任何 `beforeunload` 监听），这次上传会产生一条永久孤儿的 `VideoAsset`（真实转码产物 + 真实对象存储占用 + 真实烧掉一次 `ffmpeg` CPU）——`video-dedup-and-lifecycle` 的引用计数模型只在"发生一次自减且减到 0"时才触发清理，一条创建时就是 `refCount = 0`、从未被谁减过的记录永远不会被任何现有代码路径捡到。
2. **正文图片零回收（比孤儿视频更基础、更普遍的缺口）**：图片上传（`services/storage.ts` 的 `uploadImage`）走的是"上传即认领"（`refCount` 上传成功那一刻就 `+1`），但 `services/document.ts` 只对 `coverImage`（单一字段）维护了引用计数的增减，**对文档正文里插入的图片节点从未做过任何等价的内容差量追踪**（全局搜不到 `countImageAssetOccurrences`/`diffImageAssetOccurrences` 这类函数）。这意味着编辑器里每一次通过工具栏/粘贴插入到正文的图片，只要上传成功，`refCount` 就会永久 `+1`、此后不管这张图片是被从文档删掉还是整篇文档被删除都不会再减少——这不是边缘竟态，是 100% 必然发生、随插入次数线性增长的泄漏。
3. **一次性调试脚本"卡住不退出"的根因**：排查过程中用 BullMQ 源码验证清楚，外部传入连接（`shared: true`）的 `close()` 是空操作、不会真正断开底层连接——这是本项目 `queue/connection.ts` 单例复用模式下必然存在的行为，不是 bug，但缺一个让后续调试脚本不再重复踩坑的官方退出方式。
4. 讨论过程中同时确认了另一批**明确不在本次范围内、但值得记录留痕**的更大量级问题（刷新页面无提示已归入第 1/2 点解决；其余见下方 Non-Goals）：断点续传/分片上传、上传失败自动重试（POST 非幂等，故意不做）、离线上传队列、上传进度条。

## What Changes

- 新增视频孤儿资产清理机制：定期回收"创建超过一定时间窗口、`refCount` 仍为 0"的 `VideoAsset`，同时清理其对象存储产物（复用已有的 `deleteVideoAssetArtifacts`）。清理逻辑对"仍处于 `processing` 状态"的孤儿同样安全（worker 侧已经能优雅处理资产在转码中被删除的竟态，见 `models/video-asset.ts` 的 `updateOrNullIfMissing`）。
- 新增正文图片引用生命周期管理：仿照视频的 `countVideoAssetOccurrences`/`diffVideoAssetOccurrences`（`utils/video-content.ts`），新增等价的图片版本，在 `updateDocument`/`deleteDocument` 里按文档正文内容的图片节点出现次数差量维护 `UploadedObject.refCount`；`releaseImageRef`/新增 `acquireImageRef` 支持按次数增减（现有 `releaseImageRef` 只支持单次 `-1`，需要扩展签名）。
- 新增编辑器"上传进行中离开页面"提示：视频/图片的上传请求已发出、但结果尚未插入编辑器并保存这段窗口内，监听 `beforeunload` 提示用户离开会丢失这次上传；一旦上传结果已插入节点，不再需要这个提示。
- 新增 `queue/connection.ts` 的一次性脚本专用退出辅助方法 + 代码注释（纯内部工程改进，不产生用户可见的行为变化，不写入任何 spec 场景）。

## Capabilities

### New Capabilities

（无新增能力）

### Modified Capabilities

- `video-transcoding`：新增"孤儿转码资产清理"需求。
- `file-upload`：新增"正文图片引用生命周期管理"需求。
- `document-editor`：新增"上传进行中离开页面提示"需求。

## Impact

- `apps/api/src/jobs/`（或新增一个轻量清理任务）、`apps/api/src/models/video-asset.ts`、`apps/api/src/services/video.ts`、`apps/api/src/queue/`：孤儿清理任务与调度。
- `apps/api/src/utils/`：新增图片内容差量统计工具（镜像 `video-content.ts`）；`apps/api/src/models/uploaded-object.ts`、`apps/api/src/services/storage.ts`：`releaseImageRef` 扩展支持按次数、新增 `acquireImageRef`；`apps/api/src/services/document.ts`：`updateDocument`/`deleteDocument` 接入正文图片引用差量。
- `apps/api/src/queue/connection.ts`：新增退出辅助方法 + 注释（无行为变化）。
- `packages/tiptap-editor/src/utils/video-uploader-registry.ts`、`image-uploader-registry.ts`（或新增一个共享的"进行中上传计数"小工具）、`components/DocumentEditor.tsx`：`beforeunload` 提示逻辑。
- 图片封面图（`coverImage`）的"上传了但从未被设成封面"孤儿场景本次仍不实现（跟视频孤儿是同一类问题，但认领时机不同，需要单独设计），继续记录在 Non-Goals。

**明确排除（Non-Goals，见 design.md 详述）**：断点续传/分片上传、上传进度条（百分比）、离线上传队列（离线时排队、恢复网络后自动补传）、POST 请求的 Idempotency-Key 与自动重试机制、图片封面图的孤儿回收——这些是分片上传协议级别的改动或需要单独设计的独立能力，工作量跟本次范围不是一个量级，本次不做，只在 design.md 里列出供后续参考，避免遗漏。
