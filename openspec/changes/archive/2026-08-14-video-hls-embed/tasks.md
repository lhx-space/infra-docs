## 1. 基础设施：队列与转码依赖

- [x] 1.1 `apps/api` 新增 `bullmq` 依赖，基于现有 `ioredis` 连接封装一个转码任务队列
- [x] 1.2 `apps/api` 新增 `fluent-ffmpeg` 依赖，新增独立的 worker 入口 `apps/api/src/worker.ts`，启动时执行一次 `ffmpeg -version` 探活检查并记录日志
- [x] 1.3 更新 `apps/api` 的部署镜像预装 `ffmpeg` 二进制；`docker-compose.yml` 新增一个 worker service（复用 `apps/api` 镜像，指向 `worker.ts` 的启动命令）
- [x] 1.4 根 `package.json`/`apps/api/package.json` 的 `dev` 脚本补充同时启动 worker 进程，本地开发无需手动额外起一个终端

## 2. 数据模型

- [x] 2.1 新增 Prisma model `VideoAsset`（`id`/`status`/`sourceType`/`originalObjectKey`/`hlsManifestKey`/`posterKey`/`error`/`createdBy`/`createdAt`/`updatedAt`）+ 迁移
- [x] 2.2 `apps/api/src/models/video-asset.ts`：新增创建记录、按 `id` 查找、更新状态（含 `ready`/`failed` 两类结果字段）的数据访问函数

## 3. 上传接口与内容校验

- [x] 3.1 新增视频文件的 MIME 类型/大小上限校验中间件（对齐 `handlers/upload.ts` 现有图片校验风格），拒绝时返回 `400 invalid_file_type`/`400 file_too_large`
- [x] 3.2 新增 `POST /videos` 路由 + handler：挂载 `requireAuth`；写入原始文件到临时对象存储位置，创建 `VideoAsset`（`processing`），将转码任务加入队列，同步返回 `{assetId, status: 'processing'}`

## 4. 转码 worker

- [x] 4.1 worker 消费队列任务：读取原始视频文件，用 `fluent-ffmpeg` 转码为单一分辨率的 HLS（播放清单 + 分片），并截取一帧作为封面图
- [x] 4.2 转码产物写入对象存储，更新对应 `VideoAsset` 为 `ready` 并记录播放清单地址与封面帧地址
- [x] 4.3 转码失败时更新 `VideoAsset` 为 `failed` 并记录可读的错误信息，保留原始文件不清理
- [x] 4.4 转码成功后异步删除原始上传的视频文件对象
- [x] 4.5 为队列设置一个保守的默认并发处理上限（如同时最多 2 个任务）

## 5. 转码状态查询接口

- [x] 5.1 新增 `GET /videos/:id` 路由 + handler：返回当前状态、（`ready` 时）播放清单地址与封面帧地址、（`failed` 时）错误信息；不存在的 `id` 返回 `404 not_found`

## 6. 编辑器 Video 节点（schema，框架无关）

- [x] 6.1 `packages/tiptap-editor/src/schema.ts` 新增 `Video` 节点声明（属性：`sourceType`/`assetId`/`hlsUrl`/`posterUrl`/`status`/`error`），不引入任何浏览器专属库，保持 `apps/api` 可安全加载
- [x] 6.2 `documentEditorExtensions` 数组加入 `Video` 的纯配置项

## 7. 编辑器 Video 节点（渲染与交互）

- [x] 7.1 `packages/tiptap-editor` 新增 `hls.js` 依赖（仅浏览器渲染层引入，不进入 `schema.ts`）
- [x] 7.2 为 `Video` 节点实现 `addNodeView`：`processing` 展示加载占位（若已有 `posterUrl` 则作为背景）；`ready` 用 `hls.js` 播放，限制最大显示宽度，播放前展示封面帧、不自动播放；`failed` 展示错误提示
- [x] 7.3 工具栏/斜杠命令新增"插入视频"入口，支持选择本地文件后调用消费方注入的视频上传回调
- [x] 7.4 粘贴内容识别以 `.m3u8` 结尾的外部地址时，直接插入一个"已就绪"状态的 `Video` 节点（不发起上传/转码请求）；不符合格式的粘贴内容按普通文本处理
- [x] 7.5 `processing` 状态节点插入后按固定间隔轮询 `GET /videos/:id`，命中 `ready`/`failed` 后停止轮询、更新节点属性（触发既有的自动保存流程）
- [x] 7.6 文档加载时对内容中所有仍处于 `processing` 状态的 `Video` 节点重新发起一次状态查询并更新展示

## 8. `apps/web` 接入

- [x] 8.1 新增视频上传服务函数，封装 `POST /videos` 与 `GET /videos/:id`
- [x] 8.2 `DocumentEditor` 消费方注入视频上传回调（对齐现有图片上传回调注入模式）

## 9. 验证

- [x] 9.1 `apps/api` 的 `typecheck` 通过，`prisma validate`/`generate` 通过
- [x] 9.2 `packages/tiptap-editor` 的 `typecheck` + `build` 通过
- [x] 9.3 `apps/web` 的 `typecheck` 通过
- [x] 9.4 本地启动 worker，手动上传一个小视频文件验证全链路：`processing` → `ready`，产物可通过 `hls.js` 正常播放
- [x] 9.5 验证粘贴外部 `.m3u8` 地址可以直接插入并正常播放，不产生任何上传/转码请求
- [x] 9.6 验证转码失败场景（如上传一个损坏或非视频伪装文件）展示错误提示，且不阻塞文档其余内容的编辑与保存
- [x] 9.7 验证队列并发上限：同时提交超过并发上限数量的转码任务，确认超出部分排队等待而非同时执行
- [x] 9.8 验证重新打开一篇仍有 `processing` 视频节点的文档时，状态会被重新查询并正确更新
- [x] 9.9 清理验证过程中产生的临时文件/测试数据，不留入正式代码
