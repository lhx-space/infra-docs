import {Extension} from '@tiptap/core';
import {TextSelection} from '@tiptap/pm/state';

/**
 * 代码块内的两个键盘行为补丁（见 document-editor spec.md「代码块的语言支持与交互」）：
 * 1. Enter 自动继承上一行的前导空白（对齐算法）；Tab/Shift-Tab 缩进直接用
 *    `CodeBlockLowlight` 自带的 `enableTabIndentation` 选项（见 utils/extensions.ts），
 *    这里不重复实现。
 * 2. Ctrl/Cmd+A 在代码块内先只选中这个代码块的内容，不像普通文本位置一样直接全选整篇
 *    文档——这是大多数代码编辑器/IDE 的标准行为，写代码时最常用的是"全选这一段代码"，
 *    不是"全选整篇文章"。
 *
 * `priority` 显式设成比默认值（100）高：`@tiptap/core` 内置的 `keymap` 扩展默认把 Enter
 * 绑定成 `newlineInCode`（只插入裸的 `\n`，没有缩进）、把 Mod-a 绑定成 `selectAll`，而且它
 * 是核心扩展、天然排在所有用户扩展前面，不设更高优先级的话我们的处理永远不会被触发。
 * 同时把官方 `CodeBlock` 扩展自带的"连续两个空行后再按一次 Enter 会跳出代码块"这个逃生
 * 手势原样搬过来一起处理，否则会因为我们优先级更高、把这份行为整体屏蔽掉。
 */
export const CodeBlockKeymap = Extension.create({
  name: 'codeBlockKeymap',
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const {editor} = this;
        if (!editor.isActive('codeBlock')) return false;

        const {state} = editor;
        const {$from, empty} = state.selection;
        if (!empty) return false;

        const isAtEnd = $from.parentOffset === $from.parent.nodeSize - 2;
        const endsWithDoubleNewline = $from.parent.textContent.endsWith('\n\n');
        if (isAtEnd && endsWithDoubleNewline) {
          return editor
            .chain()
            .command(({tr}) => {
              tr.delete($from.pos - 2, $from.pos);
              return true;
            })
            .exitCode()
            .run();
        }

        const textBeforeCursor = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n');
        const currentLine = textBeforeCursor.slice(textBeforeCursor.lastIndexOf('\n') + 1);
        const indent = currentLine.match(/^[ \t]*/)?.[0] ?? '';
        return editor.commands.insertContent(`\n${indent}`);
      },

      'Mod-a': () => {
        const {editor} = this;
        if (!editor.isActive('codeBlock')) return false;

        const {state, view} = editor;
        const {$from} = state.selection;
        const start = $from.start();
        const end = $from.end();
        // 已经选中了整个代码块内容时不拦截，交回默认行为——第二次按 Ctrl/Cmd+A
        // 还是能全选整篇文档，跟大多数编辑器"逐层扩大选区"的直觉一致
        const {selection} = state;
        if (selection.from === start && selection.to === end) return false;

        view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, start, end)));
        return true;
      }
    };
  }
});
