## Why

文档编辑器目前只支持插入图片，不支持视频；团队协作文档里经常需要嵌入演示录屏、教学视频等素材。用户明确要求两类场景都要支持：①上传原始视频文件、由系统转码为 HLS 分片供播放；②直接粘贴已有的外部 HLS 地址（`.m3u8`）嵌入播放。这需要在编辑器新增一个视频块类型，并在后端新增一条"上传原始视频 → ffmpeg 转码为 HLS 分片 → 存入对象存储 → 生成播放清单"的异步处理流水线。

## What Changes

- `packages/tiptap-editor` 新增 `Video` 块类型，支持两种插入来源：本地文件上传、粘贴外部 HLS（`.m3u8`）地址；两种来源统一用 `hls.js` 播放
- 新增视频上传接口：接受原始视频文件（mp4/mov/webm 等常见格式），MUST 校验 MIME 类型与大小上限，成功后立即返回一个"转码中"的记录标识，不同步等待转码完成
- 新增服务端异步转码流水线：基于 `ffmpeg` 将原始视频切分为 HLS 分片（`.m3u8` + `.ts` 分片），并生成一张封面帧（poster），产物写入对象存储；引入基于 Redis 的任务队列驱动这条流水线（**BREAKING**：新增队列 worker 进程，`apps/api` 需要新增一个独立的常驻进程/入口）
- 编辑器内视频块 MUST 展示转码状态（转码中/已就绪/失败），转码完成前展示加载占位与封面帧（若已生成），失败时提示错误且不留下无效节点
- 粘贴外部 `.m3u8` 地址的场景不经过任何转码流程，直接校验地址格式后落地为可播放节点

## Capabilities

### New Capabilities
- `video-transcoding`：视频上传接受、基于 ffmpeg 的异步 HLS 转码流水线、转码状态查询、转码产物（分片 + 封面帧）的对象存储管理

### Modified Capabilities
- `document-editor`：「编辑器支持的块类型范围」新增视频块类型；新增"视频插入、上传交互、转码状态反馈与展示限制"相关需求（对齐现有图片插入交互的设计精神）

## Impact

- `apps/api`：新增视频上传路由/handler、新增基于 Redis 的任务队列（拟引入 BullMQ）与一个转码 worker 进程、新增 `VideoAsset`（或同名含义）数据模型记录转码状态与产物地址、新增转码状态查询接口
- `apps/api` 运行环境：新增 `ffmpeg` 二进制依赖（容器/部署环境需要预装或打包）
- `packages/tiptap-editor`：新增 `Video` node（`schema.ts` 保持框架无关的属性定义，播放器渲染放在 `index.ts`/组件层，遵循现有 Mermaid/图片节点"schema 与 React 渲染分离"的既有约定）；新增 `hls.js` 依赖（仅浏览器侧渲染层引入，不进入 `schema.ts`）
- `apps/web`：视频上传交互接入现有的上传回调注入模式，新增转码状态轮询逻辑
- 涉及新的运维依赖（ffmpeg、队列 worker），需要更新 `docker-compose.yml`/部署脚本
