## Why

这是一个实时协同的 Wiki/文档平台，web 与 desktop 两端共享同一套编辑器（`packages/tiptap-editor`）与业务层（`packages/app`），但至今没有任何 AI 能力：写文档全靠手工，检索只有 `searchText` 的关键词 `contains` 匹配，跨文档的知识沉淀只能靠人肉翻阅。对一款以「Wiki 协作」为定位的产品来说，这是能力上的一块明显缺口——同类产品（飞书文档/Notion）已经把「聊天式 AI 写作助手 + 知识库问答」做成了标配。现在补齐这块能力，让用户在编辑器的同一侧边栏里既能用自然语言控制文章书写、又能就「自己有权访问的全部文档」提问。

## What Changes

- 新增 `apps/ai-server`：**用 Rust（Rig + Axum + tonic）实现**的独立 AI 服务，对外提供 SSE 流式端点；本地校验 access token（复用 `collab-server` 的 JWT 校验方式，共享 `JWT_SECRET`）；通过 gRPC 调用 `apps/api` 获取权限与文档数据——业务规则（权限、文档范围）仍只在 `apps/api` 保留一份实现，`ai-server` 不重复实现，跟 `collab-server` 与 `apps/api` 的既有分工完全一致。服务端维护多轮会话（Redis）并做长上下文管理（滑动窗口 + 摘要压缩），客户端只持 `sessionId`。
- 新增三个 Rust 库 crate（仓库根目录 `crates/` 下，`ai-server` 依赖它们）：
  - `rig-common`：模型路由（OpenAI / Anthropic / DeepSeek / 本地 Ollama）、SSE 流式工具、gRPC client、公共类型。
  - `rig-editor-agent`：写作 agent，输入（当前文档上下文 + 用户指令）→ 输出（结构化编辑动作 + 流式文案）。
  - `rig-rag-agent`：RAG agent，embedding 生成、pgvector 检索、带引用的知识库问答。
- 新增 `apps/web` 与 `apps/desktop` 共用的 AI 聊天面板（飞书式 Copilot 侧边栏）：挂在文档编辑视图旁，分「写作」（控制文档书写并同步到编辑器）与「问答」（就知识库提问）两个模式。
- 新增 RAG 知识库问答：以「当前用户有权限访问的全部文档」为动态语料，向量存 pgvector，答案引用到具体文档。
- 新增服务间 gRPC 契约 `/protos/ai/v1/ai.proto`（`apps/api` 实现、`ai-server` 调用），复用现有 `protos/collab/v1/collab.proto` 的 `AccessControlService.CheckDocumentRole` 做写作权限判断。

## Capabilities

### New Capabilities
- `ai-assistant`: 编辑器旁 AI 聊天面板（写作 + 问答两模式）、写作 agent 的结构化编辑动作、SSE 流式输出、模型路由、`ai-server` 服务本身、客户端鉴权与权限约束。
- `ai-knowledge-qa`: 以当前用户可访问文档为动态语料的 RAG 问答、pgvector 索引与检索、内容变更触发的重索引、答案引用来源、检索范围按用户权限过滤。

### Modified Capabilities
（无——AI 是全新的能力入口，不改变 `document-editor`/`wiki-search`/`realtime-collaboration` 已有需求的行为。语义搜索对 `wiki-search` 的增强列为 Non-Goal，留给后续独立 change。）

## Impact

- **新增服务**：`apps/ai-server`（Rust，Rig + Axum + tonic + sqlx + jsonwebtoken），常驻进程，需要对外暴露 SSE 端口，`docker-compose.yml`/生产部署拓扑需要同步调整；这是仓库里第三个 Rust 服务（复用 `collab-server` 已沉淀的 handler/service/repository 分层与 Dockerfile 套路）。
- **新增 Rust 库 crate**：`crates/rig-common`、`crates/rig-editor-agent`、`crates/rig-rag-agent`；根 `Cargo.toml` 的 `[workspace] members` 从 `["apps/collab-server"]` 扩为包含 `apps/ai-server` 与这三个 crate，并在 `[workspace.dependencies]` 新增 Rig 相关依赖（`rig-core` + `rig-openai`/`rig-anthropic`/`rig-ollama` 等）。
- **新增服务间通信契约**：`/protos/ai/v1/ai.proto`，作为 `ai-server`（Rust gRPC client）与 `apps/api`（gRPC server 新增实现）之间调用「文档变更枚举 / 用户可访问 Wiki 范围」的唯一契约来源。
- **数据库**：启用 pgvector 扩展并新增向量表（存文档 embedding，含文档 ID/分块/向量；embedding 用 OpenAI `text-embedding-3-small`、1536 维），`docker-compose.yml` 的 Postgres 镜像需从 `postgres:16-alpine` 换为带 pgvector 的镜像（或启动后 `CREATE EXTENSION vector`）；不新增/修改任何 Prisma 业务模型。
- **基础设施**：`docker-compose.yml` 新增 `ollama` 服务（本地模型基础设施层，与 postgres/redis/minio 同级），`ai-server` 通过 `OLLAMA_BASE_URL` 连接；本地开发可指向宿主机原生 Ollama（Metal 加速）。
- **`apps/api`**：新增 `ai.proto` 对应的 gRPC service 实现（枚举变更文档、返回用户可访问 Wiki 范围），复用现有 `listWikisByUserId`/`requireWikiRole` 的判断逻辑，不在别处重新实现权限。
- **`packages/api-client`**：新增 AI 流式客户端（SSE 读取 + 解析），供聊天面板使用。
- **新增前端包 `packages/ai-chat`**：AI 聊天面板组件（写作/问答两模式、流式渲染、应用到编辑器的交互），web/desktop 共用；`packages/tiptap-editor` 的 `DocumentEditor` 需暴露最小化的「编辑器桥」（读上下文 + 插入/替换内容），供面板落盘到 `Y.Doc`。
- **`apps/web` / `apps/desktop`**：文档编辑视图挂载聊天面板，新增 `ai-server` 地址的运行配置（对齐现有 `VITE_API_BASE_URL`/`VITE_COLLAB_WS_URL` 的编译期常量方式）。
- **依赖（Rust 侧，新增）**：`rig-core` 及 provider 配套 crate（OpenAI/Anthropic/Ollama）、`pgvector`（或 Rig 的向量存储薄适配）+ 现有 `sqlx`；其余（`tokio`/`axum`/`tonic`/`prost`/`jsonwebtoken`/`tracing`/`serde` 等）全部复用 workspace 已有依赖。
- **构建工具链**：`ai-server` 的 `build.rs` 编译 `protos/ai/v1/ai.proto`（复用 `collab-server` 的 `tonic-build` 套路），CI 侧沿用 gRPC proto 契约校验的既有做法。
