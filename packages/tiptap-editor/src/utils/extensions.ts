import type {AnyExtension} from '@tiptap/core';
import {CodeBlockLowlight} from '@tiptap/extension-code-block-lowlight';
import {Image} from '@tiptap/extension-image';
import {Placeholder} from '@tiptap/extension-placeholder';
import {TableKit} from '@tiptap/extension-table';
import {TaskItem} from '@tiptap/extension-task-item';
import {TaskList} from '@tiptap/extension-task-list';
import {StarterKit} from '@tiptap/starter-kit';
import {documentLowlight} from './code-block/lowlight';
import {LinkPreviewCard} from './link-preview/link-preview-node';
import {MermaidBlock} from './mermaid/mermaid-node';
import {VideoBlock} from './video/video-node';

/**
 * 文档编辑器支持的块类型范围（见 document-editor spec.md「编辑器支持的块类型范围」）：
 * 标题（多级）/段落/有序无序列表/任务列表/引用/代码块（12 种语言语法高亮）/分割线/图片/
 * 表格/视频/链接/Mermaid 图表块，以及加粗/斜体/删除线/行内代码等行内格式化
 * （`StarterKit` 自带）。
 *
 * 这个数组是"纯扩展配置"，刻意不包含任何 `addNodeView`（React 组件）——它同时被两处消费：
 * 1. `apps/api`（通过 `@luhanxin/tiptap-editor/schema` 子路径引入）用 `@tiptap/core` 的
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
  // 图片默认铺满编辑器内容列宽（见体验优化：不是所有插图都适合全宽展示，用户希望能
  // 自己控制显示大小，以及贴左/居中/贴右的版面位置）。`width`/`height` 本来就是这个
  // Image 节点原有的两个属性，之前只是没有 UI 入口去改它们，不是新增字段，历史文档/
  // 后端内容校验的 Schema 天然兼容，不需要任何数据迁移；`align` 是本项目新加的属性
  // （见下面 `.extend()`），同理只影响展示位置，默认值 `left` 跟历史文档没有这个字段时
  // 的旧行为（贴左显示，不做任何居中/靠右处理）完全一致。
  Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        // 只落一个 `data-align` 属性到 <img> 上（渲染成 `style` 的话，会在
        // `@tiptap/extension-image` 内置 resize NodeView 每次属性变更时被整段替换掉，
        // 连带清掉拖拽产生的 `width`/`height` 内联样式——这是它内部 `onUpdate` diff
        // 逻辑的一个副作用坑，用独立的 `data-align` 属性可以完全绕开，不会互相打架）。
        // 具体的水平位置样式（贴左/居中/贴右）交给 src/styles/image.css 里对这个属性的
        // CSS 选择器处理，不在这里直接算 margin/style。
        align: {
          default: 'left',
          parseHTML: element => element.getAttribute('data-align') || 'left',
          renderHTML: attributes => {
            const align = attributes['align'] as string | null;
            if (!align || align === 'left') return {};
            return {'data-align': align};
          }
        }
      };
    }
  }).configure({
    // 限宽在样式层用 CSS 控制（见 src/styles/image.css），这里只负责懒加载与统一的 class hook
    HTMLAttributes: {loading: 'lazy', class: 'doc-editor-image'},
    // 用 `@tiptap/extension-image` 内置的 `resize` 能力做拖拽缩放，不用自己写 NodeView——
    // 只在浏览器里生效（`ResizableNodeView` 内部有 `typeof document === 'undefined'`
    // 判断），`apps/api` 引入这份配置构建 Schema 做内容校验时不受影响。四个角的手柄默认
    // 锁死长宽比——图片缩放场景下"整体等比缩小/放大"是最符合直觉的交互（跟 Notion/飞书
    // 一致），不提供上下左右边中点手柄，避免单方向拉伸把图片拉变形。只读模式下
    // （`editor.isEditable === false`）手柄会被自动移除，见其内部 `handleEditorUpdate`。
    resize: {
      enabled: true,
      directions: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
      minWidth: 80,
      minHeight: 80,
      alwaysPreserveAspectRatio: true
    }
  }),
  // 表格（见体验优化：插入表格 + 增删行列，对应 slash-command.ts 的「表格」候选项和
  // components/TableBubbleMenu.tsx 光标落在表格内时的增删行列悬浮工具栏）。
  // `TableKit` 是 `@tiptap/extension-table` 提供的便捷组合（内部按 `table`/`tableRow`/
  // `tableHeader`/`tableCell` 四个 option 分别 `.configure()` 对应的四个节点扩展并
  // 一次性注册），不是我们自己拼的四个独立包——v3 已经把这四个节点合并到同一个 npm 包里，
  // 不需要像 v2 时代那样分别安装 `@tiptap/extension-table-row` 等四个包。
  // `resizable: true` 开启列宽拖拽（`prosemirror-tables` 内置的 `columnResizing`
  // 插件，纯 ProseMirror 插件 + 装饰实现，不依赖任何自定义 NodeView，构建 Schema 时
  // 不会有浏览器 API 访问，`apps/api` 引入这份配置做内容校验同样不受影响）。
  TableKit.configure({
    table: {
      resizable: true,
      HTMLAttributes: {class: 'doc-editor-table'}
    },
    tableCell: {HTMLAttributes: {class: 'doc-editor-table-cell'}},
    tableHeader: {HTMLAttributes: {class: 'doc-editor-table-header'}}
  }),
  TaskList,
  TaskItem.configure({nested: true}),
  Placeholder.configure({placeholder: '输入内容，或输入 “/” 唤起插入菜单...'}),
  MermaidBlock,
  LinkPreviewCard,
  VideoBlock
];
