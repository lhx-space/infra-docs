import type {Document} from '@luhanxin/api-client';

export interface DocumentTreeNode extends Document {
  children: DocumentTreeNode[];
}

/** 把后端平铺文档列表按 `parentId` 组装成树（逻辑与 packages/core lib/document-tree.ts 一致） */
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

export interface FlattenedDocument extends DocumentTreeNode {
  depth: number;
}

/** 把文档树按先序展开成带 depth 的平铺列表，供列表按层级缩进渲染 */
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
