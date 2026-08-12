## Why

`yjs-docs` 目前只做完了 Wiki（工作区）和 Team（组织）两层模型，"文档"本身——项目真正要承载的核心内容——从未落地：`WikiDetail.tsx` 是"暂无文章"的固定占位，`Sidebar` 的 Wiki 分组只有平铺链接、没有文章树，`packages/tiptap-editor` 是零实现的空脚手架，`apps/web/src/components/Editor/TipTap.tsx` 是跟着官方文档抄的一次性验证代码，从未接入任何页面。没有 Document 模型和一个能用的编辑器，Sidebar 文章树、Wiki 详情页、后续的 Yjs 实时协同都无从谈起。这轮补齐这条链路，但**不接 Yjs**——协同编辑是下一个独立 change 的范围，这次做一个功能完整、体验对齐飞书/Notion 心智的"非实时协同版"文档编辑器：能创建、能编辑、能自动保存、能安全存储、能看历史版本、能离线浏览、能被搜到。

## What Changes

### 数据与权限
- 新增 `Document` 数据模型：归属某个 Wiki，`parentId` 自引用构建文章树，级联删除跟随所属 Wiki/父文档；`coverImage` 未上传时复用 Wiki 同款的 DiceBear 按标题生成默认封面
- 新增文档树形 CRUD 接口，权限直接继承所属 Wiki 的角色（`EDITOR` 及以上可写，`VIEWER` 只读），不做文档级单独覆盖
- 文档内容以 Tiptap 的 ProseMirror JSON 形式存储（`jsonb`），保存接口 MUST 复用编辑器扩展定义的 Schema 做服务端校验，拒绝无法识别的节点/属性，防止绕过编辑器注入恶意内容
- 保存策略为编辑即自动保存，并发覆盖策略明确为 Last-Write-Wins（不引入乐观锁/版本号，留给下一轮 Yjs 协同整体解决）

### 编辑器能力（`packages/tiptap-editor` 从零实现）
- 块类型：标题/段落/列表/任务列表/引用/代码块（12 种常用语言语法高亮、自动检测、复制按钮、可折叠）/分割线/图片/链接/行内格式化
- 自研斜杠命令菜单（`/` 唤起插入菜单）与选中文字悬浮工具栏；**不做**块拖拽排序把手（Tiptap 官方拖拽扩展是付费 Pro 功能，列为 Non-Goal）
- **Mermaid 图表块**：编辑态左右分栏（代码+实时预览），确认后收起为只显示渲染图，需要修改时双击重新进入编辑态；`VIEWER` 只读模式下仅展示渲染结果
- **文档大纲导航（TOC）**：根据当前内容的标题节点自动生成目录，点击跳转到对应位置，纯前端解析，不需要新接口/新数据
- **全屏沉浸编辑模式**：隐藏 Sidebar，`Esc` 退出
- 图片支持最大宽度限制与懒加载
- 图片上传复用现有通用接口 `/uploads/images`，编辑器包本身不感知具体接口，通过 `uploadImage` 回调 prop 解耦
- 自动保存状态（保存中/已保存/保存失败）SHALL 在界面上有明确反馈，因为没有手动保存按钮兜底
- 样式不依赖 Tailwind，用原生 CSS 自定义属性（变量）实现（比原计划的 Less 变量更彻底地保证 `packages/tiptap-editor` 未来被 `apps/desktop` 复用时不受限——不需要任何 CSS 预处理器，浏览器原生支持），内容区居中定宽，深色模式下代码高亮主题跟随切换

### 第三方链接预览卡片（新增独立能力）
- 粘贴一个 URL 后，SHALL 提示用户选择"显示为纯链接"或"显示为预览卡片"
- 卡片信息（标题/描述/图片/favicon）SHALL 通过新增的后端接口抓取目标页面的 OpenGraph 元信息，MUST 对目标 URL 做私有/内网地址过滤与超时限制，防止 SSRF
- 抓取失败时 MUST 自动降级为纯文本链接，不阻塞粘贴操作

### 版本历史（新增独立能力）
- 新增 `DocumentVersion` 表，按"编辑会话聚合"（持续编辑中断超过 30 分钟才切一个新版本）触发快照，避免自动保存的高频写入产生过多版本记录
- 版本内容为完整快照（不做差量存储），不设版本数量上限
- `EDITOR` 及以上可查看历史版本列表，仅 `OWNER` 可执行恢复；恢复操作 SHALL 追加一条新版本记录，不删除中间历史

### 离线能力（范围收窄为"离线只读"）
- 已浏览过的 Wiki/文档树/文档内容 SHALL 缓存到浏览器本地存储（IndexedDB），断网时仍可浏览
- **不做离线编辑**：检测到离线时编辑器自动切换为只读态，提示当前离线；网络恢复后自动切回可编辑。理由：离线编辑需要的"重新联网后安全合并冲突"能力本质上是 Yjs/CRDT 要解决的问题，本轮用非 CRDT 方式勉强做，风险和工作量都不划算，留给下一轮协同一起做

### 搜索范围扩展（**Modified Capability**）
- `wiki-search` 的搜索范围从"仅 Wiki 名称/简介"扩展到"同时覆盖 Document 标题与正文文本"
- 搜索架构从"前端对已预载的 `wikis` 数组做纯前端过滤"改为"调用后端搜索接口"——理由：Document 的数据量级跟 Wiki 不是同一档（每个 Wiki 下可能有大量文档、正文文本体量也远大于 Wiki 简介），继续沿用"全量拉到浏览器内存里过滤"的模式不再合适

### 清理
- **BREAKING**：删除孤儿文件 `apps/web/src/components/Editor/TipTap.tsx`（未被任何页面引用的一次性验证代码）

## Capabilities

### New Capabilities
- `wiki-document`：Document 数据模型、树形结构与 CRUD 接口、权限继承、内容安全校验、并发策略、封面图生成
- `document-editor`：编辑器块类型范围、斜杠命令、悬浮工具栏、Mermaid 双态编辑、大纲导航、全屏模式、只读模式、图片上传交互与限宽懒加载、自动保存状态反馈、离线只读缓存的前端行为、Sidebar 文档树展开与 `WikiDetail` 渲染
- `document-versioning`：版本快照触发策略、存储、查看/恢复权限
- `link-preview`：链接解析卡片的抓取接口、SSRF 防护、前端选择交互与降级处理

### Modified Capabilities
- `wiki-search`：搜索范围扩展到 Document 标题/正文，搜索架构由纯前端过滤改为后端接口查询

## Impact

- **数据库**：新增 `Document`、`DocumentVersion` 两张表，需要一次 `prisma migrate dev`；`Document` 新增一个反范式化的纯文本字段（`searchText`）供搜索使用（从内容 JSON 提取，保存时同步更新）
- **后端**：新增 `routes/document.ts`/`handlers/document.ts`/`services/document.ts`/`models/document.ts`/`models/document-version.ts`；新增 `routes/link-preview.ts`（OG 元信息抓取 + SSRF 防护）；新增 `GET /search` 接口替代前端纯过滤；新增内容 JSON 的服务端 schema 校验工具（复用 `packages/tiptap-editor` 导出的扩展定义）
- **前端**：`packages/tiptap-editor` 从零实现完整编辑器（块类型、斜杠命令、悬浮工具栏、Mermaid、大纲导航、全屏模式、图片处理），样式用原生 CSS 自定义属性；`apps/web` 新增文档相关 store/service、IndexedDB 缓存层、改写 `Sidebar.tsx`/`WikiDetail.tsx`/`SearchDialog.tsx`；删除孤儿文件 `components/Editor/TipTap.tsx`
- **不涉及**：Yjs 实时协同、文档级权限覆盖、离线编辑与合并、导出（Markdown/PDF）、评论/@提及、文档模板、非图片文件附件——均为明确 Non-Goals，留给后续独立 change
