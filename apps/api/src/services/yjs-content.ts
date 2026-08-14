import {
  prosemirrorJSONToYDoc,
  prosemirrorJSONToYXmlFragment,
  yDocToProsemirrorJSON,
  yXmlFragmentToProsemirrorJSON
} from 'y-prosemirror';
import * as Y from 'yjs';
import {documentSchema} from '../utils/document-schema';
import {titleSchema} from '../utils/title-schema';

/**
 * ProseMirror JSON ↔ Yjs 二进制状态的相互转换（见 yjs-realtime-collaboration
 * design.md 决策 5 的实现阶段修正说明）：这个转换只能在这里做一次——它依赖
 * `packages/tiptap-editor` 的具体 Schema（图片/视频/Mermaid/代码块/链接预览等自定义
 * 节点），`apps/collab-server`（Rust）全程只搬运这里产出的不透明二进制，不需要、也不
 * 应该理解 ProseMirror 的具体结构。
 *
 * `Y_XML_FRAGMENT_FIELD` 必须跟 `packages/tiptap-editor` 里 `@tiptap/extension-
 * collaboration` 的 `field` 配置项完全一致（见 tasks.md 4.3）——两侧各自读取/写入的是
 * 同一个 `Y.Doc` 里同名的 `XmlFragment`，任何一侧改了名字而另一侧没同步改，就会读到
 * 一个空文档。不依赖库的隐式默认值，这里显式声明一个固定值。
 */
export const Y_XML_FRAGMENT_FIELD = 'default';

/**
 * 标题对应的共享类型字段名，必须跟 `packages/tiptap-editor` 里标题编辑器实例的
 * `Collaboration` 扩展 `field` 配置项完全一致（见 collaborative-document-title
 * design.md 决策 1/2）。`@tiptap/extension-collaboration` 内部固定用
 * `document.getXmlFragment(field)` 绑定共享状态（不支持绑定原始的 `Y.Text`），
 * 所以标题跟正文一样也是一个 `XmlFragment`，只是绑定的是一份极简 Schema
 * （见 `utils/title-schema.ts`）产出的、恰好一个段落的文档结构，产品语义上仍然是
 * "纯文本标题"，只是底层复用了跟正文相同的 ProseMirror↔Yjs 绑定机制。
 *
 * 标题跟正文共用同一个 `Y.Doc` 实例——`Y.encodeStateAsUpdate` 编码的是整个 `Y.Doc`
 * （所有共享类型的状态），不是只编码某一个字段，所以两者天然都在同一份 `yjs_state`
 * 二进制里，不需要给 gRPC 契约新增任何字段，`apps/collab-server`（Rust）全程不需要
 * 知道这个字段的存在。
 */
export const Y_TITLE_FRAGMENT_FIELD = 'title';

/**
 * 供决策 6 的存量文档惰性迁移使用：把当前 `content`（ProseMirror JSON）与 `title`
 * （纯文本）转换成一个全新 `Y.Doc` 的初始状态，编码成 Yjs 二进制返回给 `collab-server`。
 *
 * 正文与标题分两步写在同一个 `Y.Doc` 上再统一编码：`prosemirrorJSONToYDoc` 先创建
 * 正文对应的 `XmlFragment`，标题这边把 `title` 包成一个"单段落纯文本"的 ProseMirror
 * JSON，用 `prosemirrorJSONToYXmlFragment` 写进同一个 `Y.Doc` 的 `title` 字段
 * （该函数接受一个已存在的 `XmlFragment` 作为第三个参数，不会另起一个新 `Y.Doc`）。
 */
export function contentJsonToYjsState(contentJson: unknown, title: string): Buffer {
  const ydoc = prosemirrorJSONToYDoc(documentSchema, contentJson, Y_XML_FRAGMENT_FIELD);
  const titleJson = titleToProseMirrorJson(title);
  prosemirrorJSONToYXmlFragment(
    titleSchema,
    titleJson,
    ydoc.getXmlFragment(Y_TITLE_FRAGMENT_FIELD)
  );
  const update = Y.encodeStateAsUpdate(ydoc);
  return Buffer.from(update);
}

/**
 * 供决策 7 的周期性持久化使用：`collab-server` 传来的是某一时刻的完整 Yjs 状态
 * （不是增量 update），这里还原成一个临时 `Y.Doc` 读出对应的 ProseMirror JSON，
 * 用完即可丢弃，不需要长期持有。
 */
export function yjsStateToContentJson(state: Uint8Array): unknown {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, state);
  return yDocToProsemirrorJSON(ydoc, Y_XML_FRAGMENT_FIELD);
}

/** 跟 `yjsStateToContentJson` 配对使用，从同一份 `yjs_state` 里解码出标题纯文本
 * （解出的是「单段落纯文本」ProseMirror JSON，这里顺手拼接出纯字符串，调用方不需要
 * 自己理解这层 JSON 结构）。 */
export function yjsStateToTitle(state: Uint8Array): string {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, state);
  const titleJson = yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment(Y_TITLE_FRAGMENT_FIELD));
  return extractTitleText(titleJson);
}

/** 把纯文本标题包成 `titleSchema` 能解析的最小 ProseMirror JSON（一个段落，一个文本节点，
 * 空字符串时段落没有 `content`——ProseMirror 的文本节点不允许空字符串）。 */
function titleToProseMirrorJson(title: string): {type: 'doc'; content: unknown[]} {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: title ? [{type: 'text', text: title}] : []
      }
    ]
  };
}

/** 跟 `titleToProseMirrorJson` 配对，从解出的 JSON 里拼接回纯文本（标题 Schema 只有
 * 一层段落，不需要递归——但仍按"拼接全部文本节点"的方式实现，跟正文的 `extractPlainText`
 * 保持同样的健壮性，不假设内容一定只有一个文本节点）。 */
function extractTitleText(node: unknown): string {
  if (node === null || typeof node !== 'object') return '';
  const n = node as {text?: unknown; content?: unknown};
  const parts: string[] = [];
  if (typeof n.text === 'string') parts.push(n.text);
  if (Array.isArray(n.content)) {
    for (const child of n.content) parts.push(extractTitleText(child));
  }
  return parts.join('');
}
