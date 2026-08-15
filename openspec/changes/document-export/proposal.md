## Why

文档目前只能在编辑器内查看，用户没有任何办法把一篇 Wiki 文档带出这套系统——发给不用本产品的人、留一份离线归档、或者导入别的写作/办公工具，都做不到。这是文档能力上一个明显的缺口：内容已经结构化存储（ProseMirror JSON），具备转换成通用格式的基础，只是从未提供导出入口。

## What Changes

- 新增文档导出能力：在文档编辑视图提供导出入口，支持导出为三种格式：
  - **Markdown（`.md`）**：结构化内容 SHALL 转换为标准 Markdown 文本，转换失败或遇到编辑器暂不支持导出的节点类型时按纯文本降级，不阻断整篇导出。
  - **Word（`.docx`）**：转换为可在主流 Office/WPS 打开的 `.docx` 文件，保留标题层级、列表、表格、图片、代码块等基础排版。
  - **PDF**：转换为分页 PDF，视觉呈现与编辑器只读渲染基本一致（含图片、表格、代码块高亮），Mermaid 图表 SHALL 以渲染后的图片形式嵌入（PDF 不支持交互式图表）。
- 导出内容的数据源为文档当前的物化只读内容（`GET` 文档接口已经在用的同一份 ProseMirror JSON），不是直接读 Yjs 二进制状态——跟现有"REST 读取用物化视图"的既有约定保持一致，不新增第二条内容读取路径。
- Markdown/Word 导出 SHALL 同步返回文件；PDF 导出（依赖无头浏览器渲染，耗时明显更长）复用现有视频转码那一套"提交任务 + 轮询状态"的异步任务模式，不阻塞请求线程。
- 导出权限跟随文档现有的读权限（`VIEWER` 及以上均可导出），不引入单独的导出权限位。
- 视频节点（转码中/失败状态）、未上传完成的图片占位等编辑器内部状态在导出内容中 SHALL 被跳过或替换为文字说明，不导出半成品占位符本身。

## Capabilities

### New Capabilities
- `document-export`: 文档导出为 Markdown/Word/PDF 三种格式的转换规则、触发方式、权限与失败处理。

### Modified Capabilities
（无——导出是全新的能力入口，不改变 `document-editor`/`wiki-document`/`document-versioning` 已有需求的行为）

## Impact

- `apps/api`：新增导出相关的路由/handler/service；新增 Markdown/DOCX/PDF 转换依赖（复用 `utils/document-schema.ts` 已有的 ProseMirror Schema，跟内容校验用同一份定义）；PDF 导出复用 `queue/`/`jobs/`/`worker.ts` 现有的 BullMQ 异步任务基础设施（跟视频转码同一套机制），产物存储复用 `services/storage.ts`（MinIO）。
- `apps/web`：`DocumentEditorPage` 头部新增"导出"入口（跟"版本历史"/"删除"同级），Markdown/Word 直接触发下载，PDF 展示"生成中"状态并轮询任务结果。
- `packages/tiptap-editor`：无需改动组件本身——导出发生在服务端，基于已持久化的内容 JSON，不依赖运行中的编辑器实例。
