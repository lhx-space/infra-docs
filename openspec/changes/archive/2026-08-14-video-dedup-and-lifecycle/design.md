## Context

`video-hls-embed` 上线时的 `VideoAsset` 模型（`apps/api/prisma/models/video.prisma`）设计是"跟文档内容完全松耦合"：`Document.content` 里的 `video` 节点只存一个 `assetId`，`VideoAsset` 表本身不知道自己被多少篇文档、多少个节点引用。当时的 design.md 决策 6 明确写了"不做引用计数/去重"，理由是"视频上传大多是独占内容，去重价值低"。

现在要推翻这个决策，原因见 proposal.md：转码成本远高于图片转码，且完全没有清理机制导致存储持续泄漏。`image-upload-dedup`（`apps/api/src/services/storage.ts`）已经跑通了一套"sha256 去重 + refCount + 写路径显式释放"的模式，可以直接复用同一套思路，但视频有一个图片没有的复杂点：**图片的引用只有一个标量字段**（`Wiki.coverImage`/`Document.coverImage`，一对一），改一次就是一次引用变化；**视频节点嵌在 `Document.content` 这棵 ProseMirror JSON 树里，一篇文档的一次保存可能同时插入、删除、保留多个视频节点**，甚至同一个 `assetId`理论上可以在同一篇文档里出现多次（复制粘贴视频块）或跨文档出现（跨文档复制粘贴、或本次去重让两篇文档主动共享同一个资产）。因此引用计数的变化不能只看"这个字段变了没变"，必须对内容树做一次结构化的差异比较。

`Document.content` 的写路径目前只有三个：`services/document.ts` 的 `updateDocument`（正常编辑保存）、`deleteDocument`（删除文档级联删除内容），以及 `services/document-version.ts` 的 `restoreVersion`（内部复用 `updateDocument`，把历史版本的内容重新写回当前文档）。三者最终都会落到 `updateDocumentModel`/`deleteDocumentModel` 这两个数据库操作上，`restoreVersion` 本身不是独立的第三条写路径，而是 `updateDocument` 的一种特殊调用方式（`content` 参数是某个历史版本的快照）。

另外，`jobs/process-video-transcode.ts` 里的 `ffmpeg` 调用目前没有设置 `-threads`，也没有调整过 `preset`（`transcodeToHls` 走的是 libx264 默认 `medium`）；`queue/video-transcode.ts` 里的 `VIDEO_TRANSCODE_CONCURRENCY = 2` 是唯一约束并发的地方，两者目前没有配合关系。

## Goals / Non-Goals

**Goals:**
- 相同原始视频内容的重复上传不再各自触发独立的转码与存储
- 视频节点从文档内容中消失（被删除、被替换、文档本身被删除、恢复到不包含它的历史版本）时，正确释放引用计数；归零时清理 `VideoAsset` 记录与对象存储中的全部产物
- 恢复到一个历史版本导致某个 `assetId` 重新出现在文档内容中时，正确地把它计入引用（避免被后续误删）
- 转码的 `ffmpeg` 调用与 worker 并发上限配合，避免多个转码任务在同一台机器上无限制抢占 CPU 核心；用更快的 preset 缩短单个任务的转码耗时
- 上传接口的响应体携带资产的真实当前状态，去重命中已就绪资产时前端不需要经过一轮轮询才能展示

**Non-Goals:**
- 不做"内容相似但字节不同"的去重（转码参数不同、被不同工具重新编码过的同一段视频不会被识别为重复）——跟图片去重同样的范围限制
- 不做历史遗留数据回填：本能力上线前已经存在的 `VideoAsset` 记录没有 `sha256`，不会被新的去重逻辑覆盖或反查，也不会主动补算哈希
- 不做定期扫描孤儿对象/记录不一致的清理任务——只做同步的 best-effort 清理，跟图片去重的取舍一致
- 不做 GPU/硬件编码加速——线程数与 preset 调整是本轮唯一的转码性能改动，硬件加速依赖部署环境，留作后续按需评估
- 不改变 `VIDEO_TRANSCODE_CONCURRENCY` 的默认值本身，只调整 `ffmpeg` 自身的线程占用，让并发数和线程数的乘积更可控

## Decisions

**1. 复用图片去重同款模式：sha256 唯一索引 + refCount，而不是引入通用的"对象引用登记表"**
`VideoAsset` 直接新增 `sha256`（唯一索引）与 `refCount`（新建记录从 0 起步，见决策 2）两个字段，不新建一张独立的登记表——跟图片去重不同，视频资产本身（`VideoAsset`）已经是一张跟内容强绑定的表（记录了转码状态、产物地址），没有必要像图片那样在"是否复用同一转码结果"和"业务记录"之间再插一层。
- 备选方案：新建一张通用的 `sha256 → objectKey` 登记表（`image-upload-dedup` design.md 里提过的"未来可能泛化"选项）——排除，视频资产的生命周期（转码中/失败）跟图片纯粹的"静态对象"不一样，硬塞进通用表反而要多绕一层。

**2. 引用计数的语义：只反映"当前被多少篇已保存文档实际引用"，不因上传/去重命中本身而变化；变化完全由 `Document.content` 的结构化 diff 驱动**
新增一个纯函数 `countVideoAssetOccurrences(content)`（递归遍历 ProseMirror JSON 树，统计 `type === 'video' && attrs.sourceType === 'upload'` 节点按 `assetId` 分组的出现次数），在 `updateDocument` 里对"更新前内容"和"更新后内容"各跑一次，逐个 `assetId` 比较次数差值：次数减少的释放对应差值次数的引用，次数增加的（新插入一个视频、在同一篇/另一篇文档里复制粘贴已有视频块、恢复到一个更早引用了它的历史版本）补上对应差值次数的引用。
- 关键点、也是实现过程中修正过的一处设计：**上传接口本身（包括去重命中）不认领任何引用**，`VideoAsset` 创建时 `refCount` 从 0 起步——如果上传时就 `+1`（"假定马上会被用一次"，跟图片去重的假设一样），文档保存时的 diff 又会把"这个 assetId 从 0 次变成 1 次出现"当成一次新增引用再 `+1`，同一次插入会被计两次。改成"引用计数纯粹派生自已保存内容的出现次数"之后，插入后的首次保存、复制粘贴同一视频块、恢复历史版本重新引入，全部统一走同一套 diff 逻辑，不需要在上传路径单独处理，也不会有双重计数。
- 备选方案：只判断"这个 `assetId` 在新内容里还在不在"（集合意义上的存在性，不关心次数）——排除，"同一个视频块在一篇文档里出现两次"（复制粘贴）在这种场景下会漏计/多计引用，实现成本跟按次数比较几乎一样，没有理由退让正确性。
- 复杂度可控：这个 diff 只在 `input.content !== undefined`（真的改了正文）时才跑，跟现有 `searchText` 重新提取是同一个触发条件，不增加额外的写路径判断逻辑。

**3. `restoreVersion` 不单独写释放逻辑，靠复用 `updateDocument` 自动获得正确行为**
`restoreVersion` 现在的实现就是拿历史版本的 `content` 调用 `updateDocument`——决策 2 的 diff 逻辑放在 `updateDocument` 内部，`restoreVersion` 不需要新增任何视频相关代码，天然获得"恢复丢失的引用/释放恢复后不再存在的引用"的正确行为。

**4. 引用计数归零后的清理：物理删除 `VideoAsset` 记录本身，不是只清空字段**
跟图片去重不同（图片归零后只删 MinIO 对象、保留 `UploadedObject` 记录方便下次同内容重新命中且不需要重新转码），视频归零后**连 `VideoAsset` 数据库记录本身也一起删除**，同时清理 MinIO 里 `videos/${assetId}/` 前缀下的全部产物（清单/分片/封面帧）以及可能仍残留的原始文件（`failed` 状态下原始文件不会被自动删除，见现有决策 8）。
- 之所以跟图片不同：图片的 `UploadedObject` 只是一份轻量的元数据（`bucket`/`objectKey`/`size`），保留它不占什么空间，换来的是"以后同一张图再传一次可以立刻命中"；视频的 `VideoAsset` 记录本身没有额外保留价值——如果保留一条 `refCount = 0` 的记录、以后同内容再传一次再复用，最终产物已经被删了（HLS 分片都物理删除了），复用它毫无意义，还要重新触发一次完整转码，等于白留。索性归零就整条删干净，逻辑更简单。
- 代价：如果归零后立刻又有一次相同内容的上传，会当成"全新内容"重新走一次完整转码——这是一个可接受的边界情况（"删除后立刻重新上传同一视频"本身概率很低），不引入延迟删除或软删除机制去优化这个低频场景。

**5. 上传接口的去重命中：不认领引用，只是"跳过转码、返回现有资产"**
未命中时创建 `VideoAsset`（带 `sha256`，`refCount` 从 0 起步）、入队转码任务；`sha256` 唯一约束冲突（两个请求几乎同时上传同一份全新内容）时，捕获 Prisma `P2002`，转为查询已存在的记录直接返回（不自增引用计数，见决策 2），同时删除这次多余上传的原始文件对象（不入队转码，因为已经有另一个任务在处理同样的内容）。引用计数完全交给后续任意一次真正把这个 `assetId` 保存进文档内容的 `updateDocument` diff 来建立。
- 跟图片去重的处理方式（`services/storage.ts` 的 `uploadImage`）思路相似（都靠唯一约束 + 插入失败转命中处理并发），但引用计数归属点不同——图片是单一标量字段，"上传即认领"没有双重计数的风险；视频经过决策 2 的修正后，认领点统一挪到了内容 diff 这一处。

**6. 上传响应体改为返回资产的完整当前状态**
`uploadVideo` 的返回值从固定的 `{assetId, status: 'processing'}` 改为跟 `getVideoStatus` 一致的形状（`status`/`hlsUrl`/`posterUrl`/`error`）——去重命中一个已经 `ready` 的资产时，前端可以直接插入一个"已就绪"的视频节点，不需要先插入"转码中"再等下一轮轮询才更新（那样反而会让用户在明明已经转码完成的情况下多等一个轮询间隔）。
- 影响面：`packages/tiptap-editor` 的 `video-uploader-registry.ts`（`VideoUploadResult` 类型）与 `slash-command.ts`（插入视频节点时改为透传上传响应里的 `status`/`hlsUrl`/`posterUrl`/`error`，不再硬编码 `processing`）、`apps/web/src/services/video.ts`（响应体类型同步更新）需要跟着改。

**7. `ffmpeg` 显式限制线程数，preset 从 `medium` 换成 `veryfast`**
`transcodeToHls` 的 `outputOptions` 新增 `-threads`（取值：`Math.max(1, os.cpus().length / VIDEO_TRANSCODE_CONCURRENCY)` 向下取整），让"并发任务数 × 每个任务线程数"不超过机器总核心数；`.videoFilters`/编码参数新增 `-preset veryfast`（牺牲少量压缩率换转码速度，画质/码率的下降在 720p 单档输出下可接受）。
- 备选方案：不限制线程数，靠 `ffmpeg` 自己探测——排除，已经在真实验证里观察到"2 个并发任务同时跑，容易互相抢核"的现象（见前几轮对话的评估），显式限制是零成本的确定性改善。
- 备选方案：换成 `ultrafast`——排除，压缩率损失过大，`veryfast` 是速度/画质更平衡的档位，是 libx264 preset 梯度里常见的"生产环境默认推荐"选择之一。
- 这个改动跟决策 1~6（去重/引用计数）完全独立，互不依赖，可以分别验证。

## Risks / Trade-offs

- [Risk] 两篇文档去重共享同一个 `assetId` 后，任意一篇文档编辑时的引用计数变化会影响另一篇文档能看到的资产存活状态 → [Mitigation] 这正是引用计数机制本身要解决的问题——只要计数正确，资产只有在真正没有任何文档引用时才会被清理，不存在"活着的引用突然失效"的场景
- [Risk] `countVideoAssetOccurrences` 对内容树的递归遍历，如果 `Document.content` 异常巨大（极端场景），会有一定的 CPU 开销 → [Mitigation] 跟现有的 `extractPlainText`（同样递归遍历整棵内容树来生成 `searchText`）是同一个量级的操作，不是新增的性能量级，不做单独优化
- [Risk] 归零删除 `VideoAsset` 记录后，如果同一时刻正好有另一个请求在读这条记录做状态查询（`GET /videos/:id`），可能读到"刚好被删除"的竟态 → [Mitigation] 概率极低（触发条件是"最后一个引用刚被移除"与"恰好这时有人在查询这条转码状态"同时发生），返回 `404 not_found` 是已有的、语义正确的降级路径，不需要额外处理
- [Risk] `veryfast` preset 相比 `medium` 会略微增大相同画质下的文件体积（分片更大） → [Mitigation] 接受这个代价，转码速度对当前阶段的价值更高；如果后续存储成本成为瓶颈，可以再单独评估调整

## Migration Plan

1. 新增 Prisma migration：`VideoAsset` 加 `sha256`（唯一）、`refCount`（`Int` 非空）字段；迁移里给已有历史记录的 `refCount` 回填默认值 1（合理假设：本能力上线前创建的视频记录大多正被某篇文档实际引用，`1` 是比 `0` 更安全的近似——`0` 会导致后续这些视频从文档中被移除时，减一变成负数），新代码创建资产时会显式传 `refCount: 0`（不依赖字段默认值，见决策 2）
2. 部署顺序：先跑迁移，再发布新代码；迁移本身不回填 `sha256`，历史记录在迁移后与"未追踪"状态等价（去重查不到它们，释放引用时它们的 `refCount` 会被更新但由于本身没人主动去引用它们做 diff，实际不受影响）
3. 回滚：只回滚代码，字段保留不影响旧代码运行（旧代码不读写这两个新字段）；如果连字段一起回滚，需要注意迁移后如果已经有走新逻辑产生的 `refCount`/`sha256` 数据会丢失，视频资产的存活判断退化回"永不清理"的旧行为，不会导致数据损坏

## Open Questions

- 归零后立即物理删除 `VideoAsset` 记录，是否要留一个短暂的宽限期（比如软删除 + 定时任务延迟清理）防止误删后立刻发现还需要——本轮不做，按"归零就是真的没人要了"的假设直接删
- `veryfast` 是否是最终选定的 preset，后续如果观察到画质投诉可以再调整，不是一次性决定
