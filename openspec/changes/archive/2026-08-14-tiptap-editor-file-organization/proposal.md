## Why

`packages/tiptap-editor/src/utils/` 目前 17 个文件全部平铺在同一层：视频（`video-node.ts`/`video-status-registry.ts`/`video-upload-error-registry.ts`/`video-paste-extension.ts`/`video-uploader-registry.ts`）、图片（`image-upload-error-registry.ts`/`image-uploader-registry.ts`/`upload-image-plugin.ts`）、链接预览（`link-preview-registry.ts`/`link-preview-extension.ts`/`link-preview-node.ts`）、代码块（`code-block-keymap.ts`/`lowlight.ts`）、Mermaid（`mermaid-node.ts`）这五个领域的文件全部混在一起，只能靠文件名前缀区分归属，找一个领域的全部文件、或者新增一个领域时该放哪个位置，都没有目录结构提示。`src/styles/index.css` 是同一类问题在样式层的体现：单文件 1148 行，视频播放器控制条、图片预览、Mermaid 编辑态/展示态、代码块折叠、链接卡片、大纲导航、气泡菜单、斜杠菜单等互不相关的样式区块顺序堆叠在一起，改一块样式要在一个大文件里定位对应区块。

这是纯粹的代码组织问题：功能本身没有任何缺陷，只是文件布局没有随着视频/链接预览/Mermaid 等能力的陆续增加而分层，现在文件数量已经到了平铺结构明显不好维护的规模，值得趁早理顺，避免后续每加一个领域（比如未来可能的表格块）都继续堆在同一层。

## What Changes

- 将 `utils/` 按领域拆分为子目录：`utils/video/`、`utils/image/`、`utils/link-preview/`、`utils/code-block/`、`utils/mermaid/`，每个子目录内部保留各自原有文件（只搬动位置，文件内容不改逻辑）。
- 真正跨领域共享的文件（`pending-upload-registry.ts`，同时被图片和视频的上传注册表使用）归入一个新的 `utils/shared/` 子目录，明确标注"不属于任何单一领域"。
- 编辑器级别的聚合文件（`extensions.ts` 汇总全部节点扩展、`slash-command.ts` 汇总全部斜杠命令候选项，两者都横跨图片/视频/Mermaid/代码块多个领域）保留在 `utils/` 根目录，不下沉到任何子目录，因为它们的职责就是"聚合各领域"，下沉反而会造成循环引用的错觉。
- 同步更新所有引用了这些文件的 `import` 路径（`components/` 下的消费方、`utils/` 内部相互引用、`schema.ts`/`index.ts` 的导出路径），路径调整后功能行为完全不变。
- 将 `src/styles/index.css` 按领域拆分为多个文件：`styles/video.css`、`styles/image.css`、`styles/mermaid.css`、`styles/code-block.css`、`styles/link-preview.css`，以及编辑器核心布局/工具栏/保存状态/大纲导航/气泡菜单/斜杠菜单等横跨多领域或编辑器整体样式保留在 `styles/index.css`（作为入口文件，通过 `@import` 引入上述各领域文件）；不改变任何已生成的 CSS 选择器名称与样式规则，纯文件拆分。

**本次不改变任何运行时行为**——不涉及新增/修改任何用户可见的功能、API 或交互，只是文件位置调整。唯一值得沉淀进 spec 的是"内部文件按内容类型领域分层"这条架构惯例本身，作为防止未来又退回平铺结构的长期约束记录下来，不涉及任何用户可感知的行为场景变化。

## Capabilities

### New Capabilities

（无——纯内部代码组织调整，不引入新能力）

### Modified Capabilities

- `document-editor`：新增一条内部架构约束"编辑器包内部文件按内容类型领域分层组织"（`utils/` 子目录划分、`styles/` 按领域拆分），不改变该能力已有的任何用户可见需求与场景。

## Impact

- `packages/tiptap-editor/src/utils/`：17 个文件按领域移动到 5 个新增子目录 + 1 个共享子目录，`extensions.ts`/`slash-command.ts` 保留在根目录。
- `packages/tiptap-editor/src/styles/index.css`：拆分为 6 个文件（1 个入口 + 5 个领域文件）。
- `packages/tiptap-editor/src/components/*.tsx`、`src/index.ts`、`src/schema.ts`：更新受影响的 `import` 路径。
- `packages/tiptap-editor/tsconfig.json`：如有基于路径的特殊配置需要一并核对（本次预期不需要改动，纯路径搬动）。
- 不影响 `apps/web`、`apps/api` 对本包的消费方式（对外导出的公共 API 路径 `src/index.ts`/`src/schema.ts` 本身不移动，只是内部实现文件的引用路径变化）。
