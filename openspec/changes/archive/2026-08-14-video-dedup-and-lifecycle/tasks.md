## 1. 数据模型

- [x] 1.1 `apps/api/prisma/models/video.prisma` 的 `VideoAsset` 新增 `sha256`（`String? @unique`）与 `refCount`（`Int @default(1)`）字段 + 迁移
- [x] 1.2 `apps/api/src/models/video-asset.ts` 新增：按 `sha256` 查找、创建时接收 `sha256`、原子自增 `refCount`、原子自减 `refCount` 并返回更新后的记录、物理删除记录

## 2. 上传去重

- [x] 2.1 `services/video.ts` 的 `uploadVideo`：上传前计算原始 buffer 的 `sha256`，命中已存在资产时跳过创建转码任务，直接返回该资产的完整当前状态（不改变引用计数，见 design.md 决策 2 的修正：引用计数完全交给文档保存时的内容 diff 维护）
- [x] 2.2 未命中时维持现有流程（写入 raw bucket、创建资产、入队转码），新建资产带上 `sha256`、`refCount` 显式传 0
- [x] 2.3 处理并发上传相同新内容的插入冲突：捕获 `sha256` 唯一约束冲突（P2002）后重新查询该资产直接返回（同样不改变引用计数），并删除这次多余上传的原始文件对象，不重复入队转码
- [x] 2.4 `UploadVideoResult` 类型从固定 `{assetId, status: 'processing'}` 扩展为 `{assetId, status, hlsUrl, posterUrl, error}`，跟 `VideoStatusResult` 形状一致

## 3. 视频引用计数生命周期

- [x] 3.1 新增 `apps/api/src/utils/video-content.ts`：`countVideoAssetOccurrences(content)` 递归遍历 ProseMirror JSON，按 `assetId` 统计 `type === 'video' && sourceType === 'upload'` 节点的出现次数
- [x] 3.2 `services/video.ts` 新增 `releaseVideoRef(assetId, times)`：原子自减 `refCount`，归零时删除 `VideoAsset` 记录并尝试删除对象存储中 `videos/${assetId}/` 前缀下的全部产物与可能残留的原始文件，失败仅记录日志
- [x] 3.3 `services/video.ts` 新增 `acquireVideoRef(assetId, times)`：原子自增 `refCount`；目标记录不存在时（资产已被彻底清理）仅记录日志，不抛出异常
- [x] 3.4 `services/document.ts` 的 `updateDocument`：当 `input.content !== undefined` 时，对更新前后的内容各跑一次 `countVideoAssetOccurrences`，按 `assetId` 比较次数差值，次数减少的调用 `releaseVideoRef`，次数增加的调用 `acquireVideoRef`；必须等文档更新真正成功后才执行
- [x] 3.5 `services/document.ts` 的 `deleteDocument`：删除前统计文档内容中全部视频资产的出现次数，删除成功后逐个调用 `releaseVideoRef`

## 4. 转码性能调优

- [x] 4.1 `jobs/process-video-transcode.ts` 的 `transcodeToHls`：新增 `-threads`，取值为 `Math.max(1, Math.floor(os.cpus().length / VIDEO_TRANSCODE_CONCURRENCY))`
- [x] 4.2 `transcodeToHls` 的编码参数新增 `-preset veryfast`

## 5. 前端适配

- [x] 5.1 `packages/tiptap-editor/src/utils/video-uploader-registry.ts` 的 `VideoUploadResult` 类型扩展为包含 `status`/`hlsUrl`/`posterUrl`/`error`
- [x] 5.2 `packages/tiptap-editor/src/utils/slash-command.ts` 插入视频节点时透传上传响应的完整状态，不再硬编码 `status: 'processing'`
- [x] 5.3 `apps/web/src/services/video.ts` 的 `UploadVideoResult` 类型同步更新

## 6. 验证

- [x] 6.1 `apps/api` 的 `typecheck` 通过，`prisma validate`/`generate` 通过
- [x] 6.2 `packages/tiptap-editor`/`apps/web` 的 `typecheck` 通过
- [x] 6.3 验证核心场景：①重复上传同一视频命中去重、不触发新转码、`refCount` 正确自增；②首次上传创建 `refCount = 1` 的新资产；③编辑文档删除视频节点后保存，资产 `refCount` 正确自减；④删除文档释放其全部视频引用；⑤`refCount` 归零时资产记录与对象存储产物被清理；⑥恢复到重新引入某视频的历史版本后引用计数正确回补
- [x] 6.4 验证转码调优：观察 `ffmpeg` 进程的线程占用符合预期上限，转码耗时相比调优前有可感知的下降
- [x] 6.5 清理验证过程中产生的临时脚本/测试数据，不留入正式代码
