## 1. gRPC 契约与数据模型

- [x] 1.1 完善 `/protos/collab/v1/collab.proto`（已创建初版，覆盖 `AccessControlService`/`DocumentSyncService`），确认字段/服务定义在实现阶段无需调整
- [x] 1.2 引入 Protobuf 代码生成工具链：TS 侧（`ts-proto` 或 `@grpc/proto-loader`）、Rust 侧（`tonic-build`/`prost-build`），在 `apps/api`、`apps/collab-server` 各自的构建脚本里接入
- [x] 1.3 Prisma：给 `Document` 模型新增 `yjsState Bytes?` 字段，生成并应用迁移

## 2. `apps/api`：新增 gRPC server

- [x] 2.1 新增 gRPC server 骨架（独立端口，与现有 HTTP server 并存），接入生成的 `AccessControlService`/`DocumentSyncService` 服务定义
- [x] 2.2 实现 `CheckDocumentRole`：复用 `require-wiki-role.ts` 里"Team OWNER 兜底 + `WikiMember` 查询"的判断逻辑（提取成可在 gRPC handler 与现有 Express 中间件间共用的纯函数，仍是同一份 TS 实现，不是新写一份）
- [x] 2.3 实现 `GetDocumentContent`：只读返回指定文档当前的 `content`（ProseMirror JSON 字符串化）
- [x] 2.4 实现 `SyncDocumentContent`：判断传入内容与上次已存储内容是否不同 → 不同则同步写回 `Document.content`/`searchText`（复用现有派生逻辑）并调用 `snapshotVersion()`；相同则跳过，仅返回 `content_changed: false`
- [x] 2.5 `PATCH /documents/:id`：正文 `content` 字段更新前置校验该文档 `yjsState` 是否已非空，非空则拒绝并返回明确错误码；`title` 字段更新不受影响
- [x] 2.6 跑一次现有权限/版本相关的测试或手动验证，确认 2.2/2.4 提取公共逻辑后 REST 路径行为不变

## 3. 搭建 `apps/collab-server`（Rust）

- [x] 3.1 初始化 `apps/collab-server` 骨架：Rust + Axum（WebSocket）+ Tokio，复用 `infra-sso` 已验证过的项目结构约定（handler/service/repository 分层）
- [x] 3.2 引入 `yrs`/`y-sync`：实现 Yjs 同步协议的 WebSocket 消息处理（sync + awareness）
- [x] 3.3 引入 `sqlx` 连接 Postgres：直接读写 `Document.yjsState` 字段（协议相关的底层存储，不经过 gRPC）
- [x] 3.4 引入 `tonic` 作为 gRPC 客户端，调用 `apps/api` 的 `AccessControlService`/`DocumentSyncService`
- [x] 3.5 连接鉴权：用 `jsonwebtoken` crate + 共享的 `JWT_SECRET` 环境变量本地校验 access token 签名与过期时间，取出 `userId`
- [x] 3.6 连接建立流程：JWT 校验（3.5）→ 调用 `CheckDocumentRole`（3.4）→ `granted=false` 拒绝连接 → `VIEWER` 建立只读连接 → `EDITOR`/`OWNER` 建立可写连接
- [x] 3.7 惰性迁移：`yjsState` 为空时调用 `GetDocumentContent`（3.4）取回现有内容，转换成初始 CRDT 状态并持久化
- [x] 3.8 周期性持久化：按防抖阈值（初始值待定，见 design.md Open Questions）触发，持久化 `yjsState` 并调用 `SyncDocumentContent`（3.4）
- [x] 3.9 Presence/awareness：在线用户列表、光标/选区广播

## 4. `packages/tiptap-editor` 协同接入

- [x] 4.1 新增依赖：`yjs`、`y-prosemirror`、`@tiptap/extension-collaboration`、`@tiptap/extension-collaboration-caret`
- [x] 4.2 `DocumentEditor` 组件新增可选 `collaboration` prop（`{ document, provider, awareness }` 一类的形状），未传入时保持现有行为（含 `StarterKit` 自带 history）
- [x] 4.3 传入 `collaboration` 时装配 `Collaboration`/`CollaborationCaret` 扩展，关闭默认 history，改用协同版 undo manager；按 `utils/` 现有的领域分层惯例，新增文件归入合适的子目录（如新建 `utils/collaboration/`）
- [x] 4.4 保存状态展示适配协同模式：区分"同步中/已同步/连接异常+重连入口"三种状态展示（对齐 `document-editor` spec 修改后的「自动保存与状态反馈」需求）
- [x] 4.5 协作者 presence UI：在线用户列表 + 编辑区域内的光标/选区标记（用户名 + 区分色，颜色可按 userId 做确定性映射）

## 5. `apps/web` 前端集成

- [x] 5.1 文档编辑页面：创建标准的 `y-websocket` Provider（地址指向 `collab-server`），连接参数携带 `useAuthStore` 当前的 `accessToken`；组件卸载时正确销毁 Provider，避免连接泄漏
- [x] 5.2 复用 `store/auth.ts` 现有的 `scheduleBackgroundRefresh` 时机，在 access token 刷新后同步更新协同连接使用的 token 并重连（不新增第二套定时器）
- [x] 5.3 离线缓存：文档内容部分从 `offline-cache.ts` 切换为 `y-indexeddb`（仅替换实现，保持"离线只读"这一既有用户可见行为不变，见 design.md Non-Goals）
- [x] 5.4 连接异常/重连的 UI 交互（对齐 4.4 的状态展示）

## 6. 部署配置

- [x] 6.1 `docker-compose.yml` 新增 `collab-server` 服务定义（Rust 构建产物/独立 Dockerfile，复用现有 `postgres`，暴露 WebSocket 端口）
- [x] 6.2 `apps/api` 的服务定义新增 gRPC 端口暴露
- [x] 6.3 补充 `apps/collab-server` 的环境变量文档（`JWT_SECRET`、数据库连接、监听端口、`apps/api` 的 gRPC 地址），与现有 `apps/api` 的 `.env.example` 风格保持一致
- [x] 6.4 CI 新增校验（实现阶段修正，见 apps/api/scripts/verify-grpc-proto.ts 顶部注释：`apps/api` 侧用 `@grpc/proto-loader` 动态加载 `.proto`，没有引入静态代码生成，天然不存在"生成产物漂移"这个问题；改为直接加载 `.proto` 断言服务/方法定义齐全，CI 里接入 `pnpm --filter=@app/api verify:grpc-proto`）

## 7. 验证

- [x] 7.1 单进程内验证：两个不同角色（`EDITOR`/`VIEWER`）的测试账号同时打开同一篇文档，确认多人实时同步、presence、只读连接限制均符合 spec 场景（用户用两个真实浏览器客户端手工验证过，同步正常）
- [ ] 7.2 验证存量文档惰性迁移：对一篇本次改动前就存在的文档发起首次协同连接，确认 `yjsState` 被正确初始化，且 `content`/`searchText` 后续保持同步
- [ ] 7.3 验证 REST 写入路径收紧：对已完成协同初始化的文档尝试走旧的 `PATCH` 正文更新，确认被拒绝；标题更新确认不受影响
- [ ] 7.4 验证版本历史：确认协同编辑触发的版本快照遵循既有的"编辑会话聚合"规则，且内容未变化时不产生冗余记录
- [ ] 7.5 验证离线场景：断网后文档保持只读展示本地缓存内容，网络恢复后自动拉取最新内容，不引入离线编辑入口
- [ ] 7.6 验证 access token 到期时协同连接的自动续期与重连体验
- [ ] 7.7 验证 gRPC 调用链路的故障场景：`apps/api` 短暂不可用时，`collab-server` 拒绝新连接但不影响已建立的连接
- [x] 7.8 `apps/web`、`apps/api`、`apps/collab-server`（Rust `cargo check`/`cargo build`）、`packages/tiptap-editor` 分别构建/typecheck，确认整体无回归

## 8. 体验优化（协同能力上线后的细节打磨，非架构变更）

- [x] 8.1 在线协作者头像改用真实 `avatarUrl`（`User.profile.avatarUrl`），不再只用用户名首字母的纯色圆圈；加载失败/没有头像时仍退回字母兜底
- [x] 8.2 标题旁展示"历史编辑人"（曾经编辑过这篇文档、不要求当前在线）：新增 `GET /wikis/:wikiId/documents/:documentId/editors`（`VIEWER` 可读，从 `DocumentVersion.createdBy` 去重 + 关联 `User`/`UserProfile`），`DocumentEditor` 新增 `historicalEditors` prop，视觉上跟当前在线协作者头像区分（灰度/透明度降低）
- [ ] 8.3 待确认剩余体感问题："已同步"状态展示——用户反馈的实际现象最终定位为 8.1 的头像问题（不是状态文案本身错），暂无更多未解决的状态显示问题；如后续再复现，需要补充具体复现步骤
