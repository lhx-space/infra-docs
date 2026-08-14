import type {Editor} from '@tiptap/core';
import {BubbleMenu} from '@tiptap/react/menus';

interface TableBubbleMenuProps {
  editor: Editor;
}

/**
 * 表格内悬浮工具栏：光标落在表格任意单元格内时出现，提供增删行/列、删除整张表格的入口
 * （见体验优化：插入表格之后还需要能调整行列数量，不能只支持插入时定好的初始 3×3）。
 * 跟 `FormattingBubbleMenu`/`ImageBubbleMenu` 是同一套 `BubbleMenu` 机制，但这里的
 * `shouldShow` 必须完全自定义、不能依赖默认逻辑——默认逻辑会因为"选区是空的（没有拖蓝
 * 选中文字）"而隐藏菜单，但停在表格单元格里敲字/删字/移动光标时选区几乎总是空的（一个
 * 普通的文字光标，不是文字选区也不是节点选区），必须绕开这条默认判断，只看"光标是否落在
 * 表格节点范围内"（`editor.isActive('table')`，只要祖先链上有 `table` 节点就为真，不管
 * 选区是否为空）。
 */
export function TableBubbleMenu({editor}: TableBubbleMenuProps) {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableBubbleMenu"
      className="doc-editor-bubble-menu doc-editor-table-bubble-menu"
      shouldShow={({editor: instance}) => instance.isEditable && instance.isActive('table')}
    >
      <div className="doc-editor-table-bubble-menu__group">
        <button
          type="button"
          onClick={() => editor.chain().focus().addRowBefore().run()}
          aria-label="在上方插入一行"
        >
          行·上
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().addRowAfter().run()}
          aria-label="在下方插入一行"
        >
          行·下
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().deleteRow().run()}
          aria-label="删除当前行"
        >
          删行
        </button>
      </div>

      <div className="doc-editor-table-bubble-menu__divider" />

      <div className="doc-editor-table-bubble-menu__group">
        <button
          type="button"
          onClick={() => editor.chain().focus().addColumnBefore().run()}
          aria-label="在左侧插入一列"
        >
          列·左
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().addColumnAfter().run()}
          aria-label="在右侧插入一列"
        >
          列·右
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().deleteColumn().run()}
          aria-label="删除当前列"
        >
          删列
        </button>
      </div>

      <div className="doc-editor-table-bubble-menu__divider" />

      <button
        type="button"
        className="doc-editor-table-bubble-menu__delete-table"
        onClick={() => editor.chain().focus().deleteTable().run()}
        aria-label="删除整张表格"
      >
        删表
      </button>
    </BubbleMenu>
  );
}
