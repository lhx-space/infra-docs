import type {Editor} from '@tiptap/core';
import type {ReactNode} from 'react';
import {useMemo, useState} from 'react';
import {type OutlineItem, useDocumentOutline} from '../hooks/use-document-outline';

interface DocumentOutlineProps {
  editor: Editor | null;
}

interface OutlineTreeNode extends OutlineItem {
  children: OutlineTreeNode[];
}

/**
 * 按标题层级（level）把扁平的标题列表组装成树：level 更深的标题挂在最近一个更浅层级
 * 标题下面，作为它的子级——跟 Sidebar 文档树 `buildDocumentTree` 是同一种"扁平列表 →
 * 树"思路，只是这里的层级来自标题的 heading level，不是 parentId。
 */
function buildOutlineTree(items: OutlineItem[]): OutlineTreeNode[] {
  const roots: OutlineTreeNode[] = [];
  const stack: OutlineTreeNode[] = [];
  for (const item of items) {
    const node: OutlineTreeNode = {...item, children: []};
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

/**
 * 大纲直接融进正文左侧的留白区域，跟页面背景是同一色调、没有卡片边框/阴影（见 index.css
 * 「大纲导航」）——不是"悬浮在内容上方"的浮层感，是跟页面融为一体的纯文本列表，只是靠
 * `position: absolute` 不占正文的 flex 宽度分配，避免有没有大纲都把居中的正文挤动。
 *
 * 按标题层级组装成树，有子标题的节点前面带一个可以单独收起/展开的箭头（跟飞书一致）；
 * 此外整块大纲也支持整体收起/展开。只在文档里存在标题节点时才渲染；点击标题跳转到对应
 * 位置（见 document-editor spec.md「文档大纲导航」「大纲导航的收起与展开」）。
 */
export function DocumentOutline({editor}: DocumentOutlineProps) {
  const items = useDocumentOutline(editor);
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildOutlineTree(items), [items]);

  if (items.length === 0) return null;

  function handleClick(pos: number): void {
    if (!editor) return;
    const info = editor.view.domAtPos(pos);
    const el = info.node instanceof HTMLElement ? info.node : info.node.parentElement;
    el?.scrollIntoView({behavior: 'smooth', block: 'start'});
  }

  function toggleNode(id: string): void {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderNodes(nodes: OutlineTreeNode[]): ReactNode {
    return nodes.map(node => {
      const hasChildren = node.children.length > 0;
      const nodeCollapsed = collapsedIds.has(node.id);
      return (
        <div key={node.id}>
          <div
            className="doc-editor-outline__row"
            style={{paddingLeft: `${(node.level - 1) * 14}px`}}
          >
            {hasChildren ? (
              <button
                type="button"
                className="doc-editor-outline__caret"
                onClick={() => toggleNode(node.id)}
                aria-label={nodeCollapsed ? '展开子标题' : '收起子标题'}
              >
                {nodeCollapsed ? '▸' : '▾'}
              </button>
            ) : (
              <span
                aria-hidden="true"
                className="doc-editor-outline__caret doc-editor-outline__caret--placeholder"
              />
            )}
            <button
              type="button"
              className="doc-editor-outline__item"
              onClick={() => handleClick(node.pos)}
            >
              {node.text || '（无标题）'}
            </button>
          </div>
          {hasChildren && !nodeCollapsed ? renderNodes(node.children) : null}
        </div>
      );
    });
  }

  return (
    <div className="doc-editor-outline">
      <button
        type="button"
        className="doc-editor-outline__toggle"
        onClick={() => setCollapsed(prev => !prev)}
        aria-label={collapsed ? '展开大纲' : '收起大纲'}
        aria-expanded={!collapsed}
      >
        {collapsed ? '»' : '«'}
      </button>

      {collapsed ? null : (
        <nav className="doc-editor-outline__list" aria-label="文档大纲">
          {renderNodes(tree)}
        </nav>
      )}
    </div>
  );
}
