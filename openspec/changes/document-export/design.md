## Context

文档正文当前以结构化 ProseMirror JSON 存储（`document-schema.ts` 里 `documentSchema`，跟编辑器实际支持的节点类型同一份来源），REST `GET` 文档接口读到的是从 Yjs 状态定期物化出来的同一份 JSON（`services/yjs-content.ts`），不是实时读 Yjs 二进制——导出复用的正是这份已经存在的物化内容，不新增第二条内容读取路径。

`apps/api` 已经有一套成熟的"耗时异步任务"基础设施可以复用：`queue/`（BullMQ + Redis）+ `jobs/`（worker 消费）+ `worker.ts`（独立进程）+ 一个带 `status` 枚举的数据库模型（`VideoAsset`：`PROCESSING`/`ready`/`failed`）+ 对象存储（`services/storage.ts`，MinIO）+ 一个定时清理孤儿产物的 job（`cleanup-orphan-video-assets.ts`）。视频转码这套"提交任务→轮询状态→就绪后展示/下载"的模式跟本次 PDF 导出的耗时特征（无头浏览器渲染，明显比 Markdown/Word 转换慢）高度相似，是最合适的参照对象，而不是另起一套机制。

## Goals / Non-Goals

**Goals:**
- 支持把一篇文档导出为 Markdown / Word（`.docx`）/ PDF 三种格式，导出内容以文档当前的物化内容为准。
- Markdown/Word 走同步请求-响应（转换速度可接受，不需要排队）；PDF 走异步任务 + 轮询（复用现有 BullMQ 基础设施）。
- 转换逻辑对编辑器自定义节点类型（图片/视频/Mermaid/代码块/链接预览/表格/任务列表）都有明确、可预期的处理方式，即使某些类型只能降级展示。
- 导出权限直接复用文档现有的读权限判断（`requireWikiRole('VIEWER')`），不引入新概念。

**Non-Goals:**
- 不支持把导出的 `.docx`/PDF 反向导入回编辑器（单向导出，不做往返）。
- 不保留导出文件的历史记录列表（即导出即用，定时清理，非归档能力）。
- 不支持批量导出（整个 Wiki 或多篇文档一次打包）——本轮只做单文档导出。
- 不在导出文件中嵌入可播放的视频内容——视频节点降级为文字提示/链接。
- 不提供导出样式的用户自定义选项（页眉页脚、字体、主题色等）——v1 固定一套样式。

## Decisions

### 1. Markdown 转换：用 `prosemirror-markdown` 的 `MarkdownSerializer`，不手写递归转换器
`@tiptap/pm` 本身就是 `prosemirror-model` 的重导出，`prosemirror-markdown` 是同一生态官方维护的配套包，`MarkdownSerializer` 专门设计成"按节点/标记类型注册序列化函数"的扩展点，跟这里"给自定义节点类型（Mermaid/视频/代码块/链接预览）各自定义降级规则"的需求正好对上，不需要从零写一个 JSON 树遍历器。**备选方案**：手写递归 JSON→Markdown 转换器——放弃，因为要重新处理转义、列表嵌套缩进、表格对齐等 `prosemirror-markdown` 已经解决好的细节，价值不大。

### 2. Word/PDF 共用同一份 HTML 中间产物，用 `@tiptap/html` 的 `generateHTML` 生成
`@tiptap/html` 官方支持在 Node.js（非浏览器）环境把 ProseMirror JSON 渲染成 HTML 字符串（依赖 `jsdom` 提供最小 DOM 实现，新增为 `apps/api` 的一个依赖），用的是跟前端编辑器完全相同的 `documentEditorExtensions`（`@luhanxin/tiptap-editor/schema`）——渲染规则的来源跟内容校验、Markdown 转换共享同一份 Schema 定义，不会出现三套转换各自理解不一致的节点结构。Word 和 PDF 都从这份 HTML 出发，不各自维护一套"从 JSON 直接生成"的逻辑。**备选方案**：直接遍历 ProseMirror JSON 分别生成 docx 树和 PDF 排版——放弃，工作量翻倍且两份逻辑容易在自定义节点的处理上跑偏，先用 HTML 这条更成熟的中间层。

### 3. Word 用 `html-to-docx` 从 HTML 生成，接受 v1 阶段的保真度上限
`html-to-docx` 是纯 JS、无原生依赖的轻量转换库，能覆盖标题层级、列表、表格、图片、代码块这些基础排版，跟 Markdown 导出遇到不支持节点时"降级为纯文本、不阻断整篇导出"是同一个工程取舍：先保证覆盖率和稳定性，复杂表格/嵌套列表的精确还原留到有真实反馈再优化（见 Risks）。**备选方案**：用 `docx` 库手写文档树——保真度上限更高，但要为每种节点类型单独写生成逻辑，工作量明显更大，v1 先不做。

### 4. PDF 用 Playwright 无头浏览器渲染同一份 HTML（配一套专用打印样式）
把 HTML 中间产物套上一套只用于导出的打印样式（分页、页边距、代码块不截断换页等），用 Playwright 打开一个空白页、`setContent` 后调 `page.pdf()` 生成分页 PDF——视觉呈现天然接近编辑器只读渲染，不需要额外维护一套排版引擎。**备选方案**：Puppeteer——能力等价，选 Playwright 只是因为它的浏览器二进制管理和跨平台支持在这个仓库当前工具链里更省心，没有强烈的技术理由排斥 Puppeteer。

### 5. Mermaid 图表的导出降级策略按格式区分
- **Markdown**：直接输出原始 Mermaid 源码包在 ` ```mermaid ` 代码块里——GitHub 等主流 Markdown 渲染环境原生认识这个语法，不需要额外转换。
- **Word/PDF**：无法嵌入交互式图表，用跟 PDF 导出同一个 Playwright 无头浏览器实例，加载一个只跑 `mermaid.js` 渲染的最小页面把每个图表块光栅化成 PNG，再嵌入 HTML 中间产物对应位置——复用同一个浏览器实例，不为光栅化单独再起一套渲染环境。

### 6. 视频节点导出降级为文字提示，不尝试嵌入任何视频内容
三种格式统一把视频节点替换成一行文字说明（例如"[视频内容，请在应用内查看]"），不生成缩略图、不尝试打包视频文件——嵌入可播放视频超出静态文档格式的能力范围，缩略图对文字类导出的价值有限，不值得为此新增依赖。

### 7. 异步任务模型对齐 `VideoAsset` 的既有模式，新增 `DocumentExport` 模型
新增 Prisma 模型 `DocumentExport`（`id`/`documentId`/`format`/`status`(`PENDING`/`PROCESSING`/`READY`/`FAILED`)/`objectKey`/`errorMessage`/`requestedBy`/`createdAt`），只用于 PDF 这条异步路径——Markdown/Word 同步生成、同步返回文件，不落库、不占用队列资源（呼应视频转码"封面优先"体现的同一个原则："不是所有工作都值得强制走重量级异步路径，只把真正慢的部分丢给队列"）。新增队列 `document-export-pdf`，并发上限参照 `VIDEO_TRANSCODE_CONCURRENCY` 同样的保守取值方式设一个 `DOCUMENT_EXPORT_PDF_CONCURRENCY`，避免多个 Playwright 实例互相抢占资源。

### 8. 导出产物走独立的对象存储前缀 + 定时清理，不长期保留
新增 `document-exports` 存储前缀（复用现有 `services/storage.ts`/MinIO），产物 SHALL 视为临时文件；新增一个定时清理 job（对齐 `cleanup-orphan-video-assets.ts` 的既有模式），按固定保留时长（如 24 小时）清理过期的 `DocumentExport` 产物与记录，避免导出被反复触发却无人下载导致存储无限增长。

### 9. 权限判断复用现有中间件，不新增导出专属权限位
导出路由直接套用跟 `GET` 文档同样的 `requireWikiRole('VIEWER')`——能看到文档内容就能导出，跟"导出只是内容的另一种呈现方式"这个产品语义一致，不需要单独的权限维度。

## Risks / Trade-offs

- **[Risk]** Playwright 无头浏览器给 `apps/api`/worker 部署引入更重的运行时依赖（浏览器二进制体积、内存占用）→ **Mitigation**：PDF 渲染与 Mermaid 光栅化共用同一个浏览器实例，设并发上限（同视频转码的保守取值思路），必要时未来可把导出相关任务拆到独立 worker 进程，不影响本轮设计的路由/数据模型。
- **[Risk]** 服务端光栅化的 Mermaid 图表视觉效果可能跟浏览器里实时渲染的略有差异（字体/主题渲染差异）→ **Mitigation**：复用跟前端完全一致的 mermaid 版本与主题配置，作为已知的可接受轻微保真度差异记录在案。
- **[Risk]** `html-to-docx` 对复杂表格、深层嵌套列表的还原可能不够精确 → **Mitigation**：v1 接受这个上限（跟 Markdown 降级同一个工程取舍），后续如有真实反馈再评估换成基于 `docx` 库的自定义生成器。
- **[Risk]** 用户反复触发导出但从不下载，产物在对象存储里累积 → **Mitigation**：固定保留时长的定时清理 job，参照视频孤儿资产清理的既有先例。
- **[Risk]** 超大文档（已有"超大文档拆分引导"300 块阈值）会让 PDF/Word 生成变慢、占用更多内存 → **Mitigation**：v1 不额外设导出侧的硬性大小限制，依赖已有的拆分引导间接缓解，先观察真实使用情况再决定是否需要专门的导出侧限制。

## Migration Plan

纯增量改动，不触碰任何已有数据/表结构：
1. 新增 `DocumentExport` Prisma 模型 + 迁移。
2. 新增 `apps/api` 的导出路由/handler/service/queue/job，新增 `document-exports` 存储前缀与定时清理 job。
3. 新增 `apps/web` 的导出入口 UI（`DocumentEditorPage` 头部）。
4. 回滚方式：移除新增路由与前端入口即可，不需要任何数据回填或既有表结构变更。

## Open Questions

- 是否需要给用户保留"最近导出记录"的查看入口（类似版本历史），还是完全即用即扔？v1 先按纯"生成-下载-定时清理"设计，不留历史列表，后续有需求再补。
- PDF 的页眉页脚/页码样式是否需要做成可配置？v1 先固定一套样式，视反馈决定是否开放配置。
