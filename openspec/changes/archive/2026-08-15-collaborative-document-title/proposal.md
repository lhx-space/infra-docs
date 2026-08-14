## Why

`yjs-realtime-collaboration`（已归档）当时把"文档标题实时协同"划为 Non-Goal，理由是"标题编辑冲突概率低，不值得为此扩大改动范围"。实际使用中发现这个概率判断偏乐观：标题走独立的 `PATCH /documents/:id`、Last-Write-Wins、无冲突提示、也不会实时推给同一文档的其他在线协作者——多人同时编辑同一篇文档时，标题是唯一一个"看起来在协同，实际各自为战"的字段，体验上跟正文的实时合并明显割裂，且后写覆盖先写的行为对用户完全不可见（没有任何提示）。现在决定把这个 Non-Goal 收回，让标题也走 CRDT 实时同步，跟正文享有同一套多人编辑保障。

## What Changes

- 文档标题从"数据库独立字段 + REST 覆盖写"迁移为"Yjs `Y.Doc` 里另一个共享 `XmlFragment`（绑定一份限定为单段落纯文本的极简 Schema） + CRDT 自动合并"，跟正文的 `XmlFragment` 字段并存于同一个 `Y.Doc`。
- `packages/tiptap-editor` 的 `DocumentEditor` 新增协同标题编辑能力：协同模式下标题输入框换成一个极简 Tiptap 编辑器实例绑定到这个 `XmlFragment`，多人同时编辑标题会实时合并，不再互相覆盖。
- 存量文档首次被协同打开时的惰性迁移（`getDocumentContentForCollab`/`GetDocumentContent` gRPC）同步初始化标题的 Yjs 状态，跟正文用同一个初始化时机，不新增第二个迁移触发点。
- `collab-server` 周期性持久化（`SyncDocumentContent`）时把标题的 Yjs 状态一并同步给 `apps/api`，`apps/api` 用它物化更新 `Document.title`（跟 `content` 是同一条持久化管线，且复用同一份已经在传输的 `yjs_state` 二进制，见 design.md 决策 1，不新增 gRPC 字段）。
- **BREAKING**：一旦文档 `yjsState` 非空（已启用协同），`PATCH /documents/:id` 的 `title` 字段更新 MUST 被拒绝，跟现有 `content` 字段的限制规则完全对齐（此前 `title` 不受协同状态影响，本次收回这个例外）。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `realtime-collaboration`：标题字段纳入协同范围——多人编辑标题不再互相覆盖丢失；"已启用协同的文档拒绝旧的整篇覆盖写入"这条要求收回此前对标题的例外，标题更新同样被拒绝走旧的 REST 覆盖写路径。

## Impact

- `apps/api`：`services/yjs-content.ts` 新增标题对应的 `XmlFragment` 编解码（用 `y-prosemirror` 的 `prosemirrorJSONToYXmlFragment`/`yXmlFragmentToProsemirrorJSON`，跟正文的 `XmlFragment` 编解码共享同一个 `Y.Doc` 实例、同一份 `yjs_state` 二进制，不需要新增 gRPC 字段——`Y.encodeStateAsUpdate` 本身就是对整个 `Y.Doc` 编码，正文和标题两个共享类型天然都在同一份二进制里）；新增 `utils/title-schema.ts`（标题专用的极简 ProseMirror Schema）；`syncContentFromCollab`、`getDocumentContentForCollab`、`updateDocument`（收紧 `title` 写入限制）需要相应调整。
- `apps/collab-server`（Rust）：**不需要改动**——它只搬运不透明的 `yjs_state` 二进制，不理解里面有哪些共享类型，新增的标题 `XmlFragment` 字段对它完全透明。
- `protos/collab/v1/collab.proto`：**不需要改动**（原因同上）。
- `packages/tiptap-editor`：`DocumentEditor` 标题输入的渲染与事件绑定方式改变（协同模式下不再是纯受控 `<input>`），`collaboration-types.ts` 新增标题相关的类型/常量。
- `apps/web`：`DocumentEditorPage.tsx` 不再对标题变更做防抖 REST 保存，标题的当前文本改为从协同层回读用于页面标题/面包屑展示。
- 数据库：不需要新增字段（复用已有的 `Document.yjsState`，标题状态编码进同一份 Yjs 二进制里）。
