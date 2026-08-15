import type {Editor} from '@tiptap/core';
import type {RefObject} from 'react';
import {useEffect, useState} from 'react';

export interface CaretLabelPosition {
  /** React key：光标元素在 DOM 里没有携带稳定的 clientId（`renderCaret` 只挂了
   * name/color 两个 data 属性），这里用"名字 + 出现顺序"拼一个即可——每次重新计算都是
   * 整份替换渲染，不依赖跨帧保留身份做过渡动画，不需要更强的稳定性。 */
  key: string;
  name: string;
  color: string;
  /** 相对于 `containerRef` 元素左上角的像素偏移，用于绝对定位（见下方函数注释） */
  top: number;
  left: number;
}

/**
 * 协作者光标用户名标签的位置计算（覆盖层方案）。
 *
 * 背景——这是在修一个真实的显示 bug：`renderCaret`（见
 * utils/collaboration/caret-render.ts）原来是把用户名标签直接渲染成光标 `<span>` 的
 * 子节点，用 `position: absolute; top: -1.4em` 让标签悬浮在当前行上方。这在
 * system-performance-hardening 给 `.ProseMirror > *` 加上 `content-visibility: auto`
 * （见 styles/index.css 顶部注释，长文档滚动性能优化）之后出现了问题：
 * `content-visibility: auto` 会无条件（不管当前是否被跳过渲染）对元素施加绘制局限
 * （paint containment），效果等同于给这个块级节点强制加了 `overflow: clip`——任何
 * 超出该节点自身边界盒的子元素内容都会被裁掉。用户名标签往上偏移的那部分，只要协作者的
 * 光标恰好停在某个块（段落/标题/列表项等）的第一行——这是最常见的情况，因为大多数段落
 * 只有一行——偏移出去的部分就正好落在这个块自己的边界盒外面，被裁掉一部分甚至整个看不全，
 * 这正是用户反馈的"光标用户 UI 显示不完整"。
 *
 * `content-visibility: auto` 的绘制局限是无条件生效的：没办法只对某一个子元素单独关闭，
 * 也没办法靠 `overflow: visible` 覆盖掉（这是 CSS Containment 规范明确写的行为，不是
 * 某个浏览器的实现 bug），所以修复思路不是调整偏移量，而是把用户名标签整体挪出这层局限的
 * 作用范围：不再让标签是光标 `<span>`（继而是某个 ProseMirror 顶层块节点）的 DOM 子节点，
 * 改成渲染在一个独立的覆盖层里——这个覆盖层是 `.doc-editor__canvas` 的直接子元素（跟
 * `.ProseMirror` 是兄弟关系，不在任何应用了 `content-visibility` 的元素内部，天然不会被
 * 裁剪）。
 *
 * 每次编辑器状态变化都需要重新计算位置：本地编辑/选区变化会触发；远程协作者光标广播也会
 * 触发——`@tiptap/y-tiptap` 的 `yCursorPlugin` 在 awareness 更新时会 `view.dispatch` 一个
 * 带 `awarenessUpdated` meta 的 transaction 来刷新光标 decoration（不是绕开 ProseMirror
 * 状态机直接操作 DOM），所以只监听 `editor.on('transaction')` 就能同时覆盖这两种触发源，
 * 不需要再额外监听 `provider.awareness`。
 */
export function useCollaborationCaretLabels(
  editor: Editor | null,
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean
): CaretLabelPosition[] {
  const [labels, setLabels] = useState<CaretLabelPosition[]>([]);

  useEffect(() => {
    if (!editor || !enabled) {
      setLabels([]);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    let frame: number | null = null;

    function recompute(): void {
      const containerEl = containerRef.current;
      if (!containerEl) return;
      const containerRect = containerEl.getBoundingClientRect();
      const carets = containerEl.querySelectorAll<HTMLElement>(
        '.doc-editor-caret[data-collab-caret-name]'
      );
      const next: CaretLabelPosition[] = [];
      carets.forEach((el, index) => {
        const rect = el.getBoundingClientRect();
        next.push({
          key: `${el.dataset['collabCaretName']}-${index}`,
          name: el.dataset['collabCaretName'] ?? '匿名用户',
          color: el.dataset['collabCaretColor'] ?? '#999999',
          top: rect.top - containerRect.top,
          left: rect.left - containerRect.left
        });
      });
      setLabels(next);
    }

    // 用 rAF 合并同一帧内的多次触发（比如一次 transaction 同时改了好几个协作者的
    // decoration），避免同步的 `getBoundingClientRect()` 批量读取触发不必要的重复布局。
    function scheduleRecompute(): void {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        recompute();
      });
    }

    recompute();
    editor.on('transaction', scheduleRecompute);
    // 容器自身宽度变化（比如大纲展开/收起、窗口 resize、Sidebar 拖拽）会让文本重新
    // 折行，光标的屏幕位置也会跟着变，这类变化不经过 `transaction`，需要单独监听。
    const resizeObserver = new ResizeObserver(scheduleRecompute);
    resizeObserver.observe(container);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      editor.off('transaction', scheduleRecompute);
      resizeObserver.disconnect();
    };
  }, [editor, enabled, containerRef]);

  return labels;
}
