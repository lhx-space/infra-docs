## Context

`yjs-realtime-collaboration`（已归档）落地了正文的实时协同：`Document.content`（ProseMirror JSON）是"物化只读视图"，权威数据是 `Document.yjsState`（`yrs`/Yjs 编码的二进制，存的是一个 `Y.Doc` 的完整状态），正文对应这个 `Y.Doc` 里名为 `default` 的 `XmlFragment`（前端 `Y_XML_FRAGMENT_FIELD`/后端 `yjs-content.ts` 各自硬编码同一个值）。`collab-server`（Rust）全程只搬运不透明的 `yjs_state: bytes`，不理解里面有什么共享类型，ProseMirror JSON ↔ Yjs 的相互转换全部收敛在 `apps/api`（`services/yjs-content.ts`，用 `y-prosemirror`）。

标题当时被划为 Non-Goal，继续走独立的 `Document.title` 字段 + `PATCH /documents/:id` 覆盖写，Last-Write-Wins，无冲突提示，也不会实时推给其他在线协作者。现在要把这个 Non-Goal 收回。

关键的既有约束（沿用上一轮的决策，不重新讨论）：
- 业务规则只保留一份实现，`collab-server` 不重新实现任何 Schema/业务相关的转换逻辑。
- `packages/tiptap-editor` 的协同能力是可选注入（`collaboration` prop），不做硬依赖。
- 一旦 `yjsState` 非空，REST 覆盖写路径必须被拒绝（当时只对 `content` 生效，本次把 `title` 也收进这条规则）。

## Goals / Non-Goals

**Goals:**
- 标题多人同时编辑时 CRDT 自动合并，跟正文享有同一套"不产生互相覆盖或丢失"的保障。
- 不新增第二套持久化管线/迁移触发点——标题的初始化、同步、版本快照全部复用正文已有的时机与接口。
- `apps/collab-server`（Rust）与 `/protos` 契约保持不变，这次改动完全收敛在 `apps/api`（TS）与 `packages/tiptap-editor`/`apps/web`（前端）。

**Non-Goals:**
- **不做标题的协作者光标/选区展示**：正文的 `CollaborationCaret` 依赖一整套 DOM 覆盖层方案（见 `caret-render.ts`/`use-collaboration-caret-labels.ts`），标题输入框是单行小组件，重新适配这套方案的收益（能看到别人光标停在标题的哪个字符）跟复杂度不成比例。协同合并（Goal）跟光标展示（这里排除）是两件独立的事，本次只做前者。
- **不做标题的富文本格式**：标题保持纯文本语义，不支持加粗/链接等 mark，跟现状（`<input>`）行为一致，只是底层存储换成 CRDT。
- **不重新讨论版本历史的展示粒度**：标题变化本身是否单独在版本历史 UI 里高亮，不在本次范围。

## Decisions

### 决策 1：标题存成同一个 `Y.Doc` 里另一个共享 `XmlFragment`，不新增 gRPC 字段、不改 `collab-server`/`/protos`

`Y.encodeStateAsUpdate(ydoc)` 编码的是**整个** `Y.Doc`（该文档下所有共享类型的状态），不是只编码某一个字段。现有的 `yjs_state: bytes` 在 `SyncDocumentContentRequest`/`GetDocumentContentResponse` 里传输的已经是这个整份状态——只要 `apps/api` 侧在同一个 `Y.Doc` 实例上，除了已有的 `XmlFragment('default')` 之外再声明一个 `Text('title')`，两者的状态天然都会被编码进同一份二进制里，`collab-server` 不需要知道这件事，`/protos` 契约不需要新增任何字段。

这跟决策"业务规则只保留一份实现"是同一个精神的延续：`collab-server` 的职责边界本来就是"CRDT 协议中继 + 二进制持久化"，标题只是 `apps/api` 这一侧多理解一种共享类型，不下沉到 Rust。

**备选方案**：给 `SyncDocumentContentRequest`/`GetDocumentContentResponse` 各加一个独立的 `title_yjs_state: bytes` 字段，标题用单独的 `Y.Doc`。放弃：一篇文档如果对应两个独立的 `Y.Doc`，意味着两条独立的 CRDT 状态生命周期、两次编码/解码、`collab-server` 侧要么继续对此无感（那就没必要拆两个 `Y.Doc`），要么需要感知"这篇文档有两个协同状态需要一起管理"——不管选哪一个，都比"同一个 `Y.Doc` 装两个共享类型"更复杂，且没有换来任何好处（标题跟正文的生命周期、权限、持久化时机完全一致，没有理由拆开）。

### 决策 2：标题输入框在协同模式下用一个独立的、极简的 Tiptap 编辑器实例绑定到这个 `title` XmlFragment，不用手写字符级 diff 同步

`@tiptap/extension-collaboration` 内部固定用 `document.getXmlFragment(field)` 绑定共享状态（不支持直接绑定原始的 `Y.Text`，见 `@tiptap/extension-collaboration` 源码），所以前端复用这套现成机制的前提是标题也得是一个 `XmlFragment`，不是更直观的 `Y.Text`。做法：新建一个只包含 `Document`/`Paragraph`/`Text` 三个节点的极简 Tiptap 编辑器实例（`@tiptap/starter-kit` 配置成只保留这三者），`Collaboration` 扩展的 `field` 配成 `'title'`（跟正文的 `'default'` 区分），绑定同一个 `Y.Doc`/`provider`（不建立第二个 WebSocket 连接）；用 `keydown` 拦截 `Enter`（`preventDefault`），保证标题永远是单段落纯文本，语义跟原来的 `<input>` 一致。产品语义上标题仍然是"纯文本"，只是底层复用了跟正文相同的 ProseMirror↔Yjs 绑定机制（一个内容被约束成"只有一个段落、不含任何 mark"的 `XmlFragment`）。

**备选方案**：手写一个"输入框文本 diff 成 Yjs `Text` 的插入/删除操作"的绑定函数（社区里 `y-textarea`/类似库的思路）。放弃：这类实现需要正确处理"光标位置在多次输入间的偏移换算""IME 输入法组合输入期间不能过早提交每个中间态"等一堆已知的坑，而 `@tiptap/extension-collaboration` + ProseMirror 的输入事件处理已经把这些坑踩平了（正文用的就是这条路径），重新实现一遍只是把这些坑在标题这个更小的场景里重新踩一次，没有必要。且 `@tiptap/extension-collaboration` 本身就不支持绑定 `Y.Text`（见上），手写方案还得绕开这套现成基建单独接一次 `y-websocket` 的更新广播，复杂度更高。

### 决策 3：标题的初始化时机、序列化格式与正文完全对齐，复用 `getDocumentContentForCollab`/`GetDocumentContent`，不新增独立的迁移触发点

存量文档首次被协同打开时（`yjsState` 仍为空），`getDocumentContentForCollab` 现在只用 `content` 构造 `Y.Doc`；本次改动让它在同一个 `Y.Doc` 实例上再额外插入一步：把当前 `Document.title`（数据库里的字符串）包成"单段落纯文本"的 ProseMirror JSON，用 `y-prosemirror` 的 `prosemirrorJSONToYXmlFragment` 写进同一个 `Y.Doc` 的 `title` 这个 `XmlFragment`（对应一份独立的极简 Schema，只有 `doc`/`paragraph`/`text` 三种节点、不含任何 mark，见 `utils/title-schema.ts`）。两者用同一次 `Y.encodeStateAsUpdate` 编码，通过同一个已有的 `GetDocumentContent` gRPC 调用返回，不新增第二个"标题专属"的迁移接口或触发时机——文档要么完全没协同初始化过（`yjsState` 为空，标题继续走 REST），要么完全初始化过（标题和正文都已经在 `Y.Doc` 里），不存在"正文已协同、标题还没"的中间态。

### 决策 4：周期性持久化时，标题与正文的"是否变化"分别判断，但共用同一次快照触发窗口

`syncContentFromCollab` 现在只比较 `content`（JSON 序列化字符串）判断 `contentChanged`。本次改动新增标题的解码与比较：用 `y-prosemirror` 的 `yXmlFragmentToProsemirrorJSON` 从同一份 `yjs_state` 里解码出 `title` 这个 `XmlFragment` 对应的 JSON，拼接出纯文本字符串，跟 `Document.title` 做字符串比较得到 `titleChanged`。触发 `snapshotVersion`（追加/更新版本记录）与 `DocumentContributor` 归因（见上一轮"历史编辑人"修复）的条件从"仅 `contentChanged`"放宽为"`contentChanged || titleChanged`"——单独改标题（内容没变）也应该被认为是一次真实编辑，值得被记入版本历史与历史编辑人列表，跟现在"改标题不算编辑历史"的行为（旧 REST 路径下 `updateDocument` 只在 `content` 变化时才调用 `snapshotVersion`）保持一致的产品语义，不因为存储位置换了就降低标题变化的重要性。

`Document.title`/`Document.content`/`searchText` 三者各自独立判断是否需要写库（避免"标题没变也无意义地更新一次 `title` 列"），但只要 `contentChanged || titleChanged` 任一为真，就是一次完整的持久化+版本快照动作，不拆成两次数据库事务。

### 决策 5：`updateDocument` 收紧 `title` 写入限制，跟 `content` 用完全相同的判断（`yjsState !== null` 则拒绝）

现有代码里 `content` 字段已经有这条判断（`services/document.ts` 第 151-153 行）；本次给 `title` 加上同样的前置检查，复用同一个错误码 `collaboration_enabled`（`409`），不新增新的错误类型——对调用方（前端）而言，"标题被拒绝"和"正文被拒绝"是同一种错误语义（"这篇文档已启用协同，请通过编辑器直接编辑"），没有必要区分。

### 决策 6：前端不再对标题做防抖 REST 保存，`onTitleChange` 回调改为"标题当前文本变化时的只读通知"

`DocumentEditorPage.tsx` 现有的 `handleTitleChange` 会 `setTimeout` 500ms 后发 `PATCH`——协同模式下这条路径整体删除。`DocumentEditor` 组件的 `onTitleChange` prop 语义变化：协同模式下，这个回调仍然会在标题文本变化时被调用（本地输入或远程合并都会触发），但只是"告诉外部现在的标题是什么"（页面 `<title>`/面包屑展示用），不再意味着"该由调用方负责持久化"——持久化已经完全交给协同层（本地编辑通过 Yjs 广播 + `collab-server` 周期性落库）。非协同模式下（`packages/tiptap-editor` 作为通用包，理论上仍可能有不传 `collaboration` 的消费方）`onTitleChange` 语义不变，保持向后兼容。

## Risks / Trade-offs

- [Risk] 现在 `Document.title` 有一个数据库层面的非空约束/默认值兜底（`@default("未命名文档")`），但标题对应的 `XmlFragment` 内容为空（段落里没有文本节点）是完全合法的 CRDT 状态，用户可能把标题清空却不触发数据库默认值 → [Mitigation] 沿用现有 UI 层的兜底逻辑（`handleTitleChange` 里 `next.trim() || '未命名文档'` 的思路），改为在"标题为空"时前端展示 placeholder（跟输入框原生 `placeholder` 属性一致），不强制往 CRDT 状态里写入默认文案——允许"标题当前是空的"这个状态短暂存在（跟正文允许空文档是同一个道理），只在物化到 `Document.title` 时如果解出来的字符串为空才落回默认值，避免污染 CRDT 状态本身。
- [Risk] 标题的极简 Tiptap 实例是新增的一个 Editor 生命周期，多一份 `useEditor` 的创建/销毁开销 → [Mitigation] 这个编辑器实例极小（3 个节点类型，没有工具栏/BubbleMenu/图片视频等重量级扩展），创建成本跟正文编辑器不是同一个量级，且只在协同模式下才创建（非协同消费方不受影响）。
- [Risk] 决策 4 放宽了版本快照的触发条件（标题变化也算），如果用户高频修改标题（比如反复调整措辞），会比现在更频繁地推进 `DocumentVersion`/`DocumentContributor` 的 `updatedAt` → [Mitigation] 版本快照本身已经有"编辑会话聚合"（30 分钟内只更新同一条记录，不新建），标题的高频修改跟正文的高频修改在这条规则下是同等对待，不会额外产生大量版本记录。
- [Trade-off] 放弃标题的协作者光标展示（见 Non-Goals），如果后续发现用户确实需要看到"谁正在改标题"，需要单独一次改动扩展 `useCollaborationCaretLabels`/覆盖层方案以支持多个绑定目标（不是本次范围）。
- [Risk] **实现阶段发现并修复**：标题的持久化真源换成 Y.Doc 后，`apps/web` 的 Sidebar 文档树（`SidebarWikiEntry.tsx`/`store/document.ts` 的 `documentsByWiki`）不再被自动同步——旧版本靠 `updateDocument` 在 REST 成功后手动 `.map()` 替换 store 里对应项来触发 Sidebar 重渲染（`store/document.ts:93-105`），这条链路在标题改走协同后被完全绕开，`handleTitleChange` 原本只 `setTitle`（页面本地 state），Sidebar 因此停留在打开文档那一刻的旧标题上，无论是编辑者自己还是同时打开着该文档的协作者都看不到更新 → [Mitigation] 新增 `patchDocumentTitleLocal`（`store/document.ts`）：不发请求，纯本地把 `documentsByWiki` 里对应文档节点的 `title` 就地替换（复用 `updateDocument`/`restoreVersion` 已有的 `.map()` 模式），`DocumentEditorPage.handleTitleChange` 在 `setTitle` 之外顺手调用它。这个回调对本地输入和远程 CRDT 合并都会触发（决策 6），所以覆盖了"自己编辑"和"协作者同时打开着这篇文档"两种情形。**未覆盖**：只停留在 Sidebar、没打开这篇文档的协作者——他们的客户端上不存在任何跟这篇文档相关的连接（Y.Doc/WebSocket 都不存在），要覆盖这种情形需要额外的轮询或后端广播机制，不在本次范围，留作后续单独的改动（如果产品需要）。

## Migration Plan

1. `apps/api/src/utils/title-schema.ts`：新增标题专用的极简 ProseMirror `Schema`（`doc`/`paragraph`/`text` 三种节点，不含任何 mark）。
2. `apps/api/src/services/yjs-content.ts`：新增 `Y_TITLE_FRAGMENT_FIELD` 常量（`'title'`），`contentJsonToYjsState`/`yjsStateToContentJson` 分别扩展为同时处理标题的编码/解码（函数签名增加 `title` 参数/新增 `yjsStateToTitle`，用 `y-prosemirror` 的 `prosemirrorJSONToYXmlFragment`/`yXmlFragmentToProsemirrorJSON` 操作同一个 `Y.Doc` 上的 `title` `XmlFragment`）。
3. `apps/api/src/services/document.ts`：`getDocumentContentForCollab`、`syncContentFromCollab`、`updateDocument` 按决策 3/4/5 调整。
4. `packages/tiptap-editor`：`collaboration-types.ts` 新增 `Y_TITLE_FRAGMENT_FIELD` 常量与相关类型；`DocumentEditor.tsx` 新增协同模式下的标题极简编辑器实例（`@tiptap/starter-kit` 精简到只保留 `document`/`paragraph`/`text`），替换原有纯受控 `<input>` 的渲染分支（非协同模式保留原有 `<input>` 分支）。
5. `apps/web/src/pages/wiki/DocumentEditorPage.tsx`：移除标题防抖 REST 保存逻辑，`title` 本地 state 改为只接收 `onTitleChange` 的展示型通知。
6. 本地/预发验证：对一篇已启用协同（`yjsState` 非空）的文档，两个浏览器标签页同时打开并交替编辑标题，确认实时合并、无覆盖丢失；对一篇从未协同打开过的存量文档，首次打开后确认标题正确迁移进 `Y.Doc`（走 `GetDocumentContent`）；确认协同状态下 `PATCH .../title` 返回 `409 collaboration_enabled`。

不涉及数据库 schema 变更，不需要迁移脚本；`collab-server`/`/protos` 不变，不需要重新生成任何跨语言代码，也不需要重新部署 `collab-server`。

**回滚**：纯前端 + `apps/api` 应用层改动，回滚即恢复原有的"标题走 REST 覆盖写"路径与 `<input>` 渲染分支；已经通过协同编辑产生的标题状态（存在 `yjsState` 里）在回滚后不会丢失（`Document.title` 物化列在回滚前的最后一次持久化时已经写入），只是回滚后不再继续实时同步。

## Open Questions

- 标题的 placeholder/空标题兜底文案（"未命名文档"）具体在哪一层实现最合适——前端展示层（Tiptap `placeholder` 扩展）还是物化到 `Document.title` 时才兜底——倾向两者都做（见 Risks），具体实现在 tasks 阶段确定。
