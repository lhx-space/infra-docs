## 1. 准备

- [x] 1.1 创建 `utils/shared/`、`utils/video/`、`utils/image/`、`utils/link-preview/`、`utils/code-block/`、`utils/mermaid/` 六个子目录
- [x] 1.2 全仓库搜索一次 `from '../utils/` / `from './utils/` / `from '../../utils/`，列出本次会受影响的全部消费方文件清单（`components/*.tsx`、`utils/extensions.ts`、`utils/slash-command.ts`、`src/index.ts`、`src/schema.ts`），作为后续每组核对的依据

## 2. 移动 `utils/shared/`（无跨组依赖，先挪）

- [x] 2.1 移动 `pending-upload-registry.ts` 到 `utils/shared/pending-upload-registry.ts`
- [x] 2.2 更新引用该文件的位置（`video-uploader-registry.ts`、`image-uploader-registry.ts`、`upload-image-plugin.ts`、`slash-command.ts`、`components/DocumentEditor.tsx`）的 import 路径
- [x] 2.3 跑 `tsc --noEmit` 确认这一组没有遗漏引用

## 3. 移动 `utils/mermaid/`

- [x] 3.1 移动 `mermaid-node.ts` 到 `utils/mermaid/mermaid-node.ts`
- [x] 3.2 更新引用该文件的位置（`utils/extensions.ts`、`utils/slash-command.ts` 里 `insertMermaid` 相关引用、`components/` 下渲染 Mermaid 节点的组件）的 import 路径
- [x] 3.3 跑 `tsc --noEmit` 确认这一组没有遗漏引用

## 4. 移动 `utils/code-block/`

- [x] 4.1 移动 `code-block-keymap.ts`、`lowlight.ts` 到 `utils/code-block/`
- [x] 4.2 更新引用这两个文件的位置（`utils/extensions.ts`、`components/DocumentEditor.tsx` 的 `CodeBlockKeymap` 引用）的 import 路径
- [x] 4.3 跑 `tsc --noEmit` 确认这一组没有遗漏引用

## 5. 移动 `utils/link-preview/`

- [x] 5.1 移动 `link-preview-registry.ts`、`link-preview-extension.ts`、`link-preview-node.ts` 到 `utils/link-preview/`
- [x] 5.2 更新这三个文件之间的相互引用路径，以及外部消费方（`utils/extensions.ts`、`components/DocumentEditor.tsx`、`src/index.ts` 导出的 `LinkPreviewResult` 类型）的 import 路径
- [x] 5.3 跑 `tsc --noEmit` 确认这一组没有遗漏引用

## 6. 移动 `utils/image/`

- [x] 6.1 移动 `image-upload-error-registry.ts`、`image-uploader-registry.ts`、`upload-image-plugin.ts` 到 `utils/image/`
- [x] 6.2 更新这三个文件之间的相互引用路径（`upload-image-plugin.ts` 依赖 `image-uploader-registry.ts`），以及外部消费方（`utils/slash-command.ts`、`components/DocumentEditor.tsx`）的 import 路径
- [x] 6.3 跑 `tsc --noEmit` 确认这一组没有遗漏引用

## 7. 移动 `utils/video/`

- [x] 7.1 移动 `video-node.ts`、`video-status-registry.ts`、`video-upload-error-registry.ts`、`video-paste-extension.ts`、`video-uploader-registry.ts` 到 `utils/video/`
- [x] 7.2 更新这五个文件之间的相互引用路径，以及外部消费方（`utils/extensions.ts`、`utils/slash-command.ts`、`components/DocumentEditor.tsx`、`components/VideoView.tsx`、`src/index.ts` 导出的 `VideoStatusResult`/`VideoUploadResult` 类型）的 import 路径
- [x] 7.3 跑 `tsc --noEmit` 确认这一组没有遗漏引用

## 8. `utils/` 整体验证

- [x] 8.1 全仓库 `grep` 一次，确认没有任何文件残留指向旧路径（如 `./video-node`、`../utils/image-uploader-registry` 等未加子目录前缀的写法）
- [x] 8.2 跑一次完整 `tsc --noEmit`（覆盖整个 `packages/tiptap-editor`）
- [x] 8.3 跑 `tsup` 构建，确认产物正常生成、无报错
- [x] 8.4 跑 `biome check`，确认没有新增 lint 问题

## 9. 拆分 `styles/index.css`

- [x] 9.1 拆分前先全文搜索共享的 `@keyframes`/自定义 CSS 属性（如 `doc-editor-spin`），确认哪些规则需要保留在入口文件而不是被误分类进某个领域文件
- [x] 9.2 提取 `.doc-editor-mermaid*` 相关规则到 `styles/mermaid.css`
- [x] 9.3 提取 `.doc-editor-code-block*` 相关规则到 `styles/code-block.css`
- [x] 9.4 提取 `.doc-editor-link-card*` 相关规则到 `styles/link-preview.css`
- [x] 9.5 提取 `.doc-editor-image*` 相关规则到 `styles/image.css`（含嵌套选择器 `.doc-editor-image-preview .doc-editor-mermaid-preview`，归属 image.css，见 design.md 决策 2 的说明）
- [x] 9.6 提取 `.doc-editor-video*` 相关规则到 `styles/video.css`
- [x] 9.7 入口 `styles/index.css` 顶部加 `@import` 引入上述 5 个领域文件，保留编辑器核心布局/工具栏/保存状态/离线提示/标题/大纲导航/气泡菜单/斜杠菜单等编辑器整体样式
- [x] 9.8 跑 `stylelint --fix` 确认新增/拆分出的 CSS 文件格式符合项目规范

## 10. 验证

- [x] 10.1 对比拆分前后的最终构建产物（`dist/` 下的样式文件，如走打包合并输出）内容差异，确认选择器与规则完全一致，只是来源文件位置变化，没有丢失或重复任何规则（CSS 通过 `package.json` exports 直接指向源文件、不经过 tsup 打包，改用拆分前后源文件的顶层选择器集合逐一比对，136 条选择器完全一致）
- [x] 10.2 真实浏览器验证：打开一篇包含图片、视频、Mermaid 图表、代码块、链接预览卡片的文档，确认全部展示与交互（图片懒加载/放大预览、视频自定义控制条、Mermaid 编辑态展示态切换、代码块折叠复制、链接卡片展示）跟改动前完全一致
- [x] 10.3 确认 `apps/web`、`apps/api` 两个消费方（`apps/api` 通过 `schema.ts` 子路径引入）分别跑一次 typecheck，确认不受本次包内部路径调整影响
- [x] 10.4 清理验证过程中产生的临时文件，不留入正式代码
