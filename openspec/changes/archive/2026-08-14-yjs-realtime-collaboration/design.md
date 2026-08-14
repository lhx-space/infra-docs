## Context

当前文档内容的权威存储是 `Document.content`（Prisma `Json` 字段，直接存 `editor.getJSON()` 的 ProseMirror JSON），保存路径是前端自动保存防抖后调用 `PATCH /documents/:id`，整篇覆盖写入。`searchText` 字段由服务端在同一次保存时从 `content` 派生更新（供 `wiki-search` 使用）。版本历史（`document-versioning`）按"编辑会话中断阈值"（30 分钟）在同一次保存路径里判断是新建版本记录还是更新最近一条。权限模型是 `requireWikiRole` 中间件，在 HTTP 请求进入时校验，逻辑是"先查 Team OWNER 兜底权限，否则查 `WikiMember` 表"（`middlewares/require-wiki-role.ts`）。离线场景由前端自建的 `offline-cache.ts`（原生 IndexedDB）缓存已浏览过的 Wiki/文档树/文档内容，离线时只读，不支持离线编辑。

`apps/api` 是单体 Express（TS）服务，`apps/desktop`（Electron）目前只是脚手架，尚未接入任何业务逻辑。`packages/tiptap-editor` 是框架无关的 Tiptap 封装包，消费方是 `apps/web`（React SPA），`apps/api` 只通过 `schema.ts` 子路径引入其纯 Schema 定义做内容校验，不引入任何浏览器相关代码。

团队已有一个独立维护的 Rust 服务（`infra-sso`，Axum + SQLx + Tokio 技术栈），具备生产级 Rust 工程经验与部署/运维习惯，这是本次协同服务选型的重要前提。

## Goals / Non-Goals

**Goals:**
- 同一篇文档支持多人同时编辑，变更实时同步到所有在线协作者。
- 展示协作者 presence：在线用户列表、光标/选区位置、用户名与头像色块。
- WebSocket 连接建立时复用现有 Wiki 角色语义（`OWNER`/`EDITOR`/`VIEWER`，含 Team OWNER 兜底权限），角色不足的连接以只读模式建立。
- 存量文档零停机迁移：不需要一次性批量迁移脚本或维护窗口，文档在首次被协同打开时才惰性初始化。
- 版本历史、搜索纯文本派生这两项既有能力在切换存储模型后行为不变（用户感知不到差异）。
- 权限判断、版本快照策略这类领域业务规则 SHALL 只有一份实现（`apps/api`，TS），跨语言服务间不重复实现、不产生漂移风险。

**Non-Goals:**
- **不做离线可编辑**：仍然保持"离线只读，网络恢复后拉取最新内容"的既有语义（见 `document-editor` spec「离线只读缓存」）。虽然 `y-indexeddb` 技术上具备离线编辑本地暂存、重连自动合并的能力，但离线编辑涉及"离线期间角色被降级怎么处理"等新的权限时序问题，值得单独一次 change 评估，本次只把它当作在线场景下的本地缓存加速层使用，不开放离线时的编辑入口。
- **不做文档标题的实时协同**：标题仍是独立字段，走现有 `PATCH /documents/:id` 保存，不并入 Yjs 共享类型（标题编辑冲突概率低，不值得为此扩大本次改动范围）。
- **不做评论/批注**：这是完全独立的能力，不在本次范围内。
- **不做多设备/多账号会话管理**：跟本次话题相关但独立（另一轮讨论已确认，等桌面端就位后再评估）。
- **不做离线冲突的人工审计/合并 UI**：Yjs 的自动合并对绝大多数并发编辑场景已经足够，本次不引入额外的冲突提示/回滚界面。
- **不引入 gRPC 作为公开 API 协议**：本次新增的 gRPC 契约只用于 `collab-server`（Rust）与 `apps/api`（TS）之间的内部服务间通信，`apps/web` 等外部消费方继续通过现有 REST/WebSocket 访问，不受影响。

## Decisions

### 决策 1：新增独立的 `apps/collab-server` 服务，用 Rust（Axum + `yrs`/`y-sync`）实现，不并入 `apps/api`
运维隔离的理由跟现有 `worker.ts`（视频转码）一致：WebSocket 长连接与 HTTP 短连接的运维特性（扩容、重启、健康检查）不同，混在一个进程里会互相拖累。

技术栈选 Rust 而不是 Node + Hocuspocus，理由是：
- `yrs`（Yjs 官方维护的 Rust 移植，又称 `y-crdt`）与 JS 版 Yjs **协议二进制兼容**，前端仍可以用标准的 `y-websocket` JS 客户端连接，`packages/tiptap-editor`/`apps/web` 不需要感知服务端语言。
- 团队已经在 `infra-sso` 项目里验证过 Axum + Tokio + SQLx 这套生产部署经验（Docker/K8s、CI、监控接入方式可直接复用），不是引入一门全新的、团队没有运维经验的技术栈。
- 长连接场景下 Rust 的单连接内存开销更低，为未来扩容留出更大空间。

**备选方案 A**：Node + Hocuspocus。放弃：Hocuspocus 虽然开箱即用（自带鉴权/持久化/Redis 扩展 hook），但团队并不缺 Rust 长连接服务的工程能力，且用 Rust 能跟 `infra-sso` 共享部署模式与运维习惯,长期看维护成本更低。
**备选方案 B**：把长连接挂在 `apps/api` 现有 Express 服务上。放弃：理由跟运维隔离一致，不再重复。

### 决策 2：权限判断与内容持久化的业务逻辑，通过 gRPC 调用 `apps/api`，不在 Rust 侧重新实现
`collab-server`（Rust）在两个时机需要用到"业务规则"：① 连接建立时判断用户对该文档所属 Wiki 的角色（Team OWNER 兜底 + `WikiMember` 查询）；② 持久化时把派生出的 ProseMirror JSON 交给业务侧同步 `content`/`searchText`、判断是否需要新建版本快照。这两块逻辑现有实现都在 `apps/api`（TS），且会随 Wiki/Team/版本历史相关功能演进持续变化。

Rust 侧不重新实现这两块逻辑（会造成两份实现互相漂移），而是通过 gRPC 调用 `apps/api` 新增的两个内部服务：`AccessControlService.CheckDocumentRole`、`DocumentSyncService.SyncDocumentContent`（见决策 10、`/protos` 下的契约定义）。`apps/api` 保持这两块规则的唯一实现，`collab-server` 只是调用方。这两个调用都发生在"连接建立"和"周期性持久化"这两个低频时机，不是逐字符的高频路径，一次 gRPC 往返的延迟完全可以接受。

**备选方案**：把角色判断逻辑抽成 TS 共享包，Rust 侧再翻译一份实现。放弃：TS 包没法被 Rust 直接复用，翻译一份等于制造第二份需要手动保持同步的实现，跟"避免 REST 与协同两套权限实现漂移"这条约束（proposal Impact）直接冲突。
**备选方案**：Rust 直连 Postgres 自己查 `WikiMember`/`TeamMember` 表重新实现判断逻辑。放弃：同上，业务规则应该只有一份实现；且未来这条规则如果变化（比如新增角色类型），只改一处（`apps/api`）就行，不需要记得同步改 Rust 侧。

### 决策 3：连接鉴权仍复用现有 access token，token 签名校验在 Rust 侧本地完成，角色判断走决策 2 的 gRPC 调用
客户端用当前内存里的 `accessToken`（`useAuthStore` 已有）作为协同连接的鉴权凭证。`collab-server` 收到连接请求后：① 用 Rust 的 `jsonwebtoken` crate + 与 `apps/api` 共享的同一份 `JWT_SECRET` 环境变量本地校验签名与过期时间（纯密码学校验，标准算法，不涉及可变的业务数据，没有跨语言重复实现的漂移风险，本地校验避免每次连接都多一次 gRPC 往返）；② 签名校验通过后，取出 `sub`（userId），再走决策 2 的 gRPC 调用判断该用户对目标文档的角色。

Access token 到期（15 分钟）时连接会被判定鉴权失败并断开；客户端复用已有的 `scheduleBackgroundRefresh` 定时器，在 access token 即将过期前主动刷新并重新建立协同连接（同一份刷新逻辑，不新增第二套定时器）。

**备选方案**：为协同连接签发一个更长有效期的专用 token。放弃：多一种 token 类型意味着多一套失效/刷新/吊销逻辑，且当前 access token 的短 TTL + rotation 机制已经过验证，复用能少一个攻击面。

### 决策 4：角色 → 连接模式的映射，在连接建立阶段一次性完成
房间标识（Yjs 文档名）直接使用 `Document.id`（UUID）。连接建立时：解析 JWT 拿到 `userId`（决策 3）→ 调用 `AccessControlService.CheckDocumentRole(userId, documentId)`（决策 2）→ `granted = false` 直接拒绝连接（等价于 REST 的 `403`）→ `VIEWER` 建立只读连接（可接收广播，服务端拒绝其写入的更新）→ `EDITOR`/`OWNER` 建立可写连接。

### 决策 5：`Document.content` 继续作为"物化只读视图"保留，新增 `yjsState` 字段存 CRDT 状态
新增 `Document.yjsState`（`Bytes?`，可空）存 `yrs` 编码的 CRDT 二进制状态，这是协同编辑的权威数据，由 `collab-server` 直接读写（这是协议相关的底层存储，不涉及业务规则，Rust 直连 Postgres 没有问题，不需要走 gRPC）。`Document.content`（现有 JSON 字段）不删除：`collab-server` 持久化 `yjsState` 时，通过决策 2 的 `DocumentSyncService.SyncDocumentContent` 交给 `apps/api` 写回 `content`（`searchText` 派生逻辑复用现有实现，不重复）。

**实现阶段的修正（相对本决策立项时的描述）**：最初设想"collab-server 把 CRDT 状态转换成 ProseMirror JSON 再交给 apps/api"，实现阶段发现这个转换本身要求精确匹配 `packages/tiptap-editor` 的具体 Schema（图片/视频/Mermaid/代码块/链接预览等自定义节点），这是一条跟产品 Schema 强绑定的业务逻辑，而 JS 生态里唯一经过验证、且客户端本身也在用的转换实现是 `y-prosemirror`——在 Rust 侧用 `yrs` 重新实现一遍等价的映射，本质是用另一种语言重新发明一次 `y-prosemirror`，工作量和出错风险都远超预期，也违背了"业务规则只保留一份实现"这条贯穿全部决策的原则（跟决策 2 完全同一类问题，只是这次业务规则换成了"CRDT 结构怎么映射到具体 Schema"而不是"权限判断"）。

修正后的边界：`collab-server` 与 `apps/api` 之间只传输**不透明的 Yjs 二进制状态**（`yjs_state: bytes`），ProseMirror JSON ↔ Yjs 的相互转换全部收敛到 `apps/api`（新增 `yjs`/`y-prosemirror` 依赖，复用已有的 `@luhanxin/tiptap-editor` Schema）完成：
- `SyncDocumentContent`：`collab-server` 把当前 `yrs::Doc` 编码成完整状态（`encode_state_as_update`）传给 `apps/api`；`apps/api` 用 `Y.applyUpdate` 还原出一个 JS `Y.Doc`，再用 `y-prosemirror` 转成 ProseMirror JSON，走既有的 `content`/`searchText` 同步与版本快照逻辑。
- `GetDocumentContent`（决策 6 的惰性迁移）：反过来，`apps/api` 用 `y-prosemirror` 把当前 `content`（ProseMirror JSON）转换成一个新建的 `Y.Doc`，编码成初始状态传给 `collab-server`，`collab-server` 反序列化后直接作为该文档的 `yrs::Doc` 使用。

这样 `collab-server` 全程不需要理解 ProseMirror Schema，只做"CRDT 协议中继 + 二进制持久化"，跟决策 5 最初的定位（"协议相关的底层存储，不涉及业务规则"）完全一致，只是把这个边界延伸到了"内容格式转换"这一层。

**为什么不干脆删掉 `content`、全部读 `yjsState`**：`wiki-search`（全文检索）、文档列表预览、非协同场景的只读渲染都是读 `content` 这个 JSON 字段，把这些消费方全部改成"实时反序列化 Yjs 二进制"成本高且没有必要——保留物化视图是标准的 CQRS 思路，读写分离，写路径多一步同步开销，换来读路径完全不用动。

### 决策 6：存量文档惰性迁移，不做批量迁移脚本
文档的 `yjsState` 初始为 `null`。当协同连接第一次请求打开某篇文档时，若 `yjsState` 为空，`collab-server` 从 `apps/api` 读取该文档当前的 `content`（可以通过既有 REST 接口或一个只读的 gRPC 方法，具体接口形态在 tasks 阶段确定），用 `yrs` 转换成初始 CRDT 状态并立即持久化。从未被打开过协同连接的文档，`content`/`yjsState` 都保持原样不受影响。

**备选方案**：上线时跑一次性脚本把所有存量文档转换成 CRDT 状态。放弃：没有必要性——文档数量可能很大，一次性转换是不必要的运维负担和风险窗口；惰性迁移下每篇文档只在真正被使用协同功能时才转换一次，代价分摊到自然使用过程中。

### 决策 7：`document-versioning` 的快照触发判断继续只在 `apps/api` 里做一份，`collab-server` 只负责触发调用
现有 `snapshotVersion()`（判断"距最近版本记录 `updatedAt` 是否超过 30 分钟"）保持不变，`collab-server` 在周期性持久化时调用 `DocumentSyncService.SyncDocumentContent`，由 `apps/api` 在这次 RPC 处理内部依次完成："判断内容是否与上次不同" → "不同则同步 `content`/`searchText` 并调用 `snapshotVersion()`"；"内容是否变化"这一判断也在 `apps/api` 侧完成并通过响应字段（`content_changed`）告知调用方，`collab-server` 不需要自己维护"上一次内容是什么"的状态,避免用完全相同的内容反复触发无意义的持久化判断。

### 决策 8：`packages/tiptap-editor` 的协同能力做成可选注入，不做硬依赖；前端协同客户端用标准 `y-websocket` Provider
`DocumentEditor` 组件新增一个可选的 `collaboration` prop（形如 `{ document: Y.Doc; provider; awareness }`），不传时编辑器行为跟现在完全一样（走 `StarterKit` 自带 history，非协同模式）。传入时才装配 `@tiptap/extension-collaboration`/`@tiptap/extension-collaboration-caret`、关闭默认 history。

由于服务端不是 Hocuspocus（决策 1），前端不使用 `@hocuspocus/provider`（它假设对端是 Hocuspocus 协议），改用更基础的 `y-websocket` Provider——`yrs`/`y-sync`（Rust 侧）与 `y-websocket`（JS 侧）走的是同一套 Yjs 官方同步协议，两者天然兼容。

这跟现有图片/视频上传"消费方注入回调，编辑器本身不感知具体上传接口"的既有约定（`image-uploader-registry.ts` 等）是同一种模式——`packages/tiptap-editor` 保持对具体协同后端零感知，`apps/web` 负责创建 Provider 并注入。

### 决策 9：REST 的文档正文保存路径，在文档已迁移到协同模式后停用
一旦某篇文档的 `yjsState` 不为空（意味着已经有协同连接写过），`PATCH /documents/:id` 的正文 `content` 字段 MUST 被拒绝写入（返回明确的错误码，提示"该文档已启用实时协同，请通过编辑器直接编辑"）；`title` 字段的更新不受影响，继续走 REST。这条判断本身只是读一个已有字段是否为空，`apps/api` 自己就能完成，不需要额外的服务间调用。这是本次唯一保留的 **BREAKING** 行为——正文写入路径从"REST 覆盖写"变为"只能通过协同连接"，避免两条写路径并存导致的数据覆盖/丢失风险。

### 决策 10：服务间通信采用 gRPC，`.proto` 契约集中存放在仓库根目录 `/protos`
`collab-server`（Rust）与 `apps/api`（TS）之间的内部调用（决策 2）采用 gRPC，而不是内部裸 REST（JSON over HTTP）。理由：
- 两边分别用 `tonic`（Rust）/`@grpc/grpc-js` 或 `connectrpc`（TS）从同一份 `.proto` 生成代码，接口契约只有一份来源，不会出现"Rust struct 和 TS interface 手写出来对不上"的漂移。
- 这不是只为这一次改动做的局部选择：随着团队后续可能出现更多 Rust/TS 混合的服务（比如 `infra-sso` 如果未来要跟本项目集成），现在把 gRPC 定为服务间通信的统一约定，能省掉以后每次新增服务间调用都要重新决策协议的成本。
- 调用频率是"每次连接建立一次 + 周期性持久化一次"，不是高频路径，gRPC 相对内部裸 REST 的额外基建成本（多起一个 gRPC 监听端口、引入 Protobuf 工具链）可以接受。

`.proto` 文件放在仓库根目录的 `/protos`（不归属任何单一 `apps/*`/`packages/*`，因为它是多个服务共享的契约），按 `protos/<domain>/v1/*.proto` 分目录，`package` 声明用 `yjsdocs.<domain>.v1`，方便以后有更多服务间契约时按域名延续同样的组织方式。`apps/api` 新增一个 gRPC server（跟现有 HTTP server 监听不同端口），`apps/collab-server` 作为 gRPC 客户端调用它。

**备选方案**：内部裸 REST（JSON over HTTP）。放弃：调用点数量会随协同能力演进增长（未来可能还有"协作者在线状态回传业务侧""内容审核钩子"等场景），现在定 gRPC 作为标准，比每次新增服务间调用都重新讨论协议更省心；且团队已有 Rust 工程经验，引入 Protobuf 工具链的边际成本不高。

## Risks / Trade-offs

- **[风险] `collab-server` 宕机时，已迁移文档的正文编辑整体不可用**（REST 正文写入路径已停用，不能临时切回）→ **缓解**：`collab-server` 独立进程部署，可独立重启/扩容，不与 HTTP API 共进程互相拖累；本次不做"REST 兜底双写"（那会重新引入两套写路径同步的复杂度，风险比可用性收益更大）。
- **[风险] `apps/api` 宕机时，`collab-server` 无法完成新连接的角色判断（决策 2 的 gRPC 调用失败）**→ **缓解**：这跟现状一致——`apps/api` 本身也是现有 REST 编辑流程的唯一权限判断来源，`apps/api` 不可用时本来就无法编辑任何文档，协同连接的新增依赖不改变整体可用性的下限；已建立的连接（角色已判断过）不受后续 `apps/api` 短暂不可用影响,只有*新建*连接会受影响。
- **[风险] gRPC 双语言代码生成的工具链维护成本**（`.proto` 变更后两侧都要重新生成代码，CI 需要保证生成产物与 `.proto` 同步）→ **缓解**：纳入 CI 检查（生成代码后跑 `git diff` 确认无未提交的生成产物漂移），跟现有 Prisma schema 变更后必须重新生成 client 的检查方式类似，不是全新的工程习惯。
- **[风险] 首次为存量文档做惰性迁移时，`content` 与刚生成的 `yjsState` 之间存在极短的转换窗口**，若转换过程中进程崩溃可能导致 `yjsState` 写入不完整 → **缓解**：转换+持久化在同一个幂等操作里完成，重试时若 `yjsState` 仍为空会重新从 `content` 转换，不会产生"部分转换"的中间态被读到。
- **[风险] Access token 到期导致协同连接被动断开，如果客户端刷新时机没卡准，用户会感知到短暂的重连**→ **缓解**：复用现有 `scheduleBackgroundRefresh` 提前量（30 秒），协同连接的重建时机与 access token 刷新绑定在一起，理论上应先于连接被判定鉴权失败发生。
- **[取舍] 放弃离线编辑能力**，只做在线场景下的本地缓存加速——这是刻意的范围收窄（见 Non-Goals），换来的是不需要在本次设计"离线期间权限被收回怎么办"这类新的时序问题。

## Migration Plan

1. `/protos`：新增 `protos/collab/v1/collab.proto`，定义 `AccessControlService`/`DocumentSyncService` 两个 gRPC 服务契约。
2. Prisma：给 `Document` 模型新增 `yjsState Bytes?` 字段（可空，向后兼容，无需回填）。
3. `apps/api`：新增 gRPC server（独立端口，与现有 HTTP server 并存），实现 `AccessControlService.CheckDocumentRole`（复用 `require-wiki-role.ts` 的判断逻辑）与 `DocumentSyncService.SyncDocumentContent`（复用 `content`/`searchText` 同步、`snapshotVersion()` 逻辑）。
4. 搭建 `apps/collab-server`（Rust + Axum + `yrs`/`y-sync` + `tonic`（gRPC 客户端）+ `sqlx`）：实现连接鉴权（决策 3/4）、惰性迁移（决策 6）、持久化与 gRPC 回调（决策 5/7）。
5. `packages/tiptap-editor`：新增可选的 `collaboration` prop（决策 8），引入 `@tiptap/extension-collaboration`/`@tiptap/extension-collaboration-caret`/`yjs`/`y-prosemirror`/`y-websocket` 依赖。
6. `apps/web`：文档编辑页面创建 `y-websocket` Provider（地址指向 `collab-server`），注入编辑器；离线缓存改用 `y-indexeddb`（决策不变更用户可见行为，见 Non-Goals）。
7. `apps/api`：`PATCH /documents/:id` 正文更新路径加一条前置判断——`yjsState` 非空则拒绝正文字段的写入（决策 9），标题字段不受影响。
8. `docker-compose.yml` 新增 `collab-server` 服务定义（Rust 构建产物），复用现有 `postgres`；`apps/api` 的服务定义新增 gRPC 端口的暴露。

**不需要维护窗口**：整个迁移是渐进式的（惰性迁移 + 新字段可空 + 旧 REST 路径仅在文档"已启用协同"后才收紧），可以随正常发布节奏上线，不需要停机批处理。

**回滚**：如果 `collab-server` 上线后发现问题需要整体回滚，`apps/web` 端只需不再创建/注入协同 Provider（决策 8 的可选注入设计使这一步是纯前端配置开关，不需要动 `packages/tiptap-editor`），但**已经迁移过的文档（`yjsState` 非空）的正文编辑会因为决策 9 而不可用**，直到 `collab-server` 恢复或手动跑一次性脚本把 `yjsState` 转回允许 REST 覆盖写的状态——这是本次迁移策略里唯一需要承担的回滚成本，属于已知且可接受的权衡（详见 Risks）。

## Open Questions

- Undo/redo 在多人协同下的粒度：`y-prosemirror` 提供的协同版 undo manager 默认是"只撤销自己的操作"还是"撤销任何人的最后一步"，需要在实现阶段验证官方扩展的默认行为是否符合预期，必要时在 tasks 里单独验证。
- Mermaid/图片/视频这几个自定义 Node 在协同同步下的"中间态"（如图片上传中的占位、视频转码中状态）广播语义——`@tiptap/extension-collaboration` 理论上按事务同步任意 ProseMirror 节点属性变化，但具体到这几个自定义 Node 是否有边界情况，需要在实现阶段针对这三种 Node 各做一次真实多端联调验证。
- 持久化的防抖/flush 阈值（间隔多久、或积累多少次更新触发一次持久化）具体取值——先给一个保守初始值（实现阶段确定，如 2 分钟或达到一定更新次数），后续可按实际写入压力调整，不影响本次的架构决策。
- 存量文档惰性迁移时，`collab-server` 读取 `Document.content` 的具体接口形态（走 `apps/api` 现有的 REST `GET /documents/:id`，还是新增一个只读 gRPC 方法）——两者都可行，倾向新增一个轻量的 gRPC 方法保持"服务间通信统一走 gRPC"这条约定的一致性，具体在 tasks 阶段确定并补充到 `.proto` 契约里。
