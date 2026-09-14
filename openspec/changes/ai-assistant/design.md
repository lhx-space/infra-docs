## Context

仓库里已经有一套成熟的「多服务 + 服务间 gRPC」范式可以照抄：`apps/collab-server`（Rust）作为 gRPC **client**，把权限判断、内容/版本同步这类业务规则委托给 `apps/api`（TS，gRPC **server**），自己只做协议相关的底层存储（直连 Postgres 读写 `yjsState`）。本次新增的 AI 服务遵循同一范式：**业务规则只在 `apps/api` 留一份实现，`ai-server` 不重新实现**。

对 AI 而言，三个现成的资产直接决定了设计走向：

1. `Document.searchText` 已经是一份「服务端在保存时派生、跟随内容变化」的纯文本——它就是现成的 embedding/RAG 数据源，不需要在 Rust 侧重新解析 ProseMirror JSON 或 Yjs 二进制（`collab.proto` 里明确放弃过「在 Rust 重造 y-prosemirror」的路线，同理适用）。
2. `services/search.ts` 已经实现了「当前用户可访问的全部 Wiki/文档，跨 Team」的检索范围规则（`listWikisByUserId` + `searchDocuments(wikiIds, keyword)`），RAG 的检索范围直接复用，不发明新权限概念。
3. 文档正文的真源是协同连接驱动的 `Y.Doc`（在客户端），`ai-server` 服务端拿不到它——所以「AI 写作」的落地只能是「服务端返回结构化编辑动作 + 客户端用 Tiptap 命令应用」，而不是服务端直接改文档。

## Goals / Non-Goals

**Goals:**
- 提供飞书式的编辑器旁 AI 聊天面板，web/desktop 共用，分「写作」与「问答」两个模式。
- 「写作」模式：用户用自然语言控制当前文档的书写（生成、续写、润色、翻译、总结、扩写/缩写等），结果以「生成 → 审阅 → 应用到编辑器」的方式同步进 `Y.Doc`，并随协同连接同步给协作者。
- 「问答」模式：以当前用户有权访问的全部文档为语料做 RAG 问答，答案引用到具体文档。
- 模型可路由到 OpenAI / Anthropic / DeepSeek / 本地 Ollama 四类 provider，通过配置切换。
- AI 服务通过 gRPC 与 `apps/api` 对接，权限与文档范围复用 `apps/api` 既有实现。

**Non-Goals:**
- 不做内联 ghost-text 补全、选区气泡 AI 动作、斜杠命令 AI 入口——本轮只做聊天面板这一个 AI 界面（这些可作为后续独立 change 叠加在同一 `rig-editor-agent` 上）。
- 不做语义搜索对现有 `wiki-search` 的升级（hybrid/向量搜索 UI）——RAG 的向量能力内部使用，不改变现有搜索入口行为。
- 不做跨设备共享的「历史会话」管理界面——v1 会话在服务端短期保存（供多轮对话，见决策 13），但不对用户暴露会话列表/历史管理 UI。
- 不做本地模型的端侧打包/离线 AI（desktop 自带 Ollama 侧车）——v1 只提供 Ollama provider 配置项（指向本地 `http://localhost:11434`），端侧部署形态留待后续。
- 不做批量导入/文档摘要卡片/版本 diff 摘要/自动生成标题等「文档智能整理」类能力——聚焦聊天面板 + RAG 问答。

## Decisions

### 1. `ai-server` 是 gRPC client，`apps/api` 仍是 gRPC server（照抄 collab-server）
`ai-server` 通过 tonic 调用 `apps/api` 新增的 gRPC service 获取「文档变更枚举 / 用户可访问 Wiki 范围」，复用现有 `AccessControlService.CheckDocumentRole` 做写作权限判断；权限、检索范围的业务规则只保留在 `apps/api` 一份，不在 Rust 重复实现。**备选方案**：`ai-server` 直连 Postgres 读文档表 + 自己算权限——放弃，违背「业务规则只留一份实现」这条贯穿全仓库的原则，且会复制 `listWikisByUserId`/`requireWikiRole` 的 Team OWNER 兜底逻辑。

### 2. 客户端 ↔ `ai-server` 用 SSE 流式，不用 gRPC-Web
AI 输出必须流式，而浏览器里的 gRPC-Web 流式生态别扭、Electron 还要额外配置；SSE（HTTP 单向流）在浏览器和 Electron 里都原生可用，鉴权直接带 `Authorization` 头即可，跟现有前端 `fetch` 栈一致。`rig-common` 封装流式输出为 SSE。**前端消费方式固定为 `fetch` + `ReadableStream` + `TextDecoder`**：`fetch` 发起 POST（带 `Authorization` 头）、`response.body.getReader()` 逐块读、`TextDecoder` 解码后手动解析 `data:` 帧（按空行分隔），配合 `AbortController` 取消——不用 `EventSource`，因为它只支持 GET、无法带自定义 `Authorization` 头、也无法 POST 与主动 abort。**备选方案**：WebSocket——能力等价（仓库对 WS 已很熟），但 AI 这种「请求→单向流式返回」用 SSE 更贴合语义、状态机更简单；放弃。

### 3. `ai-server` 本地验 JWT，复用共享 `JWT_SECRET`
与 `collab-server` 完全一致：用 `jsonwebtoken` crate + 共享的 `JWT_SECRET` 环境变量本地校验 access token 签名与过期，取出 `userId`，不新增第二套鉴权体系。SSE 端点要求 `Authorization: Bearer <token>`（`packages/api-client` 已有 token 携带逻辑可复用）。

### 4. Rust 库拆成三个 crate，依赖方向 `editor-agent → rag-agent → rig-common`
- `rig-common`：`ProviderConfig`（模型路由）、SSE 流式工具、gRPC client、共享错误/类型。
- `rig-rag-agent`：embedding + pgvector 检索 + 问答 agent，对外暴露 `retrieve(context, query) -> chunks` 这类可复用检索函数。
- `rig-editor-agent`：写作 agent，把「文档上下文 + 指令」转成「结构化编辑动作 + 流式文案」；未来要「参考其他文档写这段」时直接调 `rig-rag-agent` 的检索函数。

依赖方向严格单向：`rig-editor-agent` 可依赖 `rig-rag-agent`，两者都依赖 `rig-common`，三者都不依赖 `apps/ai-server`。**备选方案**：只拆两个（`rig-rag-agent` + `rig-editor-agent`），把 provider/流式/gRPC 塞进 `apps/ai-server`——会导致两个 agent 要么重复实现、要么反向依赖 binary，破坏可测试性；放弃。

### 5. 模型路由：`ProviderConfig` 统一四种 provider，DeepSeek/Ollama 走 OpenAI 兼容协议
`rig-common` 定义 `ProviderConfig { kind: openai | anthropic | deepseek | ollama, base_url?, api_key?, model }`，启动时按配置装配 Rig 的 provider：Anthropic 用 `rig-anthropic`；OpenAI/DeepSeek/Ollama 三者都是 OpenAI 兼容协议，用 `rig-openai` 配 `base_url`（DeepSeek 指向其 API 端点、Ollama 指向 `http://localhost:11434/v1`），或 Ollama 直接用 `rig-ollama`。api_key 从环境变量读，绝不进代码/前端。**备选方案**：为每个 provider 单独写适配层——DeepSeek/Ollama 与 OpenAI 同协议，纯属重复劳动；放弃。

### 6. 编辑器状态在客户端，`rig-editor-agent` 返回结构化编辑动作，客户端用 Tiptap 命令落地
`ai-server` 拿不到 `Y.Doc`，所以「写作」不是服务端直接改文档，而是：客户端把「当前文档上下文（标题 + 纯文本/markdown + 选区/光标）+ 指令」发给 `ai-server` → `rig-editor-agent` 返回「流式文案 + 结构化编辑动作（如 `insert at cursor` / `replace selection`）」→ 客户端用 `DocumentEditor` 暴露的编辑器桥调用 Tiptap 命令，把内容写进 `Y.Doc` 并随协同连接同步。**备选方案**：服务端长连接 + agent 反向调用客户端执行工具（MCP/tool-call 回路）——更强大（支持多步 agentic 编辑）但需要双向流式与复杂状态机，v1 不做，架构上已留出演进空间。

### 7. 聊天面板「生成 → 审阅 → 应用」，不自动写正文（协同安全）
AI 生成的内容先在面板里流式展示，用户点「插入/替换」才落到编辑器——协同文档里自动写正文会突然改动协作者正在看的内容。内联「一键润色替换选中」等快捷动作留作后续，本轮统一走面板审阅。**备选方案**：生成即插入——协同场景下不安全，且用户对 AI 输出需要把关；放弃。

### 8. 意图路由：面板分「写作/问答」两个模式，对应两个 agent
v1 用一个输入框 + 显式模式切换（写作 / 问答），各自对应 `rig-editor-agent` / `rig-rag-agent`，意图清晰、可观测、出错面小。**备选方案**：单输入框自动判断意图 + 混合工具调用（一个 agent 同时握有编辑工具和检索工具）——体验更顺但需要意图判定与工具编排，复杂度和误判成本高；留作后续演进。

### 9. RAG 语料：全局索引 + 检索时按用户可访问 Wiki 过滤（对齐 wiki-search）
向量表是**全局**的：每篇文档（或分块）一条向量，内容变了重算，跟「谁在问」无关。检索时才做权限过滤：先调 `apps/api` 拿「当前用户可访问的全部 wikiId」，再在这些 wikiId 范围内做向量 top-k 检索——与 `searchDocuments(wikiIds, keyword)` 先拿 `wikiIds` 再查是同构的。权限变化不需要重新索引，只影响检索时的过滤范围。**备选方案**：按用户分别建索引——索引量随用户×文档爆炸，且权限一变就要重算，维护成本高；放弃。

### 10. 索引数据源用 `searchText`，不解析 ProseMirror JSON / Yjs 二进制
`Document.searchText` 是服务端保存时派生的纯文本，天然就是 embedding 输入；`ai-server` 通过 gRPC 拿它（连同 `title`/`wikiId`/`updatedAt`），不在 Rust 侧做任何 Schema 解析。这跟 `collab.proto` 里「不在 Rust 重造 y-prosemirror」是同一个判断。

### 11. 重索引触发：pull 模型（`ai-server` 周期调 api 的「变更文档枚举」），push 列为后续优化
`ai-server` 维护一个 `watermark`（上次索引到的 `updatedAt`），后台任务周期性调用 `apps/api` 的 `ListDocumentsChangedSince(watermark)` 拿「自上次以来内容有变的文档」，逐篇重新生成 embedding 并 upsert 到 pgvector；启动时 `watermark = epoch` 做全量。这样 `apps/api` 始终是唯一 gRPC server，不引入反向 gRPC 或队列消费。**备选方案**：`api` 保存 `searchText` 时 push 通知 `ai-server`（反向 gRPC 或 BullMQ job）——实时性更好，但需要新增反向调用方向或让 Rust 消费 BullMQ，复杂度不成比例；v1 用 pull，把「保存后尽快可检索」的诉求交给可调的轮询间隔（见 Open Questions），若实测延迟不可接受再升级为 push。**删除同步**：Prisma 侧文档是硬删除、无 tombstone，`ListDocumentsChangedSince` 查不到「已删除」，因此契约额外提供 `ListDocumentIds`（分页返回全部现存文档 ID），`ai-server` 周期性（低频，如每日）用它对比自己的向量表、删除已不存在文档的向量。

### 12. 向量存储用 pgvector（换镜像/建扩展），embedding 用 OpenAI `text-embedding-3-small`（1536 维）
Postgres 已经在仓库里，pgvector 是它原生的向量扩展，不引入新基础设施。`docker-compose.yml` 的 `postgres:16-alpine` 不含 pgvector，需换成带 pgvector 的镜像（或启动后 `CREATE EXTENSION vector`）。embedding 模型随 provider 配置：OpenAI `text-embedding-3-small`（1536 维）或本地 Ollama `nomic-embed-text`（768 维）；embedding provider 与对话 provider **解耦、各自独立配置**。**向量列维度必须与所选 embedding 模型一致**（`vector(N)` 建表时固定），切换 provider 维度不同时需重建 `document_chunks` 表（实现阶段实测：本地 Ollama 走 `nomic-embed-text` 768 维，`001_pgvector.sql` 已按此建表并注明两种维度的对应关系）。Rust 侧：embedding 用 Rig 生成；写入/检索走 `pgvector` crate + 现有 `sqlx`（若 Rig 有原生的 pgvector companion crate 则直接复用，否则用 `VectorStore` trait 做一个薄适配，二者都属于实现细节，见 tasks.md）。

### 13. 服务端会话 + 长上下文管理（不是无状态）
聊天面板是多轮对话，需要显式的会话管理与长上下文管理，二者都放在 `ai-server` 服务端做（只有服务端能统一做 token 计量与压缩）：

- **会话管理**：`ai-server` 为每次新会话生成 `sessionId` 返回给客户端，会话的消息历史存 **Redis**（复用现有 Redis，key `ai:session:{id}`，TTL 24h + 条数上限，过期即清）。客户端只持久化 `sessionId` 并随每次请求带上，不再每次全量回传历史——既省带宽，又让「摘要压缩」这类操作能在服务端统一生效。
- **长上下文管理（滚动关键要点摘要，非机械压缩）**：定义 token 预算 `MAX_CONTEXT_TOKENS`（按模型可配，如 8k）。每轮加载上下文时，若历史超出预算，把「滑出窗口之外的最旧一批消息」用一次额外 LLM 调用**智能提炼成关键要点**（用户目标 / 已确认决策 / 约束偏好 / 待办事项 / 重要实体，丢弃闲聊与已过时表述），**增量合并进一份累积摘要**——不做每轮对全历史的重总结，也不做机械截断；上下文始终由「累积关键要点摘要 + 最近 N 轮原文（N 如 6）+ 当前文档上下文 + 当前指令」构成。单条消息/文档上下文切片超长时直接截断。token 估算用 provider 的 tokenizer（Rig 支持）或保守的字符/ token 折算。

**备选方案**：无状态、客户端每次回传全量历史——实现最简，但长对话时每次请求都全量重发、客户端无法统一做 token 计量与摘要压缩，正是本决策要避免的缺陷；放弃。**另选**：会话历史存 Postgres——可持久化/多端续聊，但会话是「热、短命、可丢弃」的数据，Redis + TTL 更贴合，Postgres 留给后续做真正的「历史会话管理」时再上。

### 14. Ollama 作为基础设施层随 docker-compose 启动（与 postgres/redis/minio 同级，全面 docker 化）
本地模型是 provider 之一，Ollama 就是它的「基础设施」，跟 Postgres/Redis/MinIO 一样由 `docker-compose.yml` 起一个 `ollama` 服务：镜像 `ollama/ollama`，端口 `11434:11434`，数据卷 `./.data/ollama:/root/.ollama`（模型持久化）。模型不随镜像打包，而是通过挂载的 `ollama-entrypoint.sh`（容器启动时先 `ollama serve`、再自动 `ollama pull $OLLAMA_MODELS`）自动拉取，模型列表由 `OLLAMA_MODELS` 环境变量配置（默认 `qwen2.5:7b nomic-embed-text`）。`ai-server` 通过 `OLLAMA_BASE_URL` 连接：容器内指向 `http://ollama:11434`，本地 `cargo run` 指向 `http://localhost:11434`（compose 端口映射）。**关键约束**：macOS 的 Docker 跑在 Linux VM 里、拿不到 Metal GPU，容器内 Ollama 只能 CPU 推理（7B 模型会明显慢于宿主机原生 Metal）——这是「基础设施统一 docker 编排、环境可复现」与「mac 开发推理速度」之间的权衡，v1 优先前者。

### 15. TTS（语音朗读）：复用 Rig `audio_generation`，v1 只接 OpenAI TTS
聊天面板里 AI 回答支持语音朗读：Rig 的 `audio_generation` 模块（`AudioGenerationModel` trait）就是 TTS，`audio_generation` 返回 `AudioGenerationResponse { audio: Vec<u8>, .. }`（音频字节，如 mp3）。v1 只接 OpenAI TTS（`tts-1`，voice 默认 `alloy`、可配），需要 rig-core 的 `audio` feature。`ai-server` 新增 `POST /tts`（输入 `{text, voice?}`，返回音频字节），前端聊天面板加「朗读」按钮播放。TTS 与对话/embedding 一样走配置路由（`TTS_PROVIDER`/`TTS_MODEL`/`TTS_VOICE`），默认 OpenAI。**备选方案**：本地 Ollama 无内置 TTS（需额外部署 TTS 模型），v1 不接，列为后续演进。

### 16. STT（语音输入）：复用 Rig `transcription`，v1 只接 OpenAI Whisper
聊天面板支持语音输入：前端用 `MediaRecorder` 录音得到音频字节 → `ai-server` 的 `POST /transcribe` → Rig `transcription`（OpenAI `whisper-1`）转成文字 → 回填输入框（**不自动发送**，用户确认后再发）。需要 rig-core `audio` feature（决策 15 已启用）。**备选方案**：本地 Ollama 无内置 STT（需额外部署语音模型），v1 不接，列为后续演进。

### 17. 图片理解（vision）：聊天面板支持图片输入，复用 Rig 多模态消息
聊天面板支持粘贴/上传图片，随消息发给 LLM 理解（「描述这张图」「把图里的表格转成文字」等）。图片以 base64 经 `ai-server` 转成 Rig 的 `UserContent::Image`（`image_base64`）拼进用户消息；v1 用 base64、限制单图 5MB，后续可改为上传 MinIO 拿 URL 走 `image_url`（省请求体、可复用）。vision 能力由对话 provider 提供（OpenAI `gpt-4o`/`gpt-4o-mini` 等支持，DeepSeek/Ollama 的视觉模型按 provider 配置），provider 不支持图片时给可读错误。

## Risks / Trade-offs

- **[Risk]** pull 重索引导致「刚改完的文档立刻提问」可能命中旧向量 → **Mitigation**：轮询间隔可调（默认较小），且在问答请求里对命中结果的 `updatedAt` 做一次「比 watermark 新则临时重索引再答」的兜底（实现细节见 tasks）；若实测延迟不可接受，升级为 push（决策 11 已预留）。
- **[Risk]** AI 依赖外部 LLM provider，token 成本与延迟不可控 → **Mitigation**：模型路由可切换（含本地 Ollama），SSE 流式降低首字延迟；调用带超时与错误透传，provider 不可用时面板给出可读错误而非崩溃。
- **[Risk]** AI 生成内容可能不受控（幻觉、不当内容、错误改写）→ **Mitigation**：写作走「审阅后应用」不自动落盘；问答答案 SHALL 附引用来源便于溯源；不在本轮引入内容审核，作为已知风险记录。
- **[Risk]** 大文档全文塞进 prompt 导致 token 超限 → **Mitigation**：写作模式下上下文只取「标题 + 选区/光标附近的上下文切片」，不做整篇全量；文档过大时由客户端截断，具体切片策略见 tasks.md。
- **[Risk]** `ai-server` 引入新的 Rust 依赖（rig 全家桶）拉长构建时间 → **Mitigation**：rig 相关依赖集中在 `crates/*` 三个库 crate，`apps/ai-server` 保持薄；与 `collab-server` 共用 workspace 依赖的既有部分不重复编译。
- **[Risk]** pgvector 镜像切换影响现有本地/CI 数据库环境 → **Mitigation**：迁移计划里明确「换镜像 + 建扩展」步骤与回滚方式（回退到原镜像只需移除扩展与向量表）。
- **[Risk]** 会话历史随使用增长、关键要点摘要引入额外 LLM 延迟且摘要可能丢失关键信息 → **Mitigation**：会话存 Redis 带 TTL + 条数上限，增量滚动总结（只总结滑出窗口的增量，不做每轮全量重算），保留最近 N 轮原文兜底，总结 prompt 明确「提炼关键要点而非压缩文本」的口径。
- **[Risk]** Ollama 容器在 macOS 上无 GPU、推理慢 → **Mitigation**：默认走「宿主机原生 Ollama（Metal）」路径，容器内 Ollama 主要面向 Linux/CI；文档里明确两种路径的切换方式。

## Migration Plan

纯增量改动，不触碰任何既有业务表结构与数据：
1. 根 `Cargo.toml` 新增 `apps/ai-server` 与三个 `crates/*` 到 workspace members，并在 `[workspace.dependencies]` 加入 rig 相关依赖。
2. 新增 `/protos/ai/v1/ai.proto`，`apps/api` 新增对应 gRPC service 实现（复用 `listWikisByUserId` 等既有函数）。
3. 数据库：`docker-compose.yml` 换 pgvector 镜像（或保留镜像 + 启动脚本建扩展），新增向量表（由 `ai-server` 侧 sqlx 建表/迁移，不进 Prisma）。
4. 实现 `crates/rig-common`、`crates/rig-rag-agent`、`crates/rig-editor-agent`，实现 `apps/ai-server`（SSE 端点 + gRPC client + 后台索引任务）。
5. `packages/api-client` 新增 AI 流式客户端；新增 `packages/ai-chat`；`packages/tiptap-editor` 的 `DocumentEditor` 暴露编辑器桥。
6. `apps/web`/`apps/desktop` 挂载聊天面板 + 配置 `ai-server` 地址。
7. 回滚方式：移除新增服务/包/向量表/扩展即可，不需要任何数据回填或既有表结构变更。

## Open Questions

- 重索引轮询间隔定多少？v1 建议 30s，可在 env 配置；是否需要在问答命中「未索引到最新」的文档时做临时重索引兜底（决策 11 已提），实现阶段定。
- 向量粒度：整篇文档一个向量 vs 按块（段落/标题段）分块多向量？v1 建议按块分块（利于长文档检索与引用定位），块大小（如 500–1000 token）与重叠策略实现阶段定。
- 「写作」模式下上下文切片的范围（前后多少字符/块）与超长文档的截断策略，实现阶段定。
- 聊天面板是否需要有独立的全局入口（不打开文档也能问答），还是只在文档编辑视图内出现？v1 先只在文档编辑视图内，后续评估。
- 是否需要给 AI 调用加用户级速率限制（复用 `apps/api` 现有 rate-limit 思路，还是在 `ai-server` 侧加）？实现阶段定。
- 滚动关键要点摘要的触发阈值（token 预算的百分比）、「保留最近 N 轮」的 N 值、会话 TTL 的精确取值——决策 13 给了默认（8k / 6 轮 / 24h），实现阶段按真实模型上下文窗口与使用反馈标定。
