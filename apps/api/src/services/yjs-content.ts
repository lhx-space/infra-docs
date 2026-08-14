import {prosemirrorJSONToYDoc, yDocToProsemirrorJSON} from 'y-prosemirror';
import * as Y from 'yjs';
import {documentSchema} from '../utils/document-schema';

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
 * 供决策 6 的存量文档惰性迁移使用：把当前 `content`（ProseMirror JSON）转换成一个
 * 全新 `Y.Doc` 的初始状态，编码成 Yjs 二进制返回给 `collab-server`。
 */
export function contentJsonToYjsState(contentJson: unknown): Buffer {
  const ydoc = prosemirrorJSONToYDoc(documentSchema, contentJson, Y_XML_FRAGMENT_FIELD);
  const update = Y.encodeStateAsUpdate(ydoc);
  return Buffer.from(update);
}

/**
 * 供决策 7 的周期性持久化使用：`collab-server` 传来的是某一时刻的完整 Yjs 状态
 * （不是增量 update），这里还原成一个临时 `Y.Doc` 只是为了读出对应的 ProseMirror JSON，
 * 用完即可丢弃，不需要长期持有。
 */
export function yjsStateToContentJson(state: Uint8Array): unknown {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, state);
  return yDocToProsemirrorJSON(ydoc, Y_XML_FRAGMENT_FIELD);
}
