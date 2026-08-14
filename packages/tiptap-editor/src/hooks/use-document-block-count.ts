import type {Editor} from '@tiptap/core';
import {useEffect, useState} from 'react';

/**
 * 统计当前文档顶层内容块的数量（见 document-editor-performance spec.md「超大文档拆分
 * 引导」）。只读 `doc.childCount`（ProseMirror 顶层节点数组的长度，O(1)），不像
 * `useDocumentOutline` 那样需要对整棵树做 `descendants()` 全量扫描，因此不需要防抖——
 * 每次 `update` 事件重新读一次这个数字的开销可以忽略，不会重新引入「每次按键都全量扫描」
 * 这类随文档变大而线性变差的开销（见 system-performance-hardening design.md Context）。
 */
export function useDocumentBlockCount(editor: Editor | null): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!editor) {
      setCount(0);
      return;
    }

    function recompute(): void {
      setCount(editor?.state.doc.childCount ?? 0);
    }

    recompute();
    editor.on('update', recompute);
    return () => {
      editor.off('update', recompute);
    };
  }, [editor]);

  return count;
}
