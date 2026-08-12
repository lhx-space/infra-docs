## 1. 数据模型与迁移

- [x] 1.1 新建 `prisma/models/document.prisma`，新增 `Document` model（`id`/`wikiId`/`parentId` 自引用/`title`/`content: Json`/`searchText`/`coverImage`/`order`/时间戳），`onDelete: Cascade` 挂在 `wiki` 与 `parent` 两个关系上（`schema.prisma` 现在只保留 `generator`/`datasource`，各领域 model 已拆到 `prisma/models/*.prisma`，新增领域直接加新文件，不改 `schema.prisma`）
- [x] 1.2 同一个 `prisma/models/document.prisma` 里新增 `DocumentVersion` model（`id`/`documentId`/`title`/`content: Json`/`createdBy`/`createdAt`/`updatedAt`），`onDelete: Cascade` 挂在 `document` 关系上（补充了 `updatedAt`，理由见该文件注释：会话阈值判断必须比较"最后一次被追加编辑的时间"，不能用固定不变的 `createdAt`）
- [x] 1.3 `prisma/models/wiki.prisma` 里的 `Wiki` model 补充反向关系字段 `documents Document[]`
- [x] 1.4 跑 `prisma migrate dev` 生成迁移，确认迁移脚本级联删除规则符合预期（`documents_wikiId_fkey`/`documents_parentId_fkey`/`document_versions_documentId_fkey` 均为 `ON DELETE CASCADE`）
- [x] 1.5 `apps/api/src/models/document.ts`：`createDocument`/`findDocumentById`/`listDocumentsByWikiId`/`updateDocument`（同时更新 `content`/`title`/`searchText`）/`deleteDocument`（另加 `listSiblingDocuments`/`reorderDocuments`/`searchDocuments` 供 2/6 组使用）
- [x] 1.6 `apps/api/src/models/document-version.ts`：`createVersion`/`updateLatestVersionContent`/`findLatestVersion`/`listVersionsByDocumentId`/`findVersionById`

## 2. 后端文档 CRUD 接口

- [x] 2.1 `apps/api/src/services/document.ts`：创建/移动时校验 `parentId` 归属同一 Wiki；保存内容时从 JSON 提取纯文本写入 `searchText`（遍历节点树拼接 `text` 属性）
- [x] 2.2 `apps/api/src/handlers/document.ts`：`listDocumentsHandler`/`createDocumentHandler`/`updateDocumentHandler`/`deleteDocumentHandler`，用 zod 校验请求体（另加 `getDocumentHandler`，编辑视图需要单篇文档详情）
- [x] 2.3 `apps/api/src/routes/document.ts`：挂载在 `/wikis/:wikiId/documents` 下，`GET` 用 `requireWikiRole('VIEWER')`，`POST`/`PATCH`/`DELETE` 用 `requireWikiRole('EDITOR')`；在 `routes/index.ts` 注册
- [x] 2.4 跨 Wiki 指定父文档时返回 `400 invalid_input`（对应 spec 场景）
- [x] 2.5 未上传封面图时复用 `buildDicebearUrl('shapes', title)` 生成默认封面

## 3. 内容安全校验（服务端复用编辑器 Schema）

- [x] 3.1 `apps/api` 新增 `@tiptap/core`/`@tiptap/pm` 依赖（仅用于 Schema 构建与校验，不涉及 React/DOM）
- [x] 3.2 `apps/api/src/utils/document-schema.ts`：引入 `@lhx-kit/tiptap-editor/schema` 子路径导出的 `documentEditorExtensions`（纯 Schema 配置、不含 React，见 packages/tiptap-editor 新增的 `src/schema.ts` 独立构建入口），用 `getSchema()` 构建 ProseMirror `Schema`
- [x] 3.3 新增 `validateDocumentContent(json)`：用 `Node.fromJSON(schema, json)` 尝试还原，捕获异常转换为校验失败
- [x] 3.4 `updateDocumentHandler` 保存内容前调用校验，失败返回 `400 invalid_content`，不写入数据库

## 4. 版本历史（后端）

- [x] 4.1 常量定义"编辑会话中断阈值"（30 分钟，`services/document-version.ts` 的 `SESSION_GAP_THRESHOLD_MS`）
- [x] 4.2 `updateDocument` service 内：保存内容时查最近一条版本记录，判断距其 `updatedAt`（补充在 `DocumentVersion` model 上，见 1.2 备注）是否超过阈值——超过则新建版本记录，否则更新该记录的快照内容
- [x] 4.3 `apps/api/src/routes/document.ts` 新增 `GET /wikis/:wikiId/documents/:documentId/versions`（`requireWikiRole('EDITOR')`）与 `POST /wikis/:wikiId/documents/:documentId/versions/:versionId/restore`（`requireWikiRole('OWNER')`）
- [x] 4.4 恢复接口逻辑：把目标版本内容写入 `Document.content`/`title`，并按 4.2 的规则追加/更新一条新版本记录（不删除任何已有版本）

## 5. 链接预览（后端）

- [x] 5.1 `apps/api/src/services/link-preview.ts`：抓取目标 URL 的 HTML，解析 OpenGraph 标签（`og:title`/`og:description`/`og:image`）与 favicon，缺失时用 `<title>` 兜底
- [x] 5.2 SSRF 防护：解析目标 URL 的主机名对应的 IP，命中私有网段/回环/链路本地地址时直接拒绝，不发起请求（含每一跳重定向都重新校验，防止绕过第一跳检查）
- [x] 5.3 请求超时（5s）与响应体大小上限（2MB），超出终止并视为失败
- [x] 5.4 `apps/api/src/routes/link-preview.ts`：`POST /link-preview`（挂 `requireAuth`），失败统一返回一个"不可用"结构而不是抛异常

## 6. 搜索接口重构

- [x] 6.1 `apps/api/src/services/search.ts`：对 `Wiki.name`/`Wiki.description`/`Document.title`/`Document.searchText` 做 `ILIKE` 查询，范围限定在当前用户可访问的 Wiki/文档
- [x] 6.2 `apps/api/src/routes/search.ts`：新增 `GET /search?q=`（挂 `requireAuth`），返回 Wiki 与 Document 两类结果
- [x] 6.3 前端 `services/search.ts` + `store/search.ts`（薄转发，没有 zustand 状态需要维护，遵循"组件不直接 import services"的统一约束）：`SearchDialog` 输入关键字（300ms 防抖）后调用该接口，替换掉此前对 `wikis` 数组的本地过滤逻辑；未输入时的置顶列表逻辑不变

## 7. `packages/tiptap-editor`：基础扩展与编辑器组件骨架

- [x] 7.1 补齐依赖：`@tiptap/extension-image`、`@tiptap/extension-task-list`、`@tiptap/extension-task-item`、`@tiptap/extension-placeholder`、`@tiptap/extension-code-block-lowlight` + `lowlight`（仅注册 12 种指定语言）、`mermaid`、`@tiptap/suggestion`（`@tiptap/extension-link` 不用单独装——StarterKit v3 已内置 Link，单独装会触发"Duplicate extension names"，改为通过 `StarterKit.configure({link: {...}})` 覆盖配置）
- [x] 7.2 `src/utils/extensions.ts`：组装 `documentEditorExtensions`（纯 Schema 配置，不含 React），新增 `src/schema.ts` 作为独立 tsup 构建入口（`@lhx-kit/tiptap-editor/schema` 子路径）单独导出这份配置，供 `apps/api` 安全引入而不拉进 `@tiptap/react`/`mermaid`（已用 Node.js 实测验证，见验证记录）
- [x] 7.3 `src/components/DocumentEditor.tsx`：可编辑组件，接收 `content`/`editable`/`offline`/`title`/`onTitleChange`/`uploadImage`/`onSave`/`onSaveStatusChange`/`fullscreen`/`onFullscreenChange` props（`onUpdate` 改为内部自动保存回调 `onSave`，跟 14 组的自动保存设计保持一致，不单独暴露原始 `onUpdate`）。标题渲染在正文内容可滚动区域的最顶部（`.doc-editor__canvas` 内，`EditorContent` 之前），跟正文共享同一栏居中定宽和同一个滚动容器——跟飞书一致：标题是文档的第一行，会跟着正文一起滚动，不是页面级单独固定的一条通栏；标题仍是独立字段，不写进 `content` JSON（决策 1 不变），只是渲染位置和保存回调都交给这个组件
- [x] 7.4 `src/index.ts`：导出 `DocumentEditor` 组件、`DocumentOutline` 组件与 `documentEditorExtensions`
- [x] 7.5 `src/styles/index.css`：**改用原生 CSS 自定义属性（`--doc-editor-*` 变量）而非 Less 变量**——原计划的 Less 需要消费方的构建工具处理 `.less` 文件，会让"未来 `apps/desktop` 复用"这个目标反而更受限；CSS 自定义属性不需要任何预处理器，浏览器原生支持，更符合"不依赖特定构建工具"的初衷，效果（标题字号/行高/内容居中定宽/深色模式跟随 `.dark` 切换）完全等价

## 8. 代码块能力

- [x] 8.1 集成 `lowlight`，只注册 12 种语言（JS/TS/Go/C++/Rust/Java/Python/Kotlin/SQL/JSON/CSS/HTML，`html` 作为 `xml` 语法的别名），支持自动检测
- [x] 8.2 代码块 UI（`components/CodeBlockView.tsx`）：语言标签展示、复制按钮（写入剪贴板）、折叠/展开交互
- [x] 8.3 深色模式下代码高亮主题切换为对应的深色配色（`.dark .hljs-*` 覆盖规则），浅色模式用近似 `github-light` 的配色

## 9. 斜杠命令菜单

- [x] 9.1 `src/utils/slash-command.ts`：基于 `@tiptap/suggestion` 配置触发字符 `/` 与候选项过滤逻辑（标题/列表/任务列表/引用/代码块/分割线/Mermaid/图片共 10 项）
- [x] 9.2 `src/components/SlashCommandMenu.tsx`：弹出菜单 UI，列出可插入的块类型（含 Mermaid），支持键盘上下选择与回车确认
- [x] 9.3 选中菜单项后插入对应空块并移除 `/` 触发字符（`Suggestion` 的 `command` 回调统一处理 `deleteRange`）
- [x] 9.4 输入内容不匹配任何候选项时展示"没有匹配的命令"空态（不强制自动关闭，允许用户继续删字重新匹配，符合 `Suggestion` 默认行为）

## 10. 悬浮工具栏与图片上传

- [x] 10.1 `src/components/FormattingBubbleMenu.tsx`：用 `@tiptap/react/menus` 的 `BubbleMenu`，提供加粗/斜体/删除线/行内代码/链接按钮
- [x] 10.2 `DocumentEditor` 图片相关交互（粘贴、拖拽、斜杠命令）统一调用 `uploadImage` 回调，都走同一个 `startImageUpload` 函数（不额外提供常驻工具栏按钮——跟飞书一致，插入图片不需要占一个持续可见的 UI 位置，只保留粘贴/拖拽/斜杠命令三个入口）
- [x] 10.3 上传中用 ProseMirror Decoration 展示加载占位（不写入文档内容，避免自动保存期间意外持久化"上传中"这种瞬时状态）；上传失败移除占位、不插入任何图片节点
- [x] 10.4 图片渲染限制最大宽度（CSS）并接入浏览器原生懒加载（`loading="lazy"`，通过 `Image.configure({HTMLAttributes})` 统一设置）

## 11. Mermaid 图表块

- [x] 11.1 自定义 Tiptap Node（`utils/mermaid-node.ts`，属性含 `source`/`mode: 'editing' | 'display'`）
- [x] 11.2 NodeView（`components/MermaidView.tsx`）：`editing` 态左右分栏（源码文本域 + `mermaid.js` 动态 `import()` 实时渲染预览，`securityLevel: 'strict'`），`display` 态只渲染 SVG
- [x] 11.3 `Cmd/Ctrl+Enter` 或"完成"按钮：`editing` → `display`；双击图表：`display` → `editing`
- [x] 11.4 语法错误时预览侧展示错误提示，不影响源码编辑
- [x] 11.5 只读模式下（`editor.isEditable === false`）强制 `display`，不渲染任何切换入口

## 12. 文档大纲导航（TOC）

- [x] 12.1 `src/hooks/use-document-outline.ts`：遍历当前编辑器文档，提取标题节点及层级
- [x] 12.2 `src/components/DocumentOutline.tsx`：渲染大纲列表，点击项跳转定位到对应标题。浮动在正文左侧的空白留白区域（`position: absolute`），不占用 `.doc-editor__body` 的 flex 宽度分配、不需要一条分割线区分它和正文——这样有没有大纲、大纲展开/收起都不会挤动居中的正文；支持手动收起/展开（点击浮层左上角的切换按钮）
- [x] 12.3 内容变化时大纲实时重新计算（监听 `editor` 的 `update` 事件）；只在文档存在标题节点时渲染（无标题时不渲染，`items.length === 0` 直接返回 `null`），视口过窄放不下浮层时隐藏（`max-width: 1100px` 媒体查询）

## 13. 全屏沉浸编辑模式

- [x] 13.1 `DocumentEditor` 新增 `fullscreen`/`onFullscreenChange` 受控 props；实际"隐藏 `Sidebar`"由消费方（`apps/web` 的文档编辑页面）根据同一个 `fullscreen` 状态自行控制布局——编辑器包本身不知道、也不应该知道 `Sidebar` 的存在，留给 Group 17 接入
- [x] 13.2 监听 `Esc` 键调用 `onFullscreenChange(false)`，恢复原布局交给消费方

## 14. 自动保存与状态反馈

- [x] 14.1 `DocumentEditor` 内部防抖逻辑（默认 800ms，可通过 `autosaveDelay` prop 调整），触发外部传入的 `onSave(json)` 回调
- [x] 14.2 `saveStatus`（`idle | saving | saved | error`）通过 `onSaveStatusChange` 回调暴露给消费方，组件内部也自带一个默认的状态提示 UI（保存中/已保存/保存失败+重试）
- [x] 14.3 `VIEWER` 只读模式与离线只读模式下：`editable={false}` 时 ProseMirror 视图本身不接受用户输入，`onUpdate`/`onSave` 结构性地不会被触发，不需要额外判断逻辑

## 15. 离线只读缓存

- [x] 15.1 `apps/web/src/lib/offline-cache.ts`：基于 IndexedDB 的轻量 key-value 封装（存取文档树/文档内容；Wiki 列表缓存不在这轮实现范围内——离线场景的核心诉求是"已浏览过的文档还能看"，spec.md 的验收场景也都是文档级别，Wiki 列表缓存留作后续按需补充）
- [x] 15.2 文档树（`store/document.ts` 的 `fetchDocuments`）/文档内容（`getDocument`）成功拉取后写入缓存；请求失败时改为读取缓存展示
- [x] 15.3 离线状态下 `DocumentEditorPage` 把 `offline` prop 传给 `DocumentEditor`，组件内部强制 `editable=false`，展示"当前离线，暂不支持编辑"提示
- [x] 15.4 `useOnlineStatus` hook 监听 `online`/`offline` 事件；`DocumentEditorPage` 的数据拉取 effect 依赖这个状态，网络恢复时自动重新拉取最新数据并恢复可编辑
- [x] 15.5 离线且缓存中没有目标文档时（`getDocument` 返回 `null`），页面展示"内容当前不可用"提示，不崩溃

## 16. 链接预览卡片（前端）

- [x] 16.1 粘贴 URL 时的检测（`utils/link-preview-extension.ts` 的 `handlePaste`）与"纯链接/预览卡片"选择 UI（`components/LinkPasteChooser.tsx`）
- [x] 16.2 选择卡片后调用消费方注入的 `fetchLinkPreview`（`apps/web` 里对应 `POST /link-preview`），渲染标题/描述/图片/favicon 卡片（`utils/link-preview-node.ts` 的 `LinkPreviewCard` Schema + `renderHTML`）
- [x] 16.3 请求失败/超时时自动降级为纯文本链接（`fetchLinkPreview` 返回 `null` 时统一走 `insertPlainLink` 路径，跟"选择纯链接"是同一条代码路径）

## 17. `apps/web` 集成

- [x] 17.1 `services/document.ts`/`services/link-preview.ts`/`services/search.ts`/`store/document.ts`：文档 CRUD、版本历史、图片上传、链接预览、离线缓存相关 action（风格对齐 `store/wiki.ts`）
- [x] 17.2 `store/document.ts` 新增 `uploadImage`/`fetchLinkPreview` action（复用 `services/upload.ts`/`services/link-preview.ts`），作为 props 传给 `DocumentEditor`
- [x] 17.3 `Sidebar.tsx` + 新增 `SidebarWikiEntry.tsx`：Wiki 条目新增展开/收起交互，展开后按 `parentId` 组装（`lib/document-tree.ts`）并渲染文档树（`components/wiki/DocumentTreeList.tsx`，支持多级缩进）；无文档时展示"暂无文档"+ 新建入口
- [x] 17.4 新增 `pages/wiki/DocumentEditorPage.tsx`（路由 `/wiki/:wikiId/documents/:documentId`），挂载 `DocumentEditor`（标题/大纲导航/全屏开关/保存状态 UI 均由组件内置渲染，本页只负责数据装配和把 `title`/`onTitleChange` 传下去）+ 版本历史入口（页面级按钮打开 `VersionHistoryDialog`）。为了让"文档内容区域自己滚动、不是整页跟着滚"，`AppShell.tsx` 的根容器从 `min-h-svh` 改为 `h-svh`（固定视口高度而不是只设最小高度）并给 `main` 补上 `min-h-0`——否则 flex 子项默认按内容撑高，`.doc-editor__content-wrapper` 自己的 `overflow-y-auto` 永远没机会生效，溢出会一路传导到浏览器文档层面滚动
- [x] 17.5 `WikiDetail.tsx`：从固定占位改为渲染真实文档树 + 创建顶层文档入口
- [x] 17.6 `components/wiki/VersionHistoryDialog.tsx`：列表 + 查看某版本内容（复用 `DocumentEditor` 的只读渲染，不重新实现一套内容展示）+ `OWNER` 可见的恢复按钮
- [x] 17.7 删除孤儿文件 `apps/web/src/components/Editor/TipTap.tsx`
- [x] 6.3（后端 6 组遗留的前端部分）`SearchDialog.tsx` 改为调用 `services/search.ts`，替换掉此前对 `wikis` 数组的本地过滤逻辑；未输入时的置顶列表逻辑不变

## 18. 验证

- [ ] 18.1 `pnpm --filter api typecheck` + `pnpm --filter web typecheck` + `packages/tiptap-editor` 的 `typecheck`
- [ ] 18.2 curl 验证：文档权限边界（`VIEWER` 403、跨 Wiki 挂父文档 400）、非法内容 JSON 返回 `400 invalid_content`
- [ ] 18.3 curl 验证：`POST /link-preview` 对内网地址返回拒绝，对正常公网 URL 返回元信息，超时/失败时返回"不可用"结构
- [ ] 18.4 curl 验证：`GET /search?q=` 能同时匹配 Wiki 和 Document，跨团队不受筛选
- [ ] 18.5 浏览器验证：Sidebar 展开文档树、多级子文档缩进展示正确
- [ ] 18.6 浏览器验证：斜杠命令、悬浮工具栏、图片上传（含加载/失败态与限宽懒加载）、代码块（语言检测/复制/折叠）
- [ ] 18.7 浏览器验证：Mermaid 编辑态/展示态切换、语法错误提示、只读模式下不可编辑
- [ ] 18.8 浏览器验证：大纲导航点击跳转、全屏模式进入退出
- [ ] 18.9 浏览器验证：自动保存状态切换、断网模拟下的离线只读提示与恢复网络后自动可编辑
- [ ] 18.10 浏览器验证：版本历史列表按编辑会话聚合、`OWNER` 恢复、`EDITOR` 无法恢复
- [ ] 18.11 浏览器验证：链接预览卡片选择、抓取失败降级
- [ ] 18.12 清理验证过程中产生的测试数据
