## 1. gRPC 契约与数据模型

- [x] 1.1 新增 `/protos/ai/v1/ai.proto`：定义 `AiDataService`（`ListDocumentsChangedSince`、`ListAccessibleWikis`、`ListDocumentIds`），覆盖 `ai-server` 从 `apps/api` 取「变更文档枚举」/「用户可访问 Wiki 范围」/「全量现存文档 ID（删除对账）」三类数据；写作权限复用现有 `protos/collab/v1/collab.proto` 的 `AccessControlService.CheckDocumentRole`，不重复定义
- [x] 1.2 `apps/api` 侧接入 `ai.proto`（`ai-proto-loader.ts` 动态加载），Rust 侧接入 `tonic-build`/`prost` 代码生成（编译在 `crates/rig-common/build.rs`，非 ai-server）
- [x] 1.3 数据库：`docker-compose.yml` 的 Postgres 镜像换成 `pgvector/pgvector:pg16` + 挂载 init 脚本（`CREATE EXTENSION vector` + 建向量表），新增向量表 `document_chunks`（`document_id`/`wiki_id`/`chunk_index`/`content`/`embedding vector(1536)`/`updated_at`，HNSW 索引，按块分块，见 `apps/ai-server/db/init/001_pgvector.sql`）

## 2. `apps/api`：新增 gRPC service 实现

- [x] 2.1 实现 `ListAccessibleWikis`：新增 `listAccessibleWikiIds`（WikiMember ∪ Team OWNER 兜底，与 `checkWikiAccess` 同口径；比 `listWikisByUserId` 多覆盖 Team OWNER 兜底），不新写权限逻辑
- [x] 2.2 实现 `ListDocumentsChangedSince` + `ListDocumentIds`：按 `updatedAt` 枚举自 watermark 以来内容有变的文档 + 全量现存文档 ID 分页（均 keyset 游标分页，见 `models/document.ts`）
- [x] 2.3 确认 `AccessControlService.CheckDocumentRole` 对 `ai-server` 可用（角色判断逻辑复用 `services/wiki-access.ts` 的 `checkDocumentAccess`，与 REST 路径同一份实现），在 `ai.proto` 注释中补充复用说明

## 3. Rust 库 crate：`crates/rig-common`

- [x] 3.1 初始化 `crates/rig-common`：定义 `ProviderConfig { kind: openai|anthropic|deepseek|ollama, base_url?, api_key?, model }` 与从 env 加载的逻辑（`config.rs`）
- [x] 3.2 封装模型路由：按 `ProviderConfig` 装配 Rig provider（rig-core 0.42 已合并全部 provider 进 `providers` 模块，DeepSeek/Ollama 走 OpenAI 兼容协议），暴露统一的 completion/stream 入口（`chat.rs` 的 `ChatModel`）
- [x] 3.3 封装 SSE 流式输出工具（`sse.rs`）与 gRPC client 装配（`grpc.rs` 的 `AiDataClient`/`AccessControlClient`，tonic channel）
- [x] 3.4 TTS 模型路由：封装 `TtsModel`（Rig `audio_generation`，v1 OpenAI `tts-1`，`tts.rs`）
- [x] 3.5 STT 模型路由：封装 `TranscribeModel`（Rig `transcription`，v1 OpenAI `whisper-1`，`transcribe.rs`，决策 16）

## 4. Rust 库 crate：`crates/rig-rag-agent`

- [x] 4.1 初始化 `crates/rig-rag-agent`：`retrieve` 检索函数与类型已实现（`lib.rs`）；「问答编排」（检索片段喂 LLM 生成带引用答案）在 `apps/ai-server` 的 `handler/chat.rs::handle_ask` 实现（rag-agent 提供检索原语，编排在服务层）
- [x] 4.2 实现 embedding 生成（Rig）与 pgvector 写入/检索（`pgvector` crate + sqlx，`index_document`/`retrieve`/`delete_document_chunks`），分块 v1 整篇一段（按块分块见 Open Questions）
- [x] 4.3 实现检索范围过滤：`retrieve` 按 `wiki_id = ANY($2)` 过滤；`ListAccessibleWikis` 的调用在 ai-server 问答 handler 组装，无命中返回空 chunks（上层转「未找到」）

## 5. Rust 库 crate：`crates/rig-editor-agent`

- [x] 5.1 初始化 `crates/rig-editor-agent`：定义 `EditorContext` 输入类型 + `generate` 输出流式文案；结构化编辑动作（insert/replace_selection）作为扩展位保留，v1 前端按「是否选中」推断动作（见 design 决策 7）
- [x] 5.2 写作 agent 完整指令集：system prompt 明确列出生成/续写/润色/翻译/总结/扩写/缩写七类操作及各自语义（`rig-editor-agent` 的 `build_system_prompt`）
- [x] 5.3 预留「参考其他文档」扩展位：editor-agent 依赖 rag-agent，`retrieve` 可调用（v1 不强制接入）

## 6. `apps/ai-server` 服务

- [x] 6.1 初始化 `apps/ai-server` 骨架：Rust + Axum + Tokio，装配 ChatModel/Embedder/RagAgent/EditorAgent/gRPC client + `/health` 端点；proto 编译在 `crates/rig-common/build.rs`（编译 `ai.proto` + `collab.proto`）
- [x] 6.2 SSE 端点：`POST /chat`（`Authorization` 头 + `{mode, instruction, document_id?, title?, selected_text?, context_slice?}`），按 mode 路由 write/ask，SSE 流式返回（`handler/chat.rs`；history 会话字段随 6.7 会话管理补充）
- [x] 6.3 本地验 JWT：`utils/jwt.rs` 用 `jsonwebtoken` + 共享 `JWT_SECRET` 校验 token 签名与过期，取出 `userId`（与 collab-server 同款）
- [x] 6.4 写作权限：write 请求前调 `CheckDocumentRole`，`role >= EDITOR`（含 Team OWNER 兜底）才接受，否则 403
- [x] 6.5 后台索引任务：`service/indexer.rs` 维护 `watermark`，周期调 `ListDocumentsChangedSince` 增量重索引 + 周期 `ListDocumentIds` 删除对账
- [x] 6.6 CORS 配置（`tower-http` cors，v1 开发放开全部来源，生产收紧见 Open Questions），错误透传（provider 不可用时返回可读错误）
- [x] 6.7 会话管理：会话历史存 Redis（`service/session.rs`，TTL + 条数上限），`sessionId` 由客户端生成（前端 uuid）、服务端按 id 读写历史，流式结束写回 user/assistant
- [x] 6.8 长上下文管理：token 预算 + 保留最近 N 轮原文 + 滚动关键要点摘要（`SessionManager::build_history`/`summarize`，LLM 增量提炼滑出窗口历史、合并进累积摘要，`session.rs`）
- [x] 6.9 TTS 端点：`POST /tts`（`{text, voice?}` → 音频字节 mp3），复用 `TtsModel`（`handler/tts.rs`，决策 15）
- [x] 6.10 STT 端点：`POST /transcribe`（音频字节 → `{text}`），复用 `TranscribeModel`（`handler/transcribe.rs`，决策 16）
- [x] 6.11 chat 端点支持图片：请求带图片 base64 → `UserContent::Image` 多模态消息（`ChatMessage.images`，决策 17）

## 7. 前端：`packages/api-client` + `packages/tiptap-editor` + 新增 `packages/ai-chat`

- [x] 7.1 `packages/api-client`：新增 AI 流式客户端（`services/ai.ts` 的 `streamChat`/`synthesizeTts`），`fetch` + `ReadableStream` + `TextDecoder` 手动解析 SSE 帧 + `AbortController`；config 加 `aiBaseUrl`
- [x] 7.2 `packages/tiptap-editor`：`DocumentEditor` 暴露 `EditorBridge`（`getContext`/`apply`），经 `onEditorReady` 回调，保持对既有调用方无破坏
- [x] 7.3 新增 `packages/ai-chat`：`AIChatPanel` 组件（消息列表 + 输入框 + 模式切换 写作/问答 + 流式渲染 + 「插入/替换」应用按钮 + 「朗读」按钮）
- [x] 7.4 写作模式上下文采集：客户端组装「标题 + 选区/光标附近切片 + 指令」（`EditorBridge.getContext`）
- [x] 7.5 客户端持久化 `sessionId`（localStorage），请求只带 `sessionId` + 当前消息
- [x] 7.6 聊天面板「朗读」按钮：请求 `synthesizeTts`（`/tts`）播放音频
- [x] 7.7 聊天面板麦克风按钮：`MediaRecorder` 录音 → `transcribeAudio`（`/transcribe`）→ 回填输入框（决策 16）
- [x] 7.8 聊天面板图片输入：粘贴/上传 → base64 → `images` 随消息发给 LLM（决策 17）

## 8. `apps/web` / `apps/desktop` 集成

- [x] 8.1 `apps/web`：`DocumentEditorPage` 挂载 `AIChatPanel`，注入编辑器桥；`VITE_AI_BASE_URL` 运行配置
- [x] 8.2 `apps/desktop`：复用 `packages/app` 的同一挂载，`aiBaseUrl` 默认 `http://localhost:4100`（Ollama provider 配置项在 ai-server 侧，端侧打包仍为后续）
- [x] 8.3 应用权限 UI：`VIEWER` 不暴露写回桥（`onEditorReady` 里 `canEdit` 才 set），「插入/替换」隐藏

## 9. 部署配置

- [x] 9.1 `docker-compose.yml`：Postgres 换 pgvector 镜像 + init 脚本建扩展；新增 `ollama` 服务 + `ai-server` 服务（`apps/ai-server/Dockerfile`，复用 postgres/api/redis，暴露 4100，`OLLAMA_BASE_URL` 指向 ollama；macOS 无 GPU 的说明已写入注释）
- [x] 9.2 `apps/ai-server/.env.example` 完整（含 provider/embedding/TTS/会话/索引），并创建 `.env`
- [x] 9.3 CI：rust job 的 `cargo clippy -- -D warnings`/`cargo test` 全 workspace 已覆盖 ai-server；docker job 新增 ai-server 镜像构建；`verify-grpc-proto` 已扩展校验 `ai.proto`

## 10. 验证

- [ ] 10.1 写作闭环：登录用户打开文档 → 面板写作模式生成一段内容 → 点击「插入」→ 确认写入 `Y.Doc` 且另一协作者实时看到
- [ ] 10.2 权限：`VIEWER` 无法应用生成结果；非成员被拒；`EDITOR` 正常应用
- [ ] 10.3 问答闭环：提问命中可访问文档 → 答案带引用可跳转；无命中 → 提示未找到而非编造；无权 Wiki 的文档不出现在结果与引用中
- [ ] 10.4 动态语料：编辑文档保存后，在可接受延迟内新内容可被检索；新文档纳入、文档删除后索引同步
- [ ] 10.5 权限动态生效：用户被移出 Wiki 后，该 Wiki 文档不再可检索（无需重索引）
- [ ] 10.6 流式与容错：`fetch` + `ReadableStream` + `TextDecoder` 流式正常；provider 不可用/流中断给出可读错误并允许重试
- [ ] 10.7 会话与长上下文：多轮追问共享上下文；历史超预算触发摘要压缩后仍正常；会话 TTL 过期后新会话
- [x] 10.8 构建回归：api/web/desktop/app 全量 typecheck 通过；`cargo check`/`cargo clippy -- -D warnings`/`cargo build -p ai-server` 通过；关键 packages（api-client/tiptap-editor/core/ai-chat）build 通过
