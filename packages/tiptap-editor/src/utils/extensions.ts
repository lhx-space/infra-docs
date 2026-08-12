import type {AnyExtension} from '@tiptap/core';
import {CodeBlockLowlight} from '@tiptap/extension-code-block-lowlight';
import {Image} from '@tiptap/extension-image';
import {Placeholder} from '@tiptap/extension-placeholder';
import {TaskItem} from '@tiptap/extension-task-item';
import {TaskList} from '@tiptap/extension-task-list';
import {StarterKit} from '@tiptap/starter-kit';
import {LinkPreviewCard} from './link-preview-node';
import {documentLowlight} from './lowlight';
import {MermaidBlock} from './mermaid-node';

/**
 * 文档编辑器支持的块类型范围（见 document-editor spec.md「编辑器支持的块类型范围」）：
 * 标题（多级）/段落/有序无序列表/任务列表/引用/代码块（12 种语言语法高亮）/分割线/图片/
 * 链接/Mermaid 图表块，以及加粗/斜体/删除线/行内代码等行内格式化（`StarterKit` 自带）。
 *
 * 这个数组是"纯扩展配置"，刻意不包含任何 `addNodeView`（React 组件）——它同时被两处消费：
 * 1. `apps/api`（通过 `@lhx-kit/tiptap-editor/schema` 子路径引入）用 `@tiptap/core` 的
 *    `getSchema()` 构建服务端内容校验用的 ProseMirror `Schema`；
 * 2. 本包主入口 `src/index.ts`（`DocumentEditor` 组件内部）在此基础上用 `.extend({addNodeView})`
 *    追加交互式渲染（代码块的复制/折叠、Mermaid 的编辑态/展示态切换）。
 *
 * 两处永远是同一份 Schema 定义来源，不会出现"编辑器能输入的内容，后端却拒绝保存"的不一致
 * （见 design.md 决策 3、wiki-document spec.md「保存内容前进行结构校验」）。这也是为什么
 * `Schema` 本身不能依赖 React：一旦这个模块的导入链路里出现 `@tiptap/react`/`mermaid` 等
 * 只在浏览器里安全的包，`apps/api`（Node.js 环境）在模块加载时就会直接报错。
 */
export const documentEditorExtensions: AnyExtension[] = [
  StarterKit.configure({
    // 用 CodeBlockLowlight 替代默认代码块，拿到语法高亮能力（见 document-editor spec.md「代码块的语言支持与交互」）
    codeBlock: false,
    // StarterKit v3 已内置 Link（`@tiptap/extension-link`），不再单独引入同一个扩展，
    // 否则会出现"Duplicate extension names"——这里只是覆盖它的默认配置
    link: {openOnClick: false, autolink: false}
  }),
  CodeBlockLowlight.configure({
    lowlight: documentLowlight,
    // Tab/Shift-Tab 缩进用扩展自带的实现，不用自己重写（见 document-editor spec.md
    // 「代码块的语言支持与交互」——Enter 的自动对齐缩进是我们自己补的，见
    // components/DocumentEditor.tsx 里的 `CodeBlockEnterKeymap`）
    enableTabIndentation: true
  }),
  Image.configure({
    // 限宽在样式层用 CSS 控制（见 src/styles/index.css），这里只负责懒加载与统一的 class hook
    HTMLAttributes: {loading: 'lazy', class: 'doc-editor-image'}
  }),
  TaskList,
  TaskItem.configure({nested: true}),
  Placeholder.configure({placeholder: '输入内容，或输入 “/” 唤起插入菜单...'}),
  MermaidBlock,
  LinkPreviewCard
];
