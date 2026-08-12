import {NodeViewContent, type NodeViewProps, NodeViewWrapper} from '@tiptap/react';
import {useState} from 'react';

/**
 * 代码块的交互层：语言标签 + 一键复制 + 折叠/展开（见 document-editor spec.md「代码块的语言
 * 支持与交互」）。语法高亮本身由 `CodeBlockLowlight` 负责渲染进 `NodeViewContent`，这里只
 * 包一层交互 UI，不重新实现高亮逻辑。
 */
export function CodeBlockView({node}: NodeViewProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const language = (node.attrs['language'] as string | null) ?? '自动检测';

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(node.textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板权限被拒绝等场景下静默失败，不打断编辑流程
    }
  }

  return (
    <NodeViewWrapper className="doc-editor-code-block" data-collapsed={collapsed}>
      <div className="doc-editor-code-block__header" contentEditable={false}>
        <button
          type="button"
          className="doc-editor-code-block__collapse"
          onClick={() => setCollapsed(prev => !prev)}
          aria-label={collapsed ? '展开代码块' : '折叠代码块'}
        >
          {collapsed ? '▶' : '▼'}
        </button>
        <span className="doc-editor-code-block__language">{language}</span>
        <button type="button" className="doc-editor-code-block__copy" onClick={handleCopy}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <NodeViewContent<'pre'>
        as="pre"
        className="doc-editor-code-block__content"
        style={collapsed ? {display: 'none'} : undefined}
      />
    </NodeViewWrapper>
  );
}
