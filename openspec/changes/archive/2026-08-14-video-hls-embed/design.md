## Context

`packages/tiptap-editor` 现在只有图片这一种媒体块类型：`Image.configure(...)`（纯声明式扩展，见 `src/utils/extensions.ts`），实际的上传由消费方（`apps/web`）通过注入回调完成，编辑器本身不感知上传接口地址（见 document-editor spec.md「图片插入、上传交互与展示限制」）。`MermaidBlock`/`LinkPreviewCard` 两个节点展示了本仓库现有的两种可复用模式：
- Mermaid：节点自身有"编辑态/展示态"两种状态，靠 `addNodeView` 渲染 React 组件
- LinkPreviewCard：插入时先落地一个"占位"节点，异步拿到远端元信息后再更新节点属性重新渲染

`schema.ts` 与 `index.ts`（`DocumentEditor` 组件）之间有一条明确的边界：`schema.ts` 只能包含框架无关、Node.js 环境也能安全加载的纯 ProseMirror 扩展配置（`apps/api` 会直接 import 它来做服务端内容校验），任何浏览器专属库（`mermaid`、`@tiptap/react` 等）都不能出现在这条导入链路上。

后端目前完全没有异步任务/队列基础设施——`ioredis`（`apps/api/src/cache/index.ts`）只用来做 refresh token 白名单这种简单的 KV 缓存，所有写接口都是同步处理完就响应。`sharp` 是目前唯一的媒体处理依赖（图片转码），没有引入过 `ffmpeg`。

## Goals / Non-Goals

**Goals:**
- 编辑器新增一个 `Video` 节点，支持"上传原始视频→服务端转码为 HLS"与"直接粘贴外部 HLS 地址"两种插入来源，统一用 HLS 播放
- 转码是异步过程，编辑器 SHALL 能感知并展示"处理中/已就绪/失败"三种状态，不阻塞用户对文档其余部分的编辑
- 转码流水线与现有请求处理进程解耦，避免长耗时任务占用处理 HTTP 请求的资源
- 复用仓库已有的架构约定（schema/渲染分离、消费方注入上传回调）而不是另起一套

**Non-Goals:**
- 不支持直播/推流场景，只处理"已经完整上传的文件"转成点播（VOD）HLS
- 不做多码率自适应（ABR）——v1 每个视频只产出一档清晰度
- 不做浏览器内视频剪辑/裁剪
- 不做分片级离线缓存到 IndexedDB（这是用户明确选择的另一个方案分支，本轮不做，可作为独立后续变更）
- 不对视频做类似图片的内容寻址去重——转码结果与源文件强绑定，去重收益与复杂度不成比例，本轮不做
- 不自动清理转码失败后残留的原始文件、不做定时孤儿对象扫描——这两项都留作 Open Question

## Decisions

**1. 异步任务队列：引入 BullMQ（基于已有的 Redis），而不是同步阻塞转码**
上传接口收到视频后立即创建一条任务记录（状态 `processing`）并同步返回，真正的 `ffmpeg` 转码交给独立的队列 worker 异步执行。
- 备选方案：同步转码但拉长 HTTP 超时——排除，转码耗时随视频长度线性增长，容易超过网关/反向代理的超时限制，且会长时间占用一个请求处理的资源。
- 选择 BullMQ 而不是自己攒一个"数据库轮询表当队列"：BullMQ 直接复用仓库里已经存在的 `ioredis` 连接，提供开箱即用的重试、并发控制、失败任务追踪，没有理由重新发明。

**2. worker 是独立常驻进程，不与 HTTP API 共用进程**
新增 `apps/api/src/worker.ts` 作为单独的入口/启动命令，专门消费转码队列；`docker-compose.yml`/根 `package.json` 的 `dev` 脚本需要同时起 API 和 worker 两个进程。
- 备选方案：在 API 进程内用 `setImmediate`/子进程直接跑转码——排除，`ffmpeg` 转码是 CPU 密集操作，跑在处理 HTTP 请求的同一进程里会拖慢所有其他请求的响应；进程级隔离让两者的资源竞争关系更清晰，也方便未来独立伸缩 worker 数量。

**3. 状态同步方式：前端轮询，而不是 WebSocket/SSE 推送**
转码完成后，编辑器通过定期调用 `GET /videos/:id` 查询任务状态，命中 `ready`/`failed` 后停止轮询并更新节点属性（进而触发正常的文档自动保存流程）。
- 备选方案：转码完成后用 WebSocket/SSE 推送——排除，项目目前没有任何长连接推送基建，为了这一个功能引入代价过高；转码通常是秒级到分钟级的等待，轮询体验在这个量级下完全可接受。
- 关键补充：轮询只在"当前会话刚插入/打开时看到 processing 状态"时发生，不是永久轮询——用户离开页面后不会有僵尸轮询在后台跑；下次任何人重新打开这篇文档时，编辑器会对文档里所有仍处于 `processing` 的视频节点重新发起一次状态查询（见 spec.md 场景），保证状态最终能追上。

**4. ffmpeg 调用方式：`fluent-ffmpeg` 包装系统二进制，而非 WASM 版 ffmpeg**
worker 里用 `fluent-ffmpeg`（Node 包，本质是拼 `ffmpeg` CLI 参数再 spawn 子进程）驱动转码，要求部署环境预装 `ffmpeg` 二进制。
- 备选方案：`ffmpeg.wasm` 跑在 Node/浏览器里——排除，WASM 版本性能明显弱于原生二进制，处理长视频不现实；本仓库后端本身就是常驻 Node 服务，没有"不能依赖系统二进制"的限制（不像浏览器环境）。
- 代价：`apps/api` 的部署镜像/环境需要显式安装 `ffmpeg`，需要更新 Dockerfile 与本地开发文档。

**5. 单一分辨率/码率转码，产出一张封面帧**
每个视频只转出一档 HLS（分片 + 一份 `.m3u8`），转码任务顺带用 `ffmpeg` 截取视频开头的一帧作为封面图（复用 image 上传流程里已有的"转 WebP、限最大尺寸"思路），供编辑器在播放前展示。
- 备选方案：转出多码率 ABR（自适应码率组）——排除，本轮定位是"能播就行"，ABR 需要额外的清单层级设计与更多存储成本，留作 Open Question 视后续弱网播放需求再评估。

**6. 数据模型：`VideoAsset` 独立于文档模型，不做引用计数/去重**
新增 `VideoAsset`（`id`/`status`/`sourceType`/`originalObjectKey`/`hlsManifestKey`/`posterKey`/`error`/`createdBy`/时间戳），跟 `Document.content` 之间没有外键关系——`Document.content` 里的 `Video` 节点只是存了一个 `assetId`（上传来源）或 `hlsUrl`（外部来源），跟 `image-upload-dedup` 变更里图片的"URL 直接内嵌进 content"是同一种松耦合方式，不引入内容与资产之间的强一致性约束。
- 之所以不做引用计数：每次视频上传都产生一份独占的转码产物（不像图片那样，同一份原始字节可能被多处复用），去重/共享的价值本身就低，没必要为一个低频场景引入复杂度。

**7. schema/渲染分离：`Video` 节点属性纯声明，播放器渲染放在组件层**
`schema.ts` 里的 `Video` 节点只声明属性（`sourceType`/`assetId`/`hlsUrl`/`posterUrl`/`status`/`error`），不引入 `hls.js`；真正实例化 `hls.js` 播放器的逻辑放在 `index.ts` 侧的 `addNodeView` 组件里——跟 `MermaidBlock`（`mermaid` 库只在渲染层加载）遵循同一条既有约束，保证 `apps/api` 引用 `schema.ts` 做服务端内容校验时不会因为加载了浏览器专属库而报错。

**8. 原始文件生命周期：转码成功后异步删除，失败后保留**
转码 worker 成功产出 HLS 后，紧接着删除原始上传的视频文件对象（只保留最终产物，避免同一份内容多存一遍）；转码失败时保留原始文件，方便排查失败原因，不做自动清理（见 Open Questions）。

## Risks / Trade-offs

- [Risk] `ffmpeg` 转码是 CPU 密集操作，单个 worker 实例同时处理过多任务会互相拖慢 → [Mitigation] BullMQ 队列设置一个保守的默认并发上限（如同时最多 2 个任务），超出的任务排队等待，本轮不做自动扩缩容
- [Risk] 大文件上传 + 排队等待转码期间占用存储，恶意/误操作重复上传会导致容量增长不可控 → [Mitigation] 复用图片变更已确认的思路，给视频上传设置一个明确的大小上限（如 500MB），超出直接拒绝，不进入转码流水线
- [Risk] worker 进程崩溃或宿主重启可能导致正在处理中的任务卡死在 `processing` 永远不完成 → [Mitigation] 依赖 BullMQ 自带的任务持久化（存在 Redis）与 stalled job 检测/重新入队机制，采用其默认配置，不额外定制
- [Risk] 用户插入视频后就离开页面，前端本次会话的轮询也随之停止，文档里的节点会"卡"在 processing 状态直到有人重新打开 → [Mitigation] 见 Decisions 3，重新打开文档时会对所有 processing 状态的节点重新查询一次，最终能追上真实状态
- [Risk] 部署环境如果没有预装 `ffmpeg`，worker 启动或首次执行转码时才会报错，问题暴露较晚 → [Mitigation] worker 启动时做一次 `ffmpeg -version` 探活检查，失败则在启动日志里明确报错（不阻塞 API 进程本身启动，只影响转码能力）

## Migration Plan

1. 新增 Prisma migration 建 `VideoAsset` 表
2. `apps/api` 镜像/部署环境预装 `ffmpeg`，`docker-compose.yml` 新增一个 worker service（复用 `apps/api` 镜像，换一条启动命令指向 `worker.ts`）
3. 部署顺序：先上线 worker（能正常消费队列），再上线包含视频上传接口的 API，最后上线带视频插入入口的前端——避免"前端已经能插入视频，但后端还没有能力处理转码任务"的空窗期
4. 回滚：直接隐藏前端的视频插入入口即可安全下线该功能；已经产生的 HLS 产物保留在对象存储中，不影响其他能力；如果要连后端一起回滚，先停 worker 再回滚 API，避免队列里还有任务时 worker 突然消失导致任务卡在 processing（可接受，重新部署 worker 后会自动继续消费）

## Open Questions

- 是否需要多码率自适应（ABR）——留待后续有明确的弱网播放需求再评估
- 转码失败后保留的原始文件、以及物理删除失败留下的孤儿对象——目前都没有自动清理机制，需要人工介入或后续单独排期加定时清理任务
- 视频时长上限——本轮只做文件大小上限（如 500MB），未设定时长上限，是否需要单独限制留作后续评估
- worker 的并发处理上限具体设多少合适——本轮先取一个保守的默认值，后续可以根据实际负载调整
