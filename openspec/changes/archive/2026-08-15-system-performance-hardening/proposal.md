## Why

三个此前未被系统性处理的性能/健壮性缺口，分别在前端渲染层、协同服务层、构建与部署层各有一个真实风险点：①文档编辑器把整篇内容渲染进同一棵 contenteditable DOM 树且几类重节点（Mermaid/视频/代码块）不论是否在视口内都常驻挂载，文档变大后渲染与输入性能会线性变差；②`collab-server` 对 `apps/api` 的 gRPC 依赖只有"懒连接 + 失败即报错"，没有重试/熔断，也没有对齐视频转码链路（BullMQ + Redis 重试策略）已经具备的健壮性水位，`apps/api` 短暂不可用时新连接会逐个等超时、周期性持久化失败直接丢弃本轮同步；③`apps/api` 的生产构建路径（`tsc -p tsconfig.build.json`）当前实测直接报错（`nodenext` 强制要求相对导入带 `.js` 后缀，且暴露出若干 CJS/ESM 互操作类型错误），而 CI 里确实存在一个跑这条路径的 Docker 构建校验 job；同时生产进程管理还停留在容器 `restart` 兜底崩溃重启，没有让 `api` 服务利用多核。这三处一起处理，覆盖"用户能感知的编辑器性能"到"看不见但决定可用性的服务健壮性/可部署性"。

## What Changes

- 文档编辑器长文档渲染性能：
  - 编辑区块级容器引入 `content-visibility: auto`，让浏览器跳过视口外内容的布局/绘制计算（纯 CSS，不改变 DOM 结构与 contenteditable 行为）
  - 大纲（`useDocumentOutline`）的全文档扫描从"每次 `update` 都算"改为防抖后才算
  - Mermaid/视频 NodeView 引入基于 `IntersectionObserver` 的懒挂载：视口外只渲染占位（保留高度），进入视口附近才真正触发 `mermaid.render()` / 建立 HLS 播放实例；离开视口可释放视频播放资源
  - 超出块数阈值时提供"建议拆分为子文档"的软提示（不做强制限制，不做真正的内容虚拟化——ProseMirror 的原生光标/IME 行为依赖整棵 DOM 在场，虚拟化在当前架构下不现实，见 design.md）
- `collab-server` 对 `apps/api` gRPC 依赖的健壮性：
  - gRPC 调用（`check_document_role`/`get_document_content`/`sync_document_content`）对暂时性失败增加指数退避重试
  - 引入简单熔断器：连续失败超过阈值后，新的 WS 连接鉴权请求直接快速失败（不再逐个等 gRPC 超时），并周期性尝试半开探测恢复
  - 周期性持久化失败时不再是"打日志然后静默丢弃这一轮"，缩短下一次重试间隔，并在连续多轮失败时记录可观察的告警信号
- `apps/api` 构建工具链与生产进程管理：
  - **BREAKING（内部构建产物层面，不影响对外 API）**：生产构建从 `tsc -p tsconfig.build.json` 直接产出 JS，改为用打包器（复用 `packages/tiptap-editor` 已在用的 `tsup`/esbuild 路线）产出 `dist`，`tsc --noEmit`（现有 `Bundler` 解析）继续专职类型检查，两者分工，不再要求相对导入显式带 `.js` 后缀
  - 显式声明 `sharp`/`pg`/`ioredis`/`fluent-ffmpeg`/`@grpc/grpc-js`/Prisma 生成 client 等原生或运行时读取文件路径的依赖为打包 external，保证 gRPC `.proto` 加载、Prisma client 等运行时路径不受影响
  - 生产环境为 `api`（HTTP+gRPC）服务引入 PM2 cluster 模式以利用多核；`worker`（BullMQ 消费者）维持单进程，不套用 cluster（避免 `VIDEO_TRANSCODE_CONCURRENCY` 被进程数隐性放大）

## Capabilities

### New Capabilities
- `document-editor-performance`: 长文档场景下编辑器的渲染/交互性能保障（视口外内容渲染跳过、重节点懒挂载、超大文档的拆分引导）
- `collab-server-resilience`: `collab-server` 对下游 `apps/api` gRPC 依赖的重试、熔断与持久化失败恢复策略
- `api-build-tooling`: `apps/api` 生产构建产物的生成方式与模块解析约束，以及生产环境进程管理策略

### Modified Capabilities
（无——三块均为新增的非功能性能力，不改变 `document-editor`/`realtime-collaboration`/`video-transcoding` 等现有能力的对外行为契约）

## Impact

- `packages/tiptap-editor/src/styles/*.css`、`src/hooks/use-document-outline.ts`、`src/components/MermaidView.tsx`、`src/components/VideoView.tsx`：新增懒挂载逻辑与样式
- `apps/collab-server/src/service/grpc_client.rs`、`src/service/collab.rs`、`Cargo.toml`：新增重试/熔断实现
- `apps/api/tsconfig.build.json`、`package.json`（build 脚本）、新增打包器配置文件、`apps/api/Dockerfile`：构建产物生成方式调整
- `docker-compose.yml`、`apps/api/Dockerfile`（或新增 PM2 配置文件）：生产进程管理调整
- 不涉及数据库 schema 变更；不改变任何对外 HTTP/gRPC 接口契约
