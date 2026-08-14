## 1. `apps/api` 后端：标题的 Yjs 编解码

- [x] 1.1 新增 `utils/title-schema.ts`：标题专用的极简 ProseMirror `Schema`（`doc`/`paragraph`/`text` 三种节点，不含任何 mark）
- [x] 1.2 `services/yjs-content.ts` 新增 `Y_TITLE_FRAGMENT_FIELD = 'title'` 常量，`contentJsonToYjsState` 增加 `title: string` 参数，用 `y-prosemirror` 的 `prosemirrorJSONToYXmlFragment` 在同一个 `Y.Doc` 上写入标题对应的 `XmlFragment`
- [x] 1.3 新增 `yjsStateToTitle`，用 `yXmlFragmentToProsemirrorJSON` 从同一份 `yjs_state` 里解码出标题纯文本

## 2. `apps/api` 后端：初始化、周期性持久化、REST 写入限制

- [x] 2.1 `services/document.ts` 的 `getDocumentContentForCollab` 改为同时传入当前 `title`，调用 1.2 的新签名
- [x] 2.2 `syncContentFromCollab` 新增标题解码与 `titleChanged` 判断（跟现有 `contentChanged` 并列），触发条件改为 `contentChanged || titleChanged`；`title`/`content`/`searchText` 各自按是否变化分别决定要不要写入 `updateDocumentModel`
- [x] 2.3 `snapshotVersion`/`upsertDocumentContributor` 的调用条件从「`lastEditorId` 非空且 `contentChanged`」放宽为「`lastEditorId` 非空且 (`contentChanged || titleChanged`)」
- [x] 2.4 `updateDocument` 新增标题的协同状态前置检查：`input.title !== undefined && existing.yjsState !== null` 时抛出 `DocumentError(409, 'collaboration_enabled')`，跟现有 `content` 检查合并成同一条判断
- [x] 2.5 标题为空字符串时的兜底：物化到 `Document.title` 前，若从 Yjs 解码出的标题去除首尾空格后为空，回退到默认占位文案，不把空字符串落库

## 3. `packages/tiptap-editor`：标题的协同绑定

- [x] 3.1 `utils/collaboration/collaboration-types.ts` 新增 `Y_TITLE_FRAGMENT_FIELD = 'title'` 常量（跟 `apps/api` 的 1.2 保持字符串完全一致）
- [x] 3.2 `DocumentEditor.tsx` 协同模式下新增一个极简 Tiptap 编辑器实例（`@tiptap/starter-kit` 配置成只保留 `document`/`paragraph`/`text`，关闭其余全部子扩展与 `undoRedo` + `Collaboration.configure({document, field: Y_TITLE_FRAGMENT_FIELD})`），`keydown` 拦截 `Enter`/`Shift+Enter` 防止多段落，Enter 时把焦点切到正文编辑器开头；非协同模式保留原有纯受控 `<input>` 渲染分支
- [x] 3.3 协同模式下标题为空时展示 placeholder（复用 `titlePlaceholder` prop，用 `@tiptap/extension-placeholder`），不强制往 Yjs 状态里写入默认文案
- [x] 3.4 `onTitleChange` 回调改为在标题 `XmlFragment` 变化时触发（本地输入与远程合并都要覆盖，监听标题编辑器的 `update` 事件），继续把当前纯文本值传给调用方，用于外部展示（不再暗示"调用方需要负责持久化"，更新组件顶部注释说明这层语义变化）
- [x] 3.5 补充/更新组件文档注释，说明标题协同绑定与正文绑定共享同一个 `Y.Doc`/`provider`，不建立新连接；说明标题不支持富文本 mark，`@tiptap/extension-collaboration` 决定了这里必须是 `XmlFragment` 而非 `Y.Text`

## 4. `apps/web`：接入与清理旧的防抖保存路径

- [x] 4.1 `DocumentEditorPage.tsx` 移除 `handleTitleChange` 里的 `setTimeout` 防抖 `PATCH` 调用，`onTitleChange` 只用于同步本地 `title` state（供 `PageHeader`/`<title>` 展示）
- [x] 4.2 确认 `title` 初始值仍来自首次 `GET /documents/:id`（未开启协同前的展示兜底/页面标题在协同连接建立完成前的占位），协同连接建立后由 3.4 的回调接管
- [x] 4.3 修复实现阶段发现的 Sidebar 文档树不同步问题（见 design.md Risks）：`store/document.ts` 新增 `patchDocumentTitleLocal`（纯本地替换 `documentsByWiki` 对应项的 `title`，不发请求），`DocumentEditorPage.handleTitleChange` 在 `setTitle` 之外调用它

## 5. 验证

- [x] 5.1 `apps/api`：`tsc --noEmit` + `biome check`
- [x] 5.2 `packages/tiptap-editor`：`tsc --noEmit` + `biome check`，`npx tsup` 重新构建 dist
- [x] 5.3 `apps/web`：`tsc --noEmit` + `biome check`
- [ ] 5.4 手动验证：对一篇已启用协同的文档，两个浏览器标签页同时编辑标题，确认实时合并、无覆盖丢失；对一篇从未协同打开过的存量文档首次打开后确认标题正确迁移进 `Y.Doc`；确认协同状态下 `PATCH .../title` 返回 `409 collaboration_enabled`；确认标题清空后展示 placeholder 且不落库为空字符串
- [x] 5.5 `openspec validate --changes "collaborative-document-title" --strict` 通过
