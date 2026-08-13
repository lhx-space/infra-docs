## Context

真实验证时发现的问题（不是猜测，是浏览器/日志实测出来的）：

1. 视频节点只有在 `uploadVideo(file)` 这个 Promise resolve 之后才会被 `insertVideo` 插进编辑器（见 `packages/tiptap-editor/src/utils/slash-command.ts` 视频这一项），而 `VideoAsset` 的引用计数完全靠 `services/document.ts` 的 `updateDocument` 对内容做 diff 来建立（见 `video-dedup-and-lifecycle` 决策 2：**上传本身不认领引用**，`refCount` 新建时是 0）。如果上传的 HTTP 请求已经被服务端完整处理完（`VideoAsset` 创建、转码任务已入队甚至已经跑完），但用户在 `.then()` 执行之前刷新/关闭了页面——这个视频永远不会被插入任何文档，`refCount` 永远停留在 0，而现有的 `releaseVideoRef` 只在"发生一次自减且减到 0"这个事件上触发清理，一条从出生就是 0、从未被谁减过的记录，没有任何代码路径会去碰它。
2. 项目里搜不到任何 `beforeunload`/`pagehide` 监听——刷新/关闭标签页对用户是零摩擦的，没有任何提示。
3. 图片上传（`services/storage.ts` 的 `uploadImage`）走的是相反的认领时机：上传成功（或去重命中）那一刻就 `refCount = 1`/`+1`，不需要"保存进某个字段"这个额外动作。`services/document.ts`/`services/wiki.ts` 里确实对 `coverImage`（单一字符串字段）维护了替换/清空时的引用释放——但**这只覆盖封面图这一个场景**。文档正文里通过工具栏/粘贴插入的图片走的是同一个 `uploadImage` 接口（`apps/web/src/services/upload.ts` 打到同一个 `/uploads/images`），同样在上传那一刻 `refCount + 1`，但全局搜不到任何 `countImageAssetOccurrences`/`diffImageAssetOccurrences` 之类对正文内容做图片节点差量统计的代码——`updateDocument`/`deleteDocument` 从未针对正文里的图片节点调用过 `releaseImageRef`。这意味着**每一次成功插入到文档正文的图片，`refCount` 永久只增不减**，不需要任何特殊时机（不是竟态、是必然），比孤儿视频更基础、覆盖面随插入次数线性增长。
4. 排查"一次性调试脚本执行完却不退出进程"的过程中，用 `node_modules` 里 BullMQ 的真实源码验证清楚：`opts.connection` 如果是一个已经实例化的 Redis 客户端（不是让 BullMQ 自己 new 出来的），会被标记成 `shared: true`，`close()` 时会跳过真正的 `disconnect()`/`quit()`（见 `bullmq/dist/cjs/classes/redis-connection.js` 第 506 行 `if (!this.extraOptions.shared) { ...才真的断开... }`）。这不是 bug——本项目 `queue/connection.ts` 故意用单例复用连接给多个 Queue/Worker 共享，`server.ts`/`worker.ts` 两个长跑进程本来就是靠显式 `process.exit()` 退出，不依赖这个连接被"真正"关掉，所以生产行为完全正常；纯粹是这个知识点缺一处清晰记录，导致以后写一次性调试/运维脚本时会重复踩到"进程跑完却不退出"的坑。

## Goals / Non-Goals

**Goals:**
- 回收"上传成功但从未被保存进任何文档"的孤儿 `VideoAsset`（转码产物 + 对象存储 + 数据库记录），不需要人工介入。
- 补上文档正文图片的引用生命周期管理：正文图片被删除、或所属文档被删除时，正确释放对应的 `UploadedObject` 引用，归零时物理清理——跟视频的处理方式对齐（内容差量驱动引用计数），不再是"只增不减"。
- 在用户可能因为离开页面而丢失一次尚未完成的上传时，给出明确提示。
- 把 BullMQ 共享连接这个源码级结论固化成一处清晰的代码内文档 + 一个后续调试脚本可以直接调用的正确退出方式，不影响任何现有生产行为。

**Non-Goals（本次明确不做，量级不同、值得单独立项；逐一对应讨论时列出的问题清单，确保没有遗漏）：**
- 断点续传/分片上传（tus 协议或自定义分片协议）——现在上传是整个文件一次性读进内存、一次性 `putObject`（`multer.memoryStorage()` + 单次 `putObject`），要支持断点续传需要重新设计上传协议本身，工作量远超本次范围。
- 上传进度条（百分比）——`fetch()` 本身不提供上传进度事件，需要换成 `XMLHttpRequest` 或 `ReadableStream` 手动计算，属于纯前端体验改进，跟本次"资源泄漏 + 提示缺失"这两个可靠性问题不是同一优先级。
- 离线上传队列（离线时排队本地、恢复网络后自动补传）——现有的离线能力（`lib/offline-cache.ts` + `useOnlineStatus`）只覆盖"文档内容的只读缓存"，离线写入队列需要新的持久化 + 重放机制，是一个独立的大方向。
- 上传失败自动重试/POST 的 Idempotency-Key 机制——`network/retry.ts` 里已经有意识地把 POST 排除在自动重试范围外（因为不引入幂等键就重试可能导致重复创建），这个限制本身是对的，要解除它需要先在后端接口层设计幂等键，不在本次范围。
- 图片封面图（`coverImage`）的孤儿回收——"上传了但从未被设成封面"这个场景跟视频孤儿是同一类问题（上传即认领、但从未被使用），但触发路径不同（认领时机在上传时而非保存时），需要单独设计判定条件，本次只解决视频孤儿 + 正文图片的引用生命周期，封面图孤儿沿用现状，记录为已知问题。

## Decisions

**1. 孤儿视频资产的清理方式：复用现有 `video-transcode` 队列的仓库能力，新增一个按时间窗口扫描 `refCount = 0` 记录的定期任务，而不是新起一个独立进程或引入 cron 依赖**

用 BullMQ 自带的 repeatable job（`queue.add(name, data, {repeat: {every: intervalMs}})`）挂一个新的 job type 到已有的 `videoTranscodeQueue`（或者新开一个专用的轻量队列，避免跟真正的转码任务抢 `concurrency` 名额——倾向后者，因为清理任务本身很快，不该跟转码任务共享并发上限语义），由已经在跑的 `worker.ts` 进程消费。
- 备选方案：独立的 `setInterval`——排除，`setInterval` 在多副本部署（worker 起多个实例）下会导致多个副本同时各跑一次清理，虽然清理操作本身是幂等的（删一条已经不存在的记录不会报错），但没必要制造这种重复浪费；BullMQ 的 repeatable job 天然由队列本身去重同一时刻只触发一次。
- 备选方案：数据库层 TTL/定时任务（如 Postgres 的 `pg_cron`）——排除，引入新的数据库扩展依赖，而且清理动作本身还要联动删除对象存储产物（`deleteVideoAssetArtifacts`），这部分逻辑必须在应用层跑，数据库层定时任务只能做数据库内部的事，帮不上这部分。

**2. "多久没被引用算孤儿"的判定：`createdAt` 超过一个阈值（初始建议 24 小时）且 `refCount = 0`，不区分 `status`**

- 不能"上传成功立刻就删"——用户可能只是上传后还没来得及点保存（网络慢、正在写文档其他部分），24 小时是一个足够宽松、几乎不会误删真实使用场景的窗口，同时又不会让孤儿无限期占用存储。
- 不需要额外排除 `status = PROCESSING` 的记录——`process-video-transcode.ts` 已经能优雅处理"资产在转码进行中被删除"这个竟态（`markVideoAssetPosterReady`/`markVideoAssetReady` 返回 `null` 时会清理产物、安静退出，不当作失败），清理任务删掉一条仍在转码的孤儿是完全安全的，不需要额外加锁或状态判断。
- 阈值先写死一个常量（跟 `VIDEO_TRANSCODE_CONCURRENCY` 现在的做法一致），不做成环境变量配置项——目前没有多环境差异化配置这个粒度的实际需求，过早引入配置项是不必要的复杂度。

**3. `beforeunload` 只在"上传请求已发出、结果尚未插入编辑器"这个窗口生效，不覆盖"已插入但仍在转码"的 `processing` 状态**

- 关键区分：一旦 `insertVideo`/`insertImage` 执行完并触发了一次自动保存，这个视频/图片节点就已经安全落进了文档内容（即便转码还没完成）——重新打开文档时状态会被正确重新查询（`document-editor` 已有的「重新打开文档时同步最新转码状态」需求），刷新页面**不会丢失任何东西**，只是要多等一次轮询，不需要用提示打扰用户。
- 真正有丢失风险的窗口只有"点了上传、浏览器正在传输/服务端正在处理、`.then()` 还没跑到"这一段——这段时间内如果刷新，这次操作的结果（不管是最终插入成功还是失败）都会丢失，值得提示。
- 实现方式：给 `image-uploader-registry.ts`/`video-uploader-registry.ts` 同款注册表模式扩个"进行中计数"（`beginUpload()`/`endUpload()`，`finally` 里调用后者，保证成功/失败/异常都会正确清零），`DocumentEditor.tsx` 订阅这个计数是否 `> 0`，只在 `> 0` 时挂 `beforeunload` 监听。
- 图片一起做（不只是视频）：两者的风险窗口和修复形状完全一样，都是复用的同一套 uploader-registry 模式，一起做不增加设计复杂度，且图片上传更频繁，同样值得覆盖。

**4. BullMQ 共享连接：只补文档 + 一个可选的脚本退出辅助方法，不改变任何生产代码路径的行为**

- 在 `queue/connection.ts` 里补一段注释，写清楚"传入已实例化连接会被标记 `shared: true`，`.close()` 不会真正断开"这个源码级结论（附 BullMQ 源码文件路径/行号作为依据，方便以后验证是否随版本升级发生变化）。
- 新增一个 `disconnectSharedQueueConnection()`（或类似命名）的导出函数，内部直接调用 `queueConnection.quit()`——只给"写一次性调试/运维脚本"的场景用，`server.ts`/`worker.ts` 两个长跑进程不需要也不应该调用它（它们的 `process.exit()` 已经是正确的收尾方式，调用这个方法反而会在多进程共享同一个 Redis 连接对象的场景下误伤其他还在用这条连接的代码）。
- 不改 `server.ts`/`worker.ts` 现有的 `shutdown()` 逻辑——两边都已经是显式 `process.exit()`，本来就没有依赖 BullMQ 把连接关掉这件事，属于"已经是对的"，不需要动。

**5. 正文图片引用生命周期：完全镜像视频已经验证过的"内容差量驱动引用计数"模式，不是重新设计一套新机制**

- 新增 `apps/api/src/utils/image-content.ts`，提供 `countImageAssetOccurrences(content)`/`diffImageAssetOccurrences(oldContent, newContent)`——跟 `utils/video-content.ts` 几乎一样的递归遍历逻辑，只是匹配 `type === 'image'` 节点、按 `attrs.src`（图片节点存的是完整 URL，不是像视频那样的 `assetId`）分组统计出现次数。
  - 之所以按 URL 而不是另起一个 ID：图片节点本身就是存完整 URL（`type: 'image', attrs: {src: 'https://.../xxx.webp'}`），跟 `releaseImageRef` 现有的"按 URL 反查 `UploadedObject`"这套机制天然对得上，不需要引入新的标识字段。
  - 只统计经过我们上传接口产生的 URL（即 `env.MINIO_PUBLIC_URL` 前缀，指向 `covers` bucket）——用户如果通过"图片"块粘贴一个纯外部图片 URL（如果编辑器支持这种插入方式），这类 URL 在 `UploadedObject` 表里查不到记录，`releaseImageRef`/`acquireImageRef` 按 URL 查不到时视为无操作，天然不会误处理。
- `models/uploaded-object.ts`/`services/storage.ts`：`releaseImageRef` 从只支持 `-1` 扩展为接受 `times` 参数（默认 1，向后兼容现有调用方——封面图场景永远是单次 `-1`，不用改调用点）；新增 `acquireImageRef(url, times)`，内部按 URL 查找 `UploadedObject` 并原子自增 `refCount`（查不到时只记录日志，不抛异常，跟 `acquireVideoRef` 对"目标资产已被清理"的容错处理一致）。
- `services/document.ts` 的 `updateDocument`：正文变化时，在现有视频差量逻辑旁边并行跑一次图片差量（`diffImageAssetOccurrences`），次数增加的调用 `acquireImageRef`，减少的调用 `releaseImageRef(url, times)`；`deleteDocument`：删除前统计正文全部图片出现次数，删除成功后逐个释放——两处都跟视频是完全对称的写法，直接复用相同的"先做主更新、成功后再调整引用"顺序（见现有代码里 `releaseImageRef(existing.coverImage)` 前后的顺序注释）。
- 不处理封面图字段本身——`coverImage` 保留现有的独立单字段比较逻辑（`input.coverImage !== existing.coverImage`），跟正文内容的差量统计是两条完全独立、不会重复计数的路径（一个是字符串字段直接比较，一个是 JSON 内容树递归统计），互不影响。
- 不处理 `Wiki.coverImage`（`services/wiki.ts`）——那本身已经有完整的引用生命周期（替换/清空/删除 Wiki 都会释放），不属于本次要修的缺口。

## Risks / Trade-offs

- [孤儿清理误删一个"刚上传、用户还在写文档但还没保存"的正常记录] → 24 小时窗口足够宽松；且就算真的误删，用户重新上传一次即可恢复（不是不可逆的灾难性后果），跟"完全不清理、无限泄漏"比起来这个风险可以接受。
- [清理任务本身是新增的定期后台负载] → 清理逻辑很轻（一次按索引条件的查询 + 少量删除），执行间隔可以设置得比较稀疏（如每小时一次），不会对现有转码并发造成实际压力。
- [`beforeunload` 提示可能被用户嫌"烦"] → 只在真正有丢失风险的短窗口内生效（上传网络往返 + 服务端处理，通常几秒到几十秒），不是长期霸占；比起"静默丢失用户的上传操作"，一次性的提示是更好的取舍。
- [图片封面图的孤儿场景本次不修] → 明确记录为已知问题（见 Non-Goals），不是遗漏，是有意识的范围控制；封面图是单一字段，上传后基本会立刻被设成封面，实际孤儿概率远低于正文图片的"零回收"问题。
- [上线时项目里已经存在大量历史正文图片，从未被追踪过引用计数] → 跟视频/图片封面去重上线时同样的处理方式：历史图片对应的 `UploadedObject` 记录里 `refCount` 是多少就是多少（大概率被算多了，因为它们插入时 `+1` 过，但从未被这次新增的差量逻辑正确追踪过"消失"事件）——本次上线后，只有从上线时间点往后的正文编辑才会被正确差量统计；历史遗留的"计数偏高、实际早已删除"的记录本次不做一次性回填修正，只保证新增行为正确，不修历史数据（跟以往几次 dedup/lifecycle 变更的 Migration Plan 一致取向）。

## Open Questions

- 24 小时的孤儿判定窗口是否需要做成可配置项——目前倾向不做，等真的出现"这个阈值不合适"的具体场景再决定，不提前引入配置复杂度。
