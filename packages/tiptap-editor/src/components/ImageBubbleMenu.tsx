import type {Editor} from '@tiptap/core';
import {BubbleMenu} from '@tiptap/react/menus';

interface ImageBubbleMenuProps {
  editor: Editor;
}

type ImageAlign = 'left' | 'center' | 'right';

function AlignLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M3 5h18v2H3V5zm0 6h12v2H3v-2zm0 6h18v2H3v-2z" />
    </svg>
  );
}
function AlignCenterIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M3 5h18v2H3V5zm4 6h10v2H7v-2zM3 17h18v2H3v-2z" />
    </svg>
  );
}
function AlignRightIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M3 5h18v2H3V5zm6 6h12v2H9v-2zM3 17h18v2H3v-2z" />
    </svg>
  );
}

/**
 * 图片选中态悬浮工具栏：控制这张图在文档里的水平对齐位置（贴左/居中/贴右，见体验优化：
 * 拖拽调整大小之外，用户还想控制图片在版面里的显示位置）。跟文字悬浮工具栏
 * （`FormattingBubbleMenu`）是同一套 `BubbleMenu` 机制，只是 `shouldShow` 换成了
 * "当前选中的是不是一张图片节点"——`BubbleMenu` 默认的 `shouldShow` 只排除空选区，
 * 点击图片产生的 `NodeSelection` 本身不是空选区，天然会触发展示，这里再加一层
 * `isActive('image')` 判断，避免选中其他节点（比如 Mermaid 图表）时也弹出来。
 *
 * 定位完全交给 tiptap 内置行为：`@tiptap/extension-bubble-menu` 在检测到当前是
 * `NodeSelection` 时，会直接拿被选中节点的 NodeView 渲染出的 DOM 包围盒作为浮层锚点
 * （见其源码里 `view.nodeDOM(selection.from)` 那一段），不需要我们自己算坐标——这也是
 * 为什么 `utils/extensions.ts` 里选择用 `@tiptap/extension-image` 内置的 `resize`
 * 能力而不是自己重写一个 NodeView：即使那个内置 NodeView 是纯 DOM 实现、不是 React
 * 组件，这里的浮层定位依然能拿到正确的包围盒，两边完全不冲突。
 */
export function ImageBubbleMenu({editor}: ImageBubbleMenuProps) {
  const align = (editor.getAttributes('image')['align'] as ImageAlign | undefined) ?? 'left';

  function setAlign(next: ImageAlign): void {
    editor.chain().focus().updateAttributes('image', {align: next}).run();
  }

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="imageBubbleMenu"
      className="doc-editor-bubble-menu doc-editor-image-bubble-menu"
      shouldShow={({editor: instance}) => instance.isEditable && instance.isActive('image')}
    >
      <button
        type="button"
        data-active={align === 'left'}
        onClick={() => setAlign('left')}
        aria-label="贴左显示"
      >
        <AlignLeftIcon />
      </button>
      <button
        type="button"
        data-active={align === 'center'}
        onClick={() => setAlign('center')}
        aria-label="居中显示"
      >
        <AlignCenterIcon />
      </button>
      <button
        type="button"
        data-active={align === 'right'}
        onClick={() => setAlign('right')}
        aria-label="贴右显示"
      >
        <AlignRightIcon />
      </button>
    </BubbleMenu>
  );
}
