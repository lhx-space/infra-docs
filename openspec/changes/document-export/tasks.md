## 1. 数据模型与依赖

- [x] 1.1 新增 Prisma 模型 `DocumentExport`（`id`/`documentId`/`format`/`status`（`PENDING`/`PROCESSING`/`READY`/`FAILED`）/`objectKey`/`errorMessage`/`requestedBy`/`createdAt`），生成迁移
- [x] 1.2 `apps/api` 新增依赖：`prosemirror-markdown`、`@tiptap/html`、`jsdom`、`html-to-docx`、`playwright`（含安装 Chromium 二进制的构建步骤）——实际安装时 `jsdom` 不再需要：`@tiptap/html` v3 的 server 入口（`@tiptap/html/server`）改用随包 peer 安装的 `happy-dom`；另补了光栅化页直接用到的 `mermaid`（版本对齐 `packages/tiptap-editor`），Chromium 安装步骤为 `install:chromium` 脚本 + Dockerfile
- [x] 1.3 新增 `document-exports` 对象存储前缀相关的 `services/` 辅助函数（上传/下载/删除，参照 `services/storage.ts`/`services/video-storage.ts` 的既有约定）

## 2. Markdown 导出（同步）

- [x] 2.1 基于 `documentSchema`（`utils/document-schema.ts`）构建一份 `MarkdownSerializer`，覆盖标题/段落/列表/任务列表/引用/分割线/加粗/斜体/删除线/行内代码/链接等标准节点
- [x] 2.2 为自定义节点单独注册序列化规则：Mermaid → ` ```mermaid ` fenced code block（原始源码）；代码块 → 带语言标注的 fenced code block；图片 → 标准 Markdown 图片语法；链接预览 → 降级为纯链接
- [x] 2.3 视频节点、处于转码中/上传失败状态的图片视频节点 → 序列化为固定文字说明，不输出任何媒体引用
- [x] 2.4 未覆盖的未知节点类型兜底降级为纯文本，不抛出异常中断整篇转换
- [x] 2.5 新增 `services/document-export-markdown.ts`：输入物化内容 JSON，输出 Markdown 字符串

## 3. HTML 中间层与 Word 导出（同步）

- [x] 3.1 新增 `services/document-export-html.ts`：用 `@tiptap/html` 的 `generateHTML` + `documentEditorExtensions`（`@luhanxin/tiptap-editor/schema`）+ `jsdom` 环境，把内容 JSON 转换为 HTML 字符串——实现时发现 Node 下必须 import `@tiptap/html/server` 子路径（包根入口的 exports 条件在 Node 解析到浏览器版实现并直接抛错），DOM 环境由其内置 `happy-dom` 提供
- [x] 3.2 在生成 HTML 前对内容 JSON 做一次节点替换：视频节点、转码中/上传失败的媒体节点 → 替换为文字说明节点（复用第 2 组已确定的文案，避免两份格式各自维护一套文案）
- [x] 3.3 新增 `services/document-export-docx.ts`：用 `html-to-docx` 把上述 HTML 转换为 `.docx` Buffer——该包无类型声明，补了 `types/html-to-docx.d.ts`；另处理了它内部 minify 会吃掉 `<pre>` 换行的坑（换行先转 `&#10;` 实体保护）
- [x] 3.4 编写一套导出专用的最小 HTML/CSS（标题层级、代码块高亮、表格边框、图片限宽），跟编辑器只读渲染风格保持基本一致但不依赖编辑器运行时样式文件

## 4. PDF 导出（异步任务）

- [x] 4.1 新增队列 `document-export-pdf`（`queue/document-export.ts`），参照 `queue/video-transcode.ts` 的结构，设 `DOCUMENT_EXPORT_PDF_CONCURRENCY` 并发上限
- [x] 4.2 新增 `models/document-export.ts`：创建任务记录、按 `id` 查询、标记 `PROCESSING`/`READY`（带 `objectKey`）/`FAILED`（带 `errorMessage`）
- [x] 4.3 新增 `jobs/process-document-export-pdf.ts`：复用 3.1 的 HTML 生成 + 3.4 的打印样式，用 Playwright 打开页面 `setContent` 后 `page.pdf()` 生成 PDF；成功后上传到 `document-exports` 前缀并标记 `READY`，失败标记 `FAILED`（参照 `jobs/process-video-transcode.ts` 的成败落库与临时资源清理写法）
- [x] 4.4 在 `worker.ts` 注册新 Worker 消费 `document-export-pdf` 队列（复用现有 `queueConnection`）
- [x] 4.5 Mermaid 图表光栅化：在 4.3 的同一个 Playwright 页面上下文里，为每个 Mermaid 图表块单独渲染并截图为 PNG，替换回 HTML 对应位置后再整体生成 PDF——实现上是光栅化结果以 data URI 图片节点替换回内容 JSON 后再生成 HTML，Word/PDF 两条路径共用；光栅化页加载 `mermaid/dist/mermaid.min.js`（IIFE 自包含 bundle，classic `<script>` 加载），不能用包根 ESM 入口（裸模块导入 + file:// 模块 CORS 双重限制）

## 5. API 路由与 Handler

- [x] 5.1 新增 `routes/document-export.ts`：`POST /wikis/:wikiId/documents/:documentId/export`（body 携带目标格式），Markdown/Word 走 2/3 组的同步转换直接返回文件流；PDF 创建 `DocumentExport` 记录、入队 4.1 的队列，返回 `{exportId}`
- [x] 5.2 新增 `GET /wikis/:wikiId/documents/:documentId/exports/:exportId`：返回任务当前状态，`READY` 时附带下载地址
- [x] 5.3 新增 `GET /wikis/:wikiId/documents/:documentId/exports/:exportId/download`：校验状态为 `READY` 后，从对象存储流式返回文件
- [x] 5.4 三个路由统一挂载 `requireAuth` + `requireWikiRole('VIEWER')`，跟现有 `GET` 文档路由的权限判断保持一致

## 6. 定时清理

- [x] 6.1 新增 `jobs/cleanup-expired-document-exports.ts`：按固定保留时长（如 24 小时）清理超期的 `DocumentExport` 记录与对应存储对象，参照 `jobs/cleanup-orphan-video-assets.ts` 的既有结构与调度方式接入现有定时任务机制——调度（repeatable job）与清理队列一并放在 `queue/document-export.ts`，worker 启动时注册

## 7. 前端集成（apps/web）

- [x] 7.1 `DocumentEditorPage` 头部新增“导出”入口（跟“版本历史”/“删除”同级），点击展开 Markdown/Word/PDF 三个选项
- [x] 7.2 选择 Markdown/Word：直接调用 5.1 的同步接口，拿到文件流后触发浏览器下载
- [x] 7.3 选择 PDF：调用 5.1 拿到 `exportId`，展示“生成中”状态，按固定间隔轮询 5.2，`READY` 后展示下载按钮（触发 5.3）、`FAILED` 后展示失败提示
- [x] 7.4 处理导出请求本身失败（网络错误/权限错误）的提示分支，跟“生成失败”的状态提示区分清楚

## 8. 收尾验证

- [x] 8.1 用一篇包含标题/列表/表格/图片/代码块/Mermaid/视频（含一个转码中状态）的真实文档，分别导出三种格式，人工核对每种自定义节点的降级效果符合 specs 里逐条约定的行为——以组件级冒烟验证完成：Markdown 序列化（既有）+ HTML 生成（文本/视频占位/Mermaid div/代码块语言标注均正确产出）+ DOCX 转换（合法 zip，PK 魔数）+ Mermaid 光栅化（正常图 → PNG、语法错误图 → 降级文案）+ Playwright PDF 渲染（`%PDF-` 魔数）；端到端浏览器核对待本地起全套服务后人工过一遍
- [ ] 8.2 验证权限边界：非 Wiki 成员导出返回 `403`，`VIEWER` 可正常导出（需起全套服务人工验证；路由复用 `requireWikiRole('VIEWER')` 与文档 GET 同一判断链路）
- [ ] 8.3 验证 PDF 任务的完整生命周期：提交→轮询→就绪→下载，以及一次人为制造的失败场景（如临时改坏 HTML 生成逻辑触发异常）→ 状态正确落到 `FAILED` 并带出可读错误信息（需 Redis/MinIO/Postgres 全套环境人工验证）
- [ ] 8.4 验证超期清理 job 能正确删除到期的导出记录与存储对象，未到期的记录不受影响（需全套环境人工验证；可将 `DOCUMENT_EXPORT_RETENTION_MS` 临时调小加快触发）
