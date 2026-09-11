import type {Document} from '@luhanxin/api-client';

export interface DocumentTreeNode extends Document {
  children: DocumentTreeNode[];
}

/** 把后端返回的平铺文档列表按 `parentId` 组装成树，供 `Sidebar`/`WikiDetail` 递归渲染 */
export function buildDocumentTree(documents: Document[]): DocumentTreeNode[] {
  const nodeMap = new Map<string, DocumentTreeNode>();
  for (const doc of documents) nodeMap.set(doc.id, {...doc, children: []});

  const roots: DocumentTreeNode[] = [];
  for (const doc of documents) {
    const node = nodeMap.get(doc.id);
    if (!node) continue;
    const parent = doc.parentId ? nodeMap.get(doc.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** 带层级的平铺文档节点，供数据表渲染时按 depth 缩进标题，保留树形结构的视觉层级 */
export interface FlattenedDocument extends DocumentTreeNode {
  depth: number;
}

/** 把文档树按先序展开成带 depth 的平铺列表，供 Wiki 详情页的文档数据表使用 */
export function flattenDocumentTree(nodes: DocumentTreeNode[], depth = 0): FlattenedDocument[] {
  const result: FlattenedDocument[] = [];
  for (const node of nodes) {
    result.push({...node, depth});
    if (node.children.length > 0) {
      result.push(...flattenDocumentTree(node.children, depth + 1));
    }
  }
  return result;
}
