## Context

`packages/tiptap-editor` 是被 `apps/web`（`DocumentEditor` 组件）和 `apps/api`（`schema.ts` 子路径，用于服务端内容校验）共同消费的独立包。经过 `image-upload-dedup`/`video-hls-embed`/`video-dedup-and-lifecycle`/`upload-reliability-hardening` 几轮迭代，`src/utils/` 已经积累到 17 个文件、`src/styles/index.css` 已经积累到 1148 行，两者都还是最初"平铺一个目录/一个文件"的结构，没有跟着内容类型（图片/视频/Mermaid/链接预览/代码块）的增加同步分层。

当前 `utils/` 内文件按前缀已经能明显看出归属（`video-*`/`image-*`/`link-preview-*`/`code-block-*`/`mermaid-*`），但没有对应的目录结构；`index.css` 内的选择器同样能按 `.doc-editor-video*`/`.doc-editor-image*`/`.doc-editor-mermaid*`/`.doc-editor-code-block*`/`.doc-editor-link-card*` 前缀清晰划分区块（各区块边界见下方决策 2 的具体行号），只是物理上堆在同一个文件里。

本次是纯内部代码组织重构，不改变任何运行时行为、不改变任何对外公开的 API（`src/index.ts`/`src/schema.ts` 的导出内容和路径本身不变），只调整包内部的文件/目录布局。

## Goals / Non-Goals

**Goals:**
- 把 `utils/` 里能明确归属到单一内容类型领域的文件，按领域拆分到对应子目录，查找/新增某个领域的文件时有目录结构可依循。
- 把 `styles/index.css` 按同样的领域边界拆分成多个文件，单个文件体量回落到可以一屏内定位到目标区块的规模。
- 保持这次改动是纯粹的"挪位置"：文件内容逐字不变（只改文件内 `import` 相对路径），CSS 选择器名称与规则内容逐字不变，不夹带任何功能性修改。

**Non-Goals:**
- 不重命名文件本身（如把 `utils/video/video-node.ts` 简化成 `utils/video/node.ts`）——见决策 1，本次只挪目录，不做二次改名，降低这次 diff 的审查成本，改名留给后续如果需要再单独做。
- 不拆分 `outline`/`bubble-menu`/`slash-menu` 这三块编辑器整体 UI chrome 的样式——它们不从属于任何单一内容类型领域（大纲导航、气泡菜单、斜杠菜单都是横跨全部内容类型的编辑器级 UI），保留在入口 `index.css` 里，跟 `extensions.ts`/`slash-command.ts` 保留在 `utils/` 根目录是同一个道理（见决策 3）。
- 不改变 `tsup`/`tsconfig` 的构建配置本身——本次挪动后如果构建产物（`dist/`）内容不变，说明不需要动配置；只有验证时发现构建产物受影响才需要额外处理（预期不会，纯相对路径搬动）。
- 不涉及任何用户可见行为的需求/场景变更——`specs/` delta 只新增一条"内部文件按内容类型领域分层"的架构约束（见 proposal.md「Modified Capabilities」），不改动 `document-editor` 已有的任何用户可见需求与场景。

## Decisions

### 1. `utils/` 子目录只挪位置、不改文件名，保留原有前缀

把文件挪进对应子目录后，文件名里的领域前缀（如 `video/video-node.ts` 里的 `video-`）会显得冗余，理论上可以顺手改成 `video/node.ts`。**放弃这个顺手改名**，只做纯目录搬动：

- 改名等于同时改变"文件在磁盘上的路径"和"文件叫什么"两件事，混在一次 diff 里让 review 时不好区分"这行是真的挪了逻辑"还是"只是路径变了"；纯路径搬动的 diff，git 能正确识别成 rename，review 时一眼就能看出内容零变化。
- 用户明确说了这次只是想先看方案（"先不动代码，我 review 下即可"），保持这次改动足够小、足够容易验证"确实没有动逻辑"，比顺手多做一步优化更重要。
- 后续如果还想去掉冗余前缀，是一次独立的、影响面更小的重命名操作，不需要现在就决定。

最终 `utils/` 目录结构：

```
utils/
  extensions.ts              # 保留在根目录（见决策 3）
  slash-command.ts           # 保留在根目录（见决策 3）
  shared/
    pending-upload-registry.ts
  video/
    video-node.ts
    video-status-registry.ts
    video-upload-error-registry.ts
    video-paste-extension.ts
    video-uploader-registry.ts
  image/
    image-upload-error-registry.ts
    image-uploader-registry.ts
    upload-image-plugin.ts
  link-preview/
    link-preview-registry.ts
    link-preview-extension.ts
    link-preview-node.ts
  code-block/
    code-block-keymap.ts
    lowlight.ts
  mermaid/
    mermaid-node.ts
```

### 2. `styles/index.css` 按跟 `utils/` 完全对应的领域边界拆分

拆分边界直接对应现有选择器前缀的自然分界（当前文件里各区块的起止行号，拆分后各自成文件）：

| 目标文件 | 覆盖的选择器前缀 | 现有起止行 |
|---|---|---|
| `styles/index.css`（入口） | `.doc-editor`/`.doc-editor__*` 核心布局与工具栏、保存状态、离线提示、标题、大纲导航（`.doc-editor-outline*`）、气泡菜单（`.doc-editor-bubble-menu*`）、斜杠菜单（`.doc-editor-slash-menu*`） | 1–419（除下方各领域区块）、947–1055 |
| `styles/image.css` | `.doc-editor-image*` | 419–508 |
| `styles/code-block.css` | `.doc-editor-code-block*` | 508–604 |
| `styles/mermaid.css` | `.doc-editor-mermaid*` | 604–703 |
| `styles/video.css` | `.doc-editor-video*` | 703–947 |
| `styles/link-preview.css` | `.doc-editor-link-card*` | 1055–1148 |

入口 `index.css` 顶部用 `@import './video.css'; @import './image.css'; ...` 引入各领域文件（CSS `@import` 在构建时会被 Vite/PostCSS 内联，不产生额外的运行时网络请求，消费方 `import '@luhanxin/tiptap-editor/styles'` 的引入方式不变）。

**一处需要注意的跨领域嵌套选择器**：`.doc-editor-image-preview .doc-editor-mermaid-preview`（现第 454 行附近）是"图片/Mermaid 通用的放大预览组件"内部对 Mermaid 内容的样式覆盖，父选择器是 `.doc-editor-image-preview`，因此归入 `image.css` 而不是 `mermaid.css`——按"选择器的直接归属"而不是"选择器名字里出现了哪个领域词"来判断归属，避免把一条规则拆得比它实际的组件边界还细。

**为什么 `outline`/`bubble-menu`/`slash-menu` 不单独拆**（保留在入口文件）：这三块都是"编辑器整体"级别的 UI（大纲导航展示全文档结构、气泡菜单是选中任意文字都会出现的格式化工具条、斜杠菜单列出全部领域的插入候选项），不从属于图片/视频/Mermaid/代码块/链接预览中的任何一个，硬拆出去反而找不到该放哪个"领域文件"。这跟决策 3 里 `extensions.ts`/`slash-command.ts` 不下沉到任何子目录是同一个判断标准。

### 3. `extensions.ts`/`slash-command.ts` 保留在 `utils/` 根目录，不下沉到任何领域子目录

这两个文件的职责就是"聚合各领域"：`extensions.ts` 汇总全部节点扩展（`Image`/`VideoBlock`/`MermaidBlock`/`LinkPreviewCard`/`CodeBlockLowlight` 等）构建统一的 Schema；`slash-command.ts` 汇总全部斜杠命令候选项（标题/列表/代码块/Mermaid/图片/视频），并直接依赖 `image-uploader-registry`/`video-uploader-registry` 等多个领域的文件。

如果把它们下沉到任何一个子目录（比如放进 `video/` 只因为它 import 了 video 相关文件），会造成"聚合器反而属于被聚合对象之一"的误导性依赖方向；保留在 `utils/` 根目录，明确表达"这两个文件站在比所有领域子目录更高的层级，依赖它们、不属于它们"。

## Risks / Trade-offs

- **[风险] 批量移动文件 + 改 import 路径，人工操作容易漏改某处引用，导致构建报错或运行时 `Cannot find module`** → 缓解：`tasks.md` 会要求每移动完一组文件立刻跑一次 `tsc --noEmit` + `tsup` 构建，不是移完全部 17 个文件才统一检查；同时最后做一次全仓库 `grep` 确认没有残留指向旧路径的 import。
- **[风险] `styles/index.css` 里可能存在跨区块共用的 CSS 变量/动画名（如 `doc-editor-spin` 关键帧），拆分后如果被两个领域文件同时引用，容易被误判为"该属于某一个领域文件"而放错位置或被重复定义** → 缓解：拆分前先全文搜索一遍共享的 `@keyframes`/自定义属性，确认放在入口 `index.css`（编辑器级别共享资源），各领域文件只放它们私有的规则，不重新定义共享部分。
- **[Trade-off] 保留原文件名（不去冗余前缀）短期内看起来还是有点"目录名+文件名重复"（`video/video-node.ts`）** → 权衡可接受：见决策 1，用一次改动只做一件事换取更容易审查的 diff，去冗余前缀可以是完全独立、随时可做的下一步。

## Migration Plan

1. 先建好 `utils/shared/`、`utils/video/`、`utils/image/`、`utils/link-preview/`、`utils/code-block/`、`utils/mermaid/` 六个子目录。
2. 按领域逐组移动文件（每组文件互相之间的引用最密集，一起挪一起验证，减少中间态报错）：先 `shared/`（只有一个文件，且被两个领域依赖，最先挪完不会被后续步骤反复影响）→ `mermaid/`（无跨领域依赖，最简单）→ `code-block/` → `link-preview/` → `image/` → `video/`。
3. 每组移动后，更新该组文件内部相互引用的相对路径，以及所有外部消费方（`components/*.tsx`、`utils/extensions.ts`、`utils/slash-command.ts`、`src/index.ts`、`src/schema.ts`）指向该组文件的 import 路径，立刻跑 `tsc --noEmit` 确认这一组没有遗漏。
4. 全部文件移动完成后，跑一次完整的 `tsc --noEmit` + `tsup` 构建 + 现有的 lint（`biome check`）确认零报错。
5. 按同样的"先拆分、再在入口文件里加 `@import`"顺序处理 `styles/index.css`：依次拆出 `mermaid.css`/`code-block.css`/`link-preview.css`/`image.css`/`video.css`，入口 `index.css` 只保留编辑器整体样式 + 顶部 `@import` 语句。
6. 构建后对比拆分前后的 CSS 产物（`dist/` 里的样式文件，若走的是打包合并输出）差异，确认选择器与规则内容完全一致，只是来源文件不同（无实际样式变化）。
7. 不需要数据库迁移、不需要处理任何历史数据——纯前端包内部文件重构，没有需要回滚的运行时状态。

## Open Questions

- 是否需要在这次顺手把 `outline`/`bubble-menu`/`slash-menu` 也各自拆成独立文件（哪怕不按"内容类型领域"分类，按"编辑器 UI 组件"分类）？当前设计保留在入口文件，如果后续这部分也长到需要拆分的规模，可以是另一次独立的小改动。
