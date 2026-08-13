## 1. 孤儿视频资产清理

- [x] 1.1 新增清理阈值常量（如 `ORPHAN_VIDEO_ASSET_MAX_AGE_MS`，初始值 24 小时），放在合适的模块（如 `queue/video-transcode.ts` 或新建 `jobs/cleanup-orphan-video-assets.ts`）
- [x] 1.2 `models/video-asset.ts` 新增按条件查找的函数：`refCount = 0 AND createdAt < now() - 阈值` 的资产列表
- [x] 1.3 新增 `jobs/cleanup-orphan-video-assets.ts`：消费清理任务，对每条命中的孤儿资产调用 `deleteVideoAssetArtifacts` + `deleteVideoAsset`，单条失败只记录日志不影响其余记录的清理
- [x] 1.4 新增一个轻量的 repeatable 队列（或复用 `video-transcode` 队列新增一个 job type,但用独立的 `concurrency` 语义，不占用转码并发名额），调度上面的清理逻辑定期执行（建议每小时一次）
- [x] 1.5 `worker.ts` 注册这个新队列的消费逻辑,跟现有 `videoTranscodeQueue` 的 worker 共存于同一进程

## 2. 上传进行中离开页面提示

- [x] 2.1 `packages/tiptap-editor/src/utils/video-uploader-registry.ts` 新增进行中计数：`beginVideoUpload()`/`endVideoUpload()`，暴露一个可订阅"当前是否有进行中上传"的方式（如简单的模块级计数 + getter，或一个最小的 pub/sub）
- [x] 2.2 同样给 `image-uploader-registry.ts` 加一份（`beginImageUpload()`/`endImageUpload()`），两者可以提取一个共享的小工具函数,避免重复实现同一套计数逻辑
- [x] 2.3 `slash-command.ts` 里图片/视频的 `run()`：在调用 `uploadImage`/`uploadVideo` 前调用 `begin*Upload()`，在 `.then()`/`.catch()` 结束（成功插入节点或失败提示错误之后）都调用对应的 `end*Upload()`，保证两条路径都会正确清零
- [x] 2.4 检查并同步补齐图片/视频在编辑器其他触发上传的入口（粘贴、拖拽等，如果存在独立于 `slash-command.ts` 的上传触发路径）
- [x] 2.5 `components/DocumentEditor.tsx`（或新增一个小 hook）：订阅进行中计数是否 `> 0`，`> 0` 时挂 `window.addEventListener('beforeunload', ...)`（调用 `event.preventDefault()`），计数归零时移除监听；组件卸载时确保监听也被清理

## 3. BullMQ 共享连接文档化 + 调试脚本退出辅助

- [x] 3.1 `queue/connection.ts` 补充注释：记录"传入已实例化连接会被标记 `shared: true`，`.close()` 不会真正断开底层连接"这一源码级结论，附 BullMQ 源码文件路径/行号依据
- [x] 3.2 `queue/connection.ts` 新增导出 `disconnectSharedQueueConnection()`（内部调用 `queueConnection.quit()`），供一次性调试/运维脚本在收尾时调用；注释里明确说明 `server.ts`/`worker.ts` 不需要也不应该调用它

## 4. 正文图片引用生命周期管理

- [x] 4.1 新增 `apps/api/src/utils/image-content.ts`：镜像 `video-content.ts`，提供 `countImageAssetOccurrences(content)`/`diffImageAssetOccurrences(oldContent, newContent)`，按 `type === 'image'` 节点的 `attrs.src` 分组统计出现次数；只统计 `src` 命中 `env.MINIO_PUBLIC_URL` 前缀（本项目上传接口产生的对象）的节点
- [x] 4.2 `models/uploaded-object.ts`：`decrementUploadedObjectRefCount`/`incrementUploadedObjectRefCount` 确认已支持自定义 `by` 次数（若已支持则跳过，否则补齐）
- [x] 4.3 `services/storage.ts`：`releaseImageRef(url, times = 1)` 扩展支持按次数释放（现有单参数调用方不用改）；新增 `acquireImageRef(url, times = 1)`，按 URL 查找 `UploadedObject` 并自增，查不到时只记录日志不抛异常
- [x] 4.4 `services/document.ts` 的 `updateDocument`：`input.content !== undefined` 时，在现有视频差量逻辑旁边并行执行图片差量（`diffImageAssetOccurrences`），次数增加调用 `acquireImageRef`，减少调用 `releaseImageRef`
- [x] 4.5 `services/document.ts` 的 `deleteDocument`：删除前统计正文全部图片出现次数（`countImageAssetOccurrences`），删除成功后逐个释放对应次数
- [x] 4.6 确认 `coverImage` 字段的现有比较逻辑与新增的正文图片差量逻辑互不干扰（两条独立路径，不会对同一次引用重复计数或释放）

## 5. 验证

- [x] 5.1 真实验证孤儿清理：手动创建一条 `refCount = 0` 且 `createdAt` 早于阈值的 `VideoAsset`（连带 MinIO 产物），触发一次清理任务，确认记录与对象存储产物都被正确删除；同时验证一条 `refCount > 0` 或未超过阈值的记录不受影响
- [x] 5.2 真实验证清理对"仍在转码中"的孤儿资产安全：构造一个正在转码、同时又满足孤儿清理条件的资产，确认清理不会导致转码任务异常报错或影响其余任务
- [x] 5.3 真实验证 `beforeunload` 提示：用浏览器自动化触发一次上传但不等待完成就尝试刷新，确认提示被触发；上传完成插入节点后再刷新，确认不再提示
- [x] 5.4 真实验证正文图片引用生命周期：插入图片并保存，确认 `refCount` 变为对应次数；删除该图片节点并保存，确认 `refCount` 正确回落，归零时对象存储文件与记录被清理；删除整篇文档，确认其正文图片引用被正确释放；恢复到一个重新引入某图片的历史版本，确认引用正确回补
- [x] 5.5 `typecheck`/`biome check` 全部通过
- [x] 5.6 清理验证过程中产生的临时文件/测试数据，不留入正式代码

