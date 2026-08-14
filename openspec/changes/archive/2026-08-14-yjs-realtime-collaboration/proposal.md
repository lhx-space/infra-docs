## Why

项目从立项之初就以 `yjs-docs` 命名，`document-editor` 主 spec 也明确写着"编辑器不接入 Yjs 实时协同（留给后续独立 change）"——这不是遗漏，是刻意预留的核心能力，一直悬而未决。目前多人协作只能靠"离散保存 + 手动刷新看到别人的最新内容"，无法多人同时编辑同一篇文档、看不到对方的光标/选区，跟"Wiki 协作工具"的产品定位不匹配。现在补齐这块能力，让文档编辑器具备真正的实时多人协同。

## What Changes

- 新增 `apps/collab-server`：**用 Rust（Axum + `yrs`/`y-sync`）实现**的常驻 WebSocket 服务，承载 Yjs 文档的实时同步、CRDT 二进制状态持久化（Postgres）。技术栈选 Rust 而非 Node，是因为团队已有生产级 Rust 服务（`infra-sso`）的工程与部署经验，且 `yrs` 与 JS 版 Yjs 协议二进制兼容，前端仍用标准的 `y-websocket` 客户端，不受服务端语言影响。
- 新增服务间 gRPC 契约（`.proto` 文件存放在仓库根目录 `/protos`）：`collab-server`（Rust，gRPC 客户端）通过 gRPC 调用 `apps/api`（TS，新增 gRPC server）完成两类业务规则判断——连接建立时的 Wiki 角色鉴权、持久化时的内容同步与版本快照触发；业务逻辑只在 `apps/api` 保留一份实现，`collab-server` 不重复实现，避免跨语言的逻辑漂移。
- `packages/tiptap-editor` 接入 `@tiptap/extension-collaboration` + `@tiptap/extension-collaboration-caret`：编辑器状态映射为 Yjs CRDT 结构，展示协作者光标/头像/颜色；关闭 `StarterKit` 自带的 `history`，改用协同版 undo manager（避免多人协同下撤销互相影响）。
- **BREAKING**：文档内容的权威存储从"离散 ProseMirror JSON 快照"变为"Yjs 文档的二进制 CRDT 状态"。存量文档采用惰性迁移（首次被协同打开时才转换，不做批量迁移脚本），迁移后旧的 `PATCH /documents/:id` 保存整篇 JSON 的写入路径不再是内容更新的唯一来源。
- `document-versioning` 的版本快照触发时机从"离散保存事件的会话中断阈值"调整为"协同持久化时的定期打点"，触发规则本身不变（仍由 `apps/api` 判断），只是调用来源从 REST handler 变为 `collab-server` 的 gRPC 调用；版本记录的存储内容（完整快照）与查看/恢复的权限边界保持不变。
- Wiki 角色鉴权从"仅 HTTP 请求头校验"扩展到"WebSocket 连接建立时校验"：`VIEWER` 建立只读连接（不接收/不能推送变更），`EDITOR` 及以上建立可写连接；连接期间角色被降级的，下次重连时按新角色生效（本次不做连接中途强制断开）。
- 前端离线缓存从自建的 `offline-cache.ts`（IndexedDB 存 JSON）切换为 Yjs 官方的 `y-indexeddb`（IndexedDB 存 CRDT 更新，离线合并由 Yjs 原生处理，不需要自己实现冲突解决）。
- `docker-compose.yml` 新增 `collab-server` 服务定义（独立的 Rust 构建产物/镜像），`apps/api` 服务定义新增 gRPC 端口暴露。

## Capabilities

### New Capabilities
- `realtime-collaboration`: 多人实时协同编辑（Yjs CRDT 同步）、协作者 presence（在线用户列表、光标/选区/头像展示）、连接级权限校验、存量文档惰性迁移。不含离线编辑（仍保持离线只读，见 design.md Non-Goals）。

### Modified Capabilities
- `document-editor`: 移除"编辑器不接入 Yjs 实时协同"的既有限定，新增协同扩展集成、离线缓存机制从自建 IndexedDB 切换为 `y-indexeddb`；原有的块类型范围、斜杠命令、大纲导航、图片/视频上传交互等需求不变。
- `document-versioning`: 版本快照触发条件从"离散保存的会话中断阈值"改为"协同更新流的定期打点"；快照存储粒度（完整快照）、查看/恢复的角色权限边界不变。

## Impact

- **新增服务**：`apps/collab-server`（Rust，Axum + `yrs`/`y-sync` + `tonic` + `sqlx`），常驻进程，需要 WebSocket 端口对外暴露，`docker-compose.yml`/生产部署拓扑需要同步调整；这是仓库里第二个非 TS/Node 的服务（团队已有 `infra-sso` 的 Rust 运维经验可直接复用）。
- **新增服务间通信契约**：仓库根目录新增 `/protos` 目录存放 `.proto` 文件，作为 `collab-server`（Rust）与 `apps/api`（TS）之间 gRPC 调用的唯一契约来源；`apps/api` 新增 gRPC server（独立端口，与现有 HTTP server 并存）。
- **数据库**：`Document` 模型新增 `yjsState Bytes?` 字段（可空，向后兼容）；存量文档采用惰性迁移（首次协同打开时转换），不需要批量迁移脚本。
- **`packages/tiptap-editor`**：新增协同相关 extension 依赖，`DocumentEditor` 组件的 props（如 `collaboration: { document, provider, awareness }`）需要扩展，是一次公开 API 变更；不引入 `@hocuspocus/provider`，改用协议兼容的标准 `y-websocket` 客户端。
- **`apps/web`**：文档编辑页面需要建立并维护 WebSocket 连接（含重连、离线提示的用户体验），`offline-cache.ts` 的调用方需要切换到 `y-indexeddb`。
- **`apps/api`**：现有 `requireWikiRole` 中间件复用的判断逻辑通过新增的 gRPC server 暴露给 `collab-server` 调用（不是抽共享包给 Rust 复用，也不是被 Rust 重新实现）；`PATCH /documents/:id` 正文更新路径新增"`yjsState` 非空则拒绝"的前置校验。
- **依赖（TS 侧）**：新增 `yjs`、`y-prosemirror`、`@tiptap/extension-collaboration`、`@tiptap/extension-collaboration-caret`、`y-websocket`、`y-indexeddb`；`apps/api` 新增 gRPC server 相关依赖（`@grpc/grpc-js` + `@grpc/proto-loader`，动态加载 `.proto`，不引入静态 TS 代码生成工具链，见 tasks.md 1.2）以及 `yjs`/`y-prosemirror`（**实现阶段新增**：ProseMirror JSON ↔ Yjs 二进制的转换收敛到 `apps/api` 完成，见 design.md 决策 5 的修正说明，不是 Rust 侧转换）。
- **依赖（Rust 侧，新增 `apps/collab-server`）**：`axum`、`tokio`、`yrs`、`y-sync`、`sqlx`、`tonic`/`prost`（gRPC 客户端 + Protobuf 代码生成）、`jsonwebtoken`（本地校验 access token 签名）。
- **构建工具链**：新增 Protobuf 代码生成步骤（如 `buf`/`protoc`），需要在 CI 里校验生成产物与 `.proto` 源文件保持同步。
