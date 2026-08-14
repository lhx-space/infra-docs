# @luhanxin/tiptap-editor

> 一个开箱即用的块级富文本文档编辑器，基于 [Tiptap](https://tiptap.dev/) v3 + React，内置一等公民级别的实时协同编辑能力。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)

**[English](./README.md) | [简体中文](./README.zh-CN.md)**

## 特性

- **丰富的内容模型** —— 标题、段落、有序/无序/任务列表（支持嵌套）、引用、分割线，以及加粗/斜体/删除线/行内代码/链接等行内格式化（来自 `@tiptap/starter-kit`）。
- **语法高亮代码块** —— 内置支持 12 种语言（`@tiptap/extension-code-block-lowlight` + `lowlight`），支持 Tab 缩进。
- **图片** —— 支持粘贴/拖拽/上传（带占位态）、拖拽缩放、左中右对齐。
- **表格** —— 完整的表格/行/表头/单元格支持，列宽可拖拽调整（`@tiptap/extension-table`）。
- **Mermaid 图表** —— 自定义 NodeView，编辑态左右分栏（源码+实时预览），基于 `IntersectionObserver` 的视口感知懒渲染，展示态支持全屏缩放预览。
- **视频嵌入** —— 自定义 NodeView，覆盖 `processing`/`ready`/`failed` 转码状态，按需加载 `hls.js` 播放流媒体，封面优先点击播放，完全自定义的播放控制条。
- **链接预览卡片** —— 粘贴一个 URL，通过消费方提供的抓取函数生成富预览卡片（标题/描述/图片/favicon）。
- **斜杠命令** —— `/` 触发的快捷插入菜单。
- **文档大纲** —— 基于标题层级的目录导航，点击跳转，可独立导出用于自定义布局。
- **实时协同编辑** —— 传入一个 `Y.Doc` 和一个暴露 `awareness` 接口的 provider（如 `y-websocket` 的 `WebsocketProvider`），编辑器自动切换为 CRDT 驱动的同步模式，渲染协作者光标与在线用户列表。

## 安装

```bash
npm install @luhanxin/tiptap-editor
# 或
pnpm add @luhanxin/tiptap-editor
```

`react`、`react-dom`（≥18）是 peer dependency —— 自带对应版本即可，本包不打包这两者。

别忘了引入样式表：

```ts
import '@luhanxin/tiptap-editor/styles.css';
```

## 快速开始

### 非协同模式

```tsx
import {DocumentEditor} from '@luhanxin/tiptap-editor';
import '@luhanxin/tiptap-editor/styles.css';

function MyDocumentPage() {
  return (
    <DocumentEditor
      editable
      content={initialProseMirrorJson}
      uploadImage={file => uploadToMyBackend(file)}
      onSave={json => saveToMyBackend(json)}
    />
  );
}
```

只有 `editable` 和 `uploadImage` 是必填 props。其余（视频上传、链接预览抓取、自动保存间隔、全屏等）都是可选注入点，不提供对应功能会静默降级，不影响核心编辑体验。

### 实时协同模式

```tsx
import {DocumentEditor, Y_XML_FRAGMENT_FIELD} from '@luhanxin/tiptap-editor';
import * as Y from 'yjs';
import {WebsocketProvider} from 'y-websocket';

const ydoc = new Y.Doc();
const provider = new WebsocketProvider('wss://your-collab-server', roomName, ydoc);

function CollaborativeDocumentPage() {
  return (
    <DocumentEditor
      editable
      uploadImage={file => uploadToMyBackend(file)}
      collaboration={{
        document: ydoc,
        provider,
        user: {name: currentUser.name, color: currentUser.color}
      }}
      collaborationStatus={status} // 'connecting' | 'synced' | 'disconnected'
      onReconnect={() => provider.connect()}
    />
  );
}
```

传入 `collaboration` 后，标题与正文的真源都会切换成共享的 `Y.Doc`（正文对应的字段名导出为 `Y_XML_FRAGMENT_FIELD`）。这个模式下 `content`/`onSave`/`autosaveDelay` 都会被忽略——CRDT 本身就是持久化层，`Y.Doc` 状态怎么持久化完全由你（和你的后端）负责。组件本身**从不创建或销毁** `Y.Doc`/provider，生命周期完全由调用方管理。

## 在服务端校验内容（`./schema` 子路径）

编辑器的 Schema 同时以一个不依赖任何浏览器 API 的 Node.js 安全子路径导出——可以用它去校验前端传上来的 ProseMirror JSON 是不是符合编辑器实际产出的同一份 Schema，避免"前端能输入、后端拒绝保存"这种不一致：

```ts
import {documentEditorExtensions} from '@luhanxin/tiptap-editor/schema';
import {getSchema} from '@tiptap/core';

const schema = getSchema(documentEditorExtensions);
// 在服务端配合 @tiptap/core / prosemirror-model 用这份 schema 校验/解析文档内容
```

## API 参考

| 导出 | 说明 |
| --- | --- |
| `DocumentEditor` | 主编辑器组件，props 见上文「快速开始」。 |
| `DocumentOutline` | 可独立使用的基于标题层级的目录导航组件。 |
| `documentEditorExtensions` | 完整的 Tiptap 扩展列表（仅 Schema 级，不含 NodeView）——同样可通过 `./schema` 不依赖浏览器 API 引入。 |
| `Y_XML_FRAGMENT_FIELD` | 文档正文在 `Y.Doc` 中对应共享 `XmlFragment` 的字段名。 |
| 类型 | `DocumentEditorProps`、`SaveStatus`、`CollaborationConfig`、`CollaborationProvider`、`CollaborationStatus`、`CollaborationUser`、`CollaboratorInfo`、`HistoricalEditorInfo`、`LinkPreviewResult`、`VideoStatusResult`、`VideoUploadResult` |

### 子路径

| 子路径 | 用途 |
| --- | --- |
| `@luhanxin/tiptap-editor` | 完整的 React 组件 + 协同类型（浏览器端使用）。 |
| `@luhanxin/tiptap-editor/schema` | 仅 Schema，不依赖 React/DOM —— 可安全用于 Node.js 服务端校验。 |
| `@luhanxin/tiptap-editor/styles.css` | 必需的样式表（不会自动注入 —— `sideEffects: false`）。 |

## 文档

源码、Issue 以及整个 monorepo 都在 <https://github.com/lhx-space/infra-docs/tree/main/packages/tiptap-editor>。

## License

MIT © luhanxin
