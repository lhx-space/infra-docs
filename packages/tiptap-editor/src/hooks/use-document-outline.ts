import type {Editor} from '@tiptap/core';
import {useEffect, useState} from 'react';

export interface OutlineItem {
  id: string;
  level: number;
  text: string;
  pos: number;
}

/** 大纲重新计算的默认防抖时长，跟 `DocumentEditor` 自动保存的 `autosaveDelay` 默认值
 * （800ms）保持一致——复用用户已经熟悉的"停顿感"，不引入新的交互心智负担（见
 * system-performance-hardening design.md 决策 2）。 */
const DEFAULT_RECOMPUTE_DEBOUNCE_MS = 800;

/**
 * 根据当前编辑器内容的标题节点生成大纲（见 document-editor spec.md「文档大纲导航」）。
 * 监听 `update` 事件重新计算，不需要消费方手动刷新。
 *
 * 全文档 `descendants()` 扫描是随文档变大而线性变差的开销，而 `update` 事件在用户打字时
 * 每敲一个字就触发一次——不加防抖的话，长文档场景下会变成"每次按键都全量扫描一遍整篇
 * 文档"，直接拖慢输入延迟（见 system-performance-hardening design.md Context/决策 2）。
 * 这里把"每次 `update` 都算"改成"停止编辑一段时间后才算"，只影响重新计算的触发时机，
 * 不改变最终展示结果；首次挂载时立即计算一次（不等待防抖），保证大纲一开始就有内容。
 */
export function useDocumentOutline(
  editor: Editor | null,
  debounceMs: number = DEFAULT_RECOMPUTE_DEBOUNCE_MS
): OutlineItem[] {
  const [items, setItems] = useState<OutlineItem[]>([]);

  useEffect(() => {
    if (!editor) {
      setItems([]);
      return;
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

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

    function scheduleRecompute(): void {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(recompute, debounceMs);
    }

    // 首次挂载立即算一次（不等防抖），保证大纲一开始就有内容，不会有一段空白等待期；
    // 后续的 `update` 才走防抖。
    recompute();
    editor.on('update', scheduleRecompute);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      editor.off('update', scheduleRecompute);
    };
  }, [editor, debounceMs]);

  return items;
}
