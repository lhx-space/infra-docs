import {documentEditorExtensions} from '@luhanxin/tiptap-editor/schema';
import {getSchema} from '@tiptap/core';
import type {Schema} from '@tiptap/pm/model';
import {Node as ProseMirrorNode} from '@tiptap/pm/model';

/**
 * 用编辑器实际支持的扩展集合构建一份 ProseMirror `Schema`，用于服务端内容校验。
 * 这里引入的是 `@luhanxin/tiptap-editor/schema`（纯 Schema 配置，不含 React/浏览器代码），
 * 跟前端编辑器渲染时用的是同一份定义来源，不会出现"编辑器能输入的内容，后端却拒绝保存"的
 * 不一致（见 design.md 决策 3、wiki-document spec.md「保存内容前进行结构校验」）。
 * 只需要在模块加载时构建一次，`Schema` 本身是不可变的纯数据结构。
 */
const documentSchema: Schema = getSchema(documentEditorExtensions);

/**
 * 校验提交的内容 JSON 是否完全由编辑器支持的节点/属性组成：用 `Node.fromJSON` 尝试按这份
 * `Schema` 还原成 ProseMirror 文档树，还原失败（未识别的节点类型/非法属性/结构不合法）说明
 * 内容不合法。这不是"看起来像不像"的粗略检查，是 ProseMirror 自身用来解析文档的同一条路径，
 * 因此任何绕过编辑器 UI 直接调接口注入的非法内容都会在这里被拒绝
 * （见 spec.md「拒绝未识别的节点类型」）。
 */
export function validateDocumentContent(content: unknown): boolean {
  try {
    ProseMirrorNode.fromJSON(
      documentSchema,
      content as Parameters<typeof ProseMirrorNode.fromJSON>[1]
    );
    return true;
  } catch {
    return false;
  }
}
