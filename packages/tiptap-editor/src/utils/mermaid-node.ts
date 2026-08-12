import {mergeAttributes, Node} from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mermaid: {
      /** 插入一个新的 Mermaid 图表块，默认进入编辑态（见 document-editor spec.md「插入图表默认进入编辑态」） */
      insertMermaid: () => ReturnType;
      /** 切换指定位置 Mermaid 块的编辑态/展示态（双击展示态图表 / 点击"完成"按钮时调用） */
      setMermaidMode: (mode: 'editing' | 'display') => ReturnType;
    };
  }
}

/**
 * Mermaid 图表块的 Schema 定义（不含 NodeView，见 src/utils/extensions.ts 顶部注释——
 * 这份配置同时被 `apps/api` 的内容安全校验和本包主入口的可编辑渲染复用）。
 * `source` 是 mermaid 源码字符串；`mode` 记录当前是编辑态还是展示态，跟随内容一起持久化——
 * 新插入的块默认 `editing`，用户确认后变成 `display` 并保持到下次手动切回（见 design.md 决策 6）。
 */
export const MermaidBlock = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      source: {default: ''},
      mode: {default: 'display'}
    };
  },

  parseHTML() {
    return [{tag: 'div[data-type="mermaid"]'}];
  },

  renderHTML({HTMLAttributes, node}) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'mermaid',
        'data-source': node.attrs['source'] as string,
        'data-mode': node.attrs['mode'] as string
      })
    ];
  },

  addCommands() {
    return {
      insertMermaid:
        () =>
        ({commands}) =>
          commands.insertContent({type: this.name, attrs: {source: '', mode: 'editing'}}),
      setMermaidMode:
        (mode: 'editing' | 'display') =>
        ({commands}) =>
          commands.updateAttributes(this.name, {mode})
    };
  }
});
