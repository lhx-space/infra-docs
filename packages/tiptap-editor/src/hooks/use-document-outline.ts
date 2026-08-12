import type {Editor} from '@tiptap/core';
import {useEffect, useState} from 'react';

export interface OutlineItem {
  id: string;
  level: number;
  text: string;
  pos: number;
}

/**
 * 根据当前编辑器内容的标题节点生成大纲（见 document-editor spec.md「文档大纲导航」）。
 * 监听 `update` 事件实时重新计算，不需要消费方手动刷新。
 */
export function useDocumentOutline(editor: Editor | null): OutlineItem[] {
  const [items, setItems] = useState<OutlineItem[]>([]);

  useEffect(() => {
    if (!editor) {
      setItems([]);
      return;
    }

    function recompute(): void {
      const next: OutlineItem[] = [];
      editor?.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
          next.push({
            id: `heading-${pos}`,
            level: (node.attrs['level'] as number) ?? 1,
            text: node.textContent,
            pos
          });
        }
      });
      setItems(next);
    }

    recompute();
    editor.on('update', recompute);
    return () => {
      editor.off('update', recompute);
    };
  }, [editor]);

  return items;
}
