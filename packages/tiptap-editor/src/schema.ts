/**
 * 后端专用入口（`@luhanxin/tiptap-editor/schema`）：只导出纯 Schema 配置，不引入任何
 * React/浏览器相关代码（`@tiptap/react`、`mermaid` 等），保证在 Node.js（`apps/api`）环境下
 * 可以安全 `import` 而不会因为访问 `window`/`document` 报错（见 src/utils/extensions.ts 顶部注释）。
 */
export {documentEditorExtensions} from './utils/extensions';
