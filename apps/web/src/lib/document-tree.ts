import type {Document} from '@/services/document';

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
