## Context

现状：`Document` 模型不存在，`packages/tiptap-editor` 是零实现的空脚手架，`apps/web/src/components/Editor/TipTap.tsx` 是孤儿文件。`Wiki` 层已有的 `WikiRole` + `requireWikiRole` 中间件、`buildDicebearUrl` 封面生成、`/uploads/images` 通用上传是这次要复用的地基。这轮范围经过多次讨论逐步扩到：基础编辑器 + Mermaid + 链接预览卡片 + 版本历史 + 离线只读缓存 + 搜索范围扩展，Yjs 协同仍是下一个独立 change。

## Goals / Non-Goals

**Goals:**
- Document 树形模型 + CRUD，权限继承 Wiki 角色
- 保存内容前做服务端 schema 校验
- 编辑即自动保存，前端有明确保存状态反馈
- `packages/tiptap-editor` 产出一个开箱即用的块级编辑器，覆盖常见块类型、Mermaid、大纲导航、全屏模式
- 链接预览卡片，且不引入 SSRF 风险
- 版本历史，且版本切分粒度合理（不随自动保存高频产生垃圾数据）
- 离线时文档"能看"，缓存基于 IndexedDB
- 搜索覆盖到文档标题/正文

**Non-Goals:**
- Yjs 实时协同（下一个 change）
- 文档级权限覆盖
- 离线编辑与冲突合并（离线只做只读，见决策 8）
- 版本对比可视化 diff（只展示完整快照，不做逐字高亮对比）
- 块拖拽排序把手（Tiptap 官方 Drag Handle 是付费 Pro 扩展）
- 乐观锁/版本号并发控制（这轮接受 Last-Write-Wins）
- 评论/@提及、导出（Markdown/PDF）、文档模板、非图片文件附件、Page Icon、移动端适配

## Decisions

### 1. Document 数据模型：`parentId` 自引用建树 + 反范式化搜索字段
```prisma
model Document {
  id         String    @id @default(uuid(7)) @db.Uuid
  wikiId     String    @db.Uuid
  parentId   String?   @db.Uuid
  title      String    @default("未命名文档")
  content    Json      @default("{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}")
  searchText String    @default("") // 从 content 提取的纯文本，保存时同步更新，供搜索使用（见决策 9）
  coverImage String?
  order      Int       @default(0)
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  wiki     Wiki       @relation(fields: [wikiId], references: [id], onDelete: Cascade)
  parent   Document?  @relation("DocumentTree", fields: [parentId], references: [id], onDelete: Cascade)
  children Document[] @relation("DocumentTree")
  versions DocumentVersion[]
}
```
`content` 用 `jsonb` 直接存 `editor.getJSON()`；`coverImage` 未上传时用 `buildDicebearUrl('shapes', title)` 兜底，跟 Wiki 完全一致的模式，不新写生成逻辑。标题独立字段，不放进 `content` 里。`order` 用简单整数、同级重排序时全量重新赋值。

### 2. 权限继承 Wiki 角色，复用 `requireWikiRole`
不新增权限模型，`/wikis/:wikiId/documents` 系列路由复用 `requireWikiRole('VIEWER')`（读）/`requireWikiRole('EDITOR')`（增删改）。前端编辑器按角色设置 `editable`，`VIEWER` 全只读。

### 3. 内容安全校验：服务端复用同一份 Tiptap Schema
`packages/tiptap-editor` 导出纯扩展配置数组 `documentEditorExtensions`（不含 React 组件），`apps/api` 引入后用 `@tiptap/core` 的 `getSchema()` 构建 `Schema`，保存时用 `Node.fromJSON(schema, json)` 校验，还原失败返回 `400 invalid_content`。Mermaid、链接卡片这些自定义节点同样是这份扩展列表里的普通 Node，天然被同一条校验路径覆盖，不需要为它们单独写校验规则。

### 4. 保存策略：自动保存 + Last-Write-Wins，不做并发锁
前端防抖 800ms 后自动 `PATCH`，本地维护 `idle | saving | saved | error` 状态机驱动 UI 提示。后端不加乐观锁，并发更新按到达顺序覆盖。这是本轮唯一"知道有问题但不解决"的点，理由：下一轮 Yjs 上线后这个问题被协同机制整体取代，现在做过渡方案是一次性投入。

### 5. 编辑器块类型与交互范围
`StarterKit` 基础上补 `Image`/`Link`/`TaskList`/`TaskItem`/`CodeBlock`（`lowlight` 语法高亮，精选语言集：JS/TS/Go/C++/Rust/Java/Python/Kotlin/SQL/JSON/CSS/HTML，自动检测 + 复制按钮 + 折叠）/`Placeholder`。斜杠命令用 Tiptap 免费的 `Suggestion` 工具自研菜单；悬浮工具栏用已在依赖里的 `@tiptap/react/menus` 的 `BubbleMenu`。不做拖拽排序把手（Pro 功能，自研成本不匹配优先级）。

### 6. Mermaid 图表块：编辑态/展示态双状态 NodeView
自定义 Node（携带 mermaid 源码字符串作为属性），NodeView 维护一个本地 `mode: 'editing' | 'display'`：
- 插入后默认 `editing`：左右分栏，左边文本域写 mermaid 语法，右边用 `mermaid.js` 实时渲染预览；语法错误时右边展示错误提示，不影响左边继续编辑
- `Cmd/Ctrl+Enter` 或点击"完成"按钮 → 切到 `display`：只显示渲染后的 SVG，不显示源码
- `display` 态双击图表（或 hover 出现的"编辑"图标）→ 切回 `editing`
- `VIEWER` 只读模式：永远 `display`，不提供任何切回 `editing` 的入口
- Mermaid 配置 `securityLevel: 'strict'`，规避其 `click` 指令类的历史 XSS 风险面

### 7. 链接预览卡片：独立后端接口 + SSRF 防护
新增 `POST /link-preview`（`{url}` → `{title, description, image, favicon}`），服务端请求目标 URL 前：
- 解析并校验目标是私有/内网/回环地址（`10.*`/`172.16-31.*`/`192.168.*`/`127.*`/`169.254.*` 等）时直接拒绝，防止 SSRF 探测内网或云平台元数据接口
- 请求加超时（如 5s）与响应体大小上限，避免被拖慢或撑爆内存
- 抓取失败（超时/网络错误/无法解析 OG 信息）时返回一个"不可用"结果，前端据此自动降级为纯文本链接，不阻塞粘贴流程

前端粘贴 URL 后弹出"显示为纯链接 / 显示为预览卡片"的选择，用户选卡片才发起这个请求，不是所有粘贴的链接都自动抓取（避免不必要的请求量）。

### 8. 离线能力收窄为"只读缓存"，不做离线编辑
用 IndexedDB 缓存已浏览过的 Wiki 列表/文档树/文档内容（`apps/web` 新增一个轻量的 IndexedDB 封装层，风格上可以是简单的 key-value 存储，不需要引入重量级的离线框架）。检测到 `navigator.onLine === false`（或请求失败判定为离线）时：
- 文档树/详情从 IndexedDB 缓存读取展示
- 编辑器自动切换 `editable=false`，展示"当前离线，暂不支持编辑"提示
- 网络恢复（`online` 事件）后自动切回可编辑态，重新拉取最新数据（不做"离线期间的修改在恢复后自动同步"——因为本轮压根不允许离线时编辑，不存在需要同步的本地修改）

**为什么不做离线编辑**：离线编辑必然要解决"恢复网络后，本地这段时间的修改跟服务端可能已经变化的内容怎么合并"，这正是 Yjs/CRDT 要解决的问题；本轮如果用简单的"覆盖"或"手动选择保留哪份"的方式勉强做，风险（静默丢内容）和工作量都不比等 Yjs 划算，所以直接把范围卡在"离线只读"。

### 9. 搜索：从纯前端过滤改为后端接口，覆盖 Document
Document 数量级和正文体量跟 Wiki 不是一档，继续"预拉全量数据到前端内存里过滤"的模式（`wiki-search` 原有实现）不再合适。这轮新增 `GET /search?q=`，服务端用 Postgres `ILIKE` 对 `Wiki.name`/`Wiki.description`/`Document.title`/`Document.searchText` 做大小写不敏感的包含匹配（不引入 `tsvector` 全文索引与相关性排序，这轮的匹配语义跟原来前端过滤的"子串匹配"保持一致，只是执行位置挪到数据库）。`searchText` 字段在文档保存时同步从 `content` JSON 提取纯文本并更新（遍历节点树拼接所有文本节点的 `text` 属性）。

`SearchDialog` 未输入关键字时仍展示置顶 Wiki 列表（不变），只有真正输入关键字触发搜索时才调这个新接口，避免弹窗刚打开就发请求。

## Risks / Trade-offs

- **[Risk] Last-Write-Wins 静默丢内容** → Mitigation：自动保存防抖较短缩小窗口；下一轮 Yjs 上线后问题整体消失
- **[Risk] Mermaid 双状态 NodeView 是自定义交互，比标准 Node 更多潜在 bug 面** → Mitigation：状态机简单（只有两态），失败态（语法错误）明确处理，不吞异常
- **[Risk] `POST /link-preview` 即使做了内网地址过滤，仍存在请求任意公网 URL 被滥用做探测/耗资源的风险** → Mitigation：超时 + 响应体大小上限；这轮不做频率限制，若后续观察到滥用再加限流
- **[Risk] IndexedDB 缓存层如果不设容量上限，长期使用后可能占用较多本地存储** → Mitigation：这轮不做强制淘汰策略，作为已知限制记录，后续如有真实反馈再加 LRU 淘汰
- **[Risk] `searchText` 字段与 `content` 不同步（如某次保存漏更新）会导致搜索结果不准** → Mitigation：在 `updateDocument` 的同一个 service 函数内原子更新两个字段，不允许绕开这个函数直接改 `content`

## Migration Plan

- 新增 `Document`/`DocumentVersion` 两张表，跑一次 `prisma migrate dev`；无存量数据迁移
- 删除孤儿文件 `apps/web/src/components/Editor/TipTap.tsx`（**BREAKING**，但未被引用，实际影响为零）
- `wiki-search` 从前端过滤切到后端接口：`SearchDialog` 的调用方式改变，但用户可见行为（子串匹配语义、置顶列表展示逻辑）保持一致，不是用户可感知的破坏性变更

## Open Questions

（无遗留，本轮范围内的分歧点均已在上面决策中拍板）
