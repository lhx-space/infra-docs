import {Schema} from '@tiptap/pm/model';

/**
 * 标题对应的极简 ProseMirror Schema：`doc` 恰好一个 `paragraph`，`paragraph` 只允许
 * 纯文本节点，不支持任何 mark（加粗/链接等）——跟前端标题输入框的极简 Tiptap 编辑器
 * 实例（只装配 `Document`/`Paragraph`/`Text` 三个节点）产出的 JSON 结构完全对应
 * （见 collaborative-document-title design.md 决策 2）。
 *
 * 不复用 `document-schema.ts` 里给正文用的完整 Schema——标题从产品语义上就不需要
 * 富文本能力，用一份独立的极简 Schema 更清楚地表达这一点，也避免正文 Schema 未来
 * 演进（比如新增节点类型）时意外影响标题这边完全不相关的校验/转换逻辑。
 */
export const titleSchema = new Schema({
  nodes: {
    doc: {content: 'paragraph'},
    paragraph: {content: 'text*'},
    text: {}
  }
});
