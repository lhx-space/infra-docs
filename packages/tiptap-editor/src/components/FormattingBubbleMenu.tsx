import type {Editor} from '@tiptap/core';
import {BubbleMenu} from '@tiptap/react/menus';
import {useState} from 'react';

interface FormattingBubbleMenuProps {
  editor: Editor;
}

/**
 * 选中文字悬浮工具栏：加粗/斜体/删除线/行内代码/链接（见 document-editor spec.md「选中文字
 * 悬浮工具栏」）。`shouldShow` 交给 `BubbleMenu` 默认行为（有非空文字选区才展示），取消选中
 * 后自动隐藏，不需要额外状态管理。
 */
export function FormattingBubbleMenu({editor}: FormattingBubbleMenuProps) {
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');

  function toggleLink(): void {
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    setLinkValue('');
    setLinkInputOpen(true);
  }

  function confirmLink(): void {
    const url = linkValue.trim();
    if (url) editor.chain().focus().setLink({href: url}).run();
    setLinkInputOpen(false);
  }

  return (
    <BubbleMenu editor={editor} className="doc-editor-bubble-menu">
      {linkInputOpen ? (
        <div className="doc-editor-bubble-menu__link-input">
          <input
            // biome-ignore lint/a11y/noAutofocus: 点击"链接"按钮后就是为了立刻输入 URL，这个输入框是刚渲染出来的唯一交互目标，不抢占已有焦点
            autoFocus
            value={linkValue}
            placeholder="https://..."
            onChange={e => setLinkValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') confirmLink();
              if (e.key === 'Escape') setLinkInputOpen(false);
            }}
          />
          <button type="button" onClick={confirmLink}>
            确定
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            data-active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
            aria-label="加粗"
          >
            B
          </button>
          <button
            type="button"
            data-active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            aria-label="斜体"
          >
            I
          </button>
          <button
            type="button"
            data-active={editor.isActive('strike')}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            aria-label="删除线"
          >
            S
          </button>
          <button
            type="button"
            data-active={editor.isActive('code')}
            onClick={() => editor.chain().focus().toggleCode().run()}
            aria-label="行内代码"
          >
            {'</>'}
          </button>
          <button
            type="button"
            data-active={editor.isActive('link')}
            onClick={toggleLink}
            aria-label="链接"
          >
            链接
          </button>
        </>
      )}
    </BubbleMenu>
  );
}
