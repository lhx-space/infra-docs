/**
 * `@lhx-kit/tiptap-editor` 主入口——面向浏览器/React 消费方（`apps/web`）：导出开箱即用的
 * `DocumentEditor` 组件与配套的大纲导航组件。纯 Schema 配置请从 `@lhx-kit/tiptap-editor/schema`
 * 子路径引入（见 `src/schema.ts`），那份导出不含任何 React/浏览器相关代码，可以安全被
 * `apps/api`（Node.js）引入做内容校验。
 */
export {
  DocumentEditor,
  type DocumentEditorProps,
  type SaveStatus
} from './components/DocumentEditor';
export {DocumentOutline} from './components/DocumentOutline';
export {documentEditorExtensions} from './utils/extensions';
export type {LinkPreviewResult} from './utils/link-preview-registry';
