import {documentEditorExtensions} from '@luhanxin/tiptap-editor/schema';
// 必须用 `/server` 子路径：包根入口的 exports 条件在 Node 下解析到浏览器版实现，会直接
// 抛 "generateHTML can only be used in a browser environment"；server 入口内部挂
// happy-dom（随包安装的 peer 依赖）提供最小 DOM 环境，不需要单独引入 jsdom。
import {generateHTML} from '@tiptap/html/server';
import {IMAGE_PLACEHOLDER_TEXT, videoPlaceholderText} from './document-export-markdown';
import {rasterizeMermaidSources} from './mermaid-rasterizer';

/**
 * HTML 中间层（见 document-export design.md 决策 2）：Word（`html-to-docx`）与 PDF
 * （Playwright `page.pdf()`）都从同一份 HTML 出发，不各自维护一套"从 JSON 直接生成"的
 * 逻辑。HTML 用 `@tiptap/html` 的 `generateHTML` + 跟前端编辑器完全相同的
 * `documentEditorExtensions` 生成——渲染规则的来源跟内容校验、Markdown 转换共享同一份
 * Schema 定义（`@tiptap/html` 在 Node 环境经 exports 条件自动走 server 入口，内部用
 * happy-dom 提供最小 DOM 实现，随包安装，无需额外依赖）。
 */

/** Mermaid 光栅化失败（源码语法错误等）时的降级文案——单个图表失败不中断整篇导出
 * （见 services/mermaid-rasterizer.ts 的容错约定）。 */
const MERMAID_FALLBACK_TEXT = '[图表渲染失败，请在应用内查看]';

interface ExportContentNode {
  type?: unknown;
  attrs?: Record<string, unknown> | null;
  content?: ExportContentNode[];
  text?: unknown;
}

function isExportNode(value: unknown): value is ExportContentNode {
  return value !== null && typeof value === 'object';
}

function textParagraph(text: string): ExportContentNode {
  return {type: 'paragraph', content: [{type: 'text', text}]};
}

/**
 * 生成 HTML 前的节点替换（见 tasks.md 3.2、spec.md「视频节点在所有导出格式中降级为文字
 * 提示」「转码中或上传失败的媒体节点不导出为占位符」）：视频节点（不区分状态）与
 * `src` 为空的图片节点替换为文字说明段落。文案/判断逻辑直接复用 Markdown 序列化导出的
 * 同一份常量与函数（services/document-export-markdown.ts），两处不各自维护。
 *
 * 纯 JSON 递归替换、不经过 ProseMirror 文档树——替换发生在 `generateHTML` 之前，替换
 * 出的 `paragraph` 节点在 `documentSchema` 里天然合法（视频/图片与段落同为 block）。
 */
export function replaceExportPlaceholderNodes(content: unknown): unknown {
  if (!isExportNode(content)) return content;

  const nodeType = typeof content.type === 'string' ? content.type : '';
  if (nodeType === 'video') {
    return textParagraph(videoPlaceholderText(content.attrs?.['status']));
  }
  if (nodeType === 'image') {
    const src = content.attrs?.['src'];
    if (typeof src !== 'string' || src === '') {
      return textParagraph(IMAGE_PLACEHOLDER_TEXT);
    }
    return content;
  }
  if (Array.isArray(content.content)) {
    return {...content, content: content.content.map(replaceExportPlaceholderNodes)};
  }
  return content;
}

function collectMermaidSources(node: unknown, out: string[]): void {
  if (!isExportNode(node)) return;
  if (node.type === 'mermaid') {
    const source = node.attrs?.['source'];
    out.push(typeof source === 'string' ? source : '');
    return; // atom 节点，没有子内容
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) collectMermaidSources(child, out);
  }
}

/**
 * 把内容 JSON 里的 Mermaid 图表块替换为图片节点（见 design.md 决策 5、spec.md「图表块
 * 光栅化后嵌入」）：Word/PDF 都无法嵌入交互式图表，先集中调用光栅化服务
 * （services/mermaid-rasterizer.ts，浏览器按需启动、用完即关）把全部图表渲染成 PNG，
 * 再以 data URI 内嵌进图片节点——data URI 同时被 `html-to-docx`（直接按 base64 落进
 * docx 包）与 Playwright（无网络请求）支持，不需要额外的临时文件中转。
 *
 * 没有图表时原样返回（不启动浏览器）；单个图表渲染失败时该位置降级为文字说明。
 */
export async function replaceMermaidNodesWithImages(content: unknown): Promise<unknown> {
  const sources: string[] = [];
  collectMermaidSources(content, sources);
  if (sources.length === 0) return content;

  const images = await rasterizeMermaidSources(sources);
  let index = 0;
  const replace = (node: unknown): unknown => {
    if (!isExportNode(node)) return node;
    if (node.type === 'mermaid') {
      const png = images[index++];
      if (!png) return textParagraph(MERMAID_FALLBACK_TEXT);
      return {
        type: 'image',
        attrs: {src: `data:image/png;base64,${png.toString('base64')}`, alt: 'Mermaid 图表'}
      };
    }
    if (Array.isArray(node.content)) {
      return {...node, content: node.content.map(replace)};
    }
    return node;
  };
  return replace(content);
}

/**
 * 导出专用打印样式（见 tasks.md 3.4）：标题层级、代码块（含 lowlight 产出的 hljs 高亮
 * 类名）配色、表格边框、图片限宽，风格贴近编辑器只读渲染，但完全自包含——不依赖
 * packages/tiptap-editor 的运行时样式文件（那套样式绑定浏览器端 CSS 变量/交互态）。
 * Word 路径里这份 `<style>` 会被 `html-to-docx` 忽略（它只认语义标签与内联样式，
 * h1~h6/table/pre 自带映射），同一份 HTML 两条路径共用。
 */
const EXPORT_CSS = `@page { size: A4; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  font-size: 14px; line-height: 1.7; color: #1f2328;
}
h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.2em 0 0.5em; font-weight: 600; }
h1 { font-size: 1.7em; } h2 { font-size: 1.4em; } h3 { font-size: 1.2em; }
h4 { font-size: 1.05em; } h5, h6 { font-size: 1em; }
.export-document-title {
  font-size: 1.9em; margin: 0 0 0.8em; padding-bottom: 0.4em;
  border-bottom: 1px solid #d8dee4;
}
p { margin: 0.5em 0; }
a { color: #0969da; }
blockquote {
  margin: 0.8em 0; padding: 0.1em 1em;
  border-left: 3px solid #d0d7de; color: #59636e;
}
pre {
  background: #f6f8fa; border: 1px solid #d8dee4; border-radius: 6px;
  padding: 12px 14px; overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 0.9em; line-height: 1.5;
  page-break-inside: avoid;
}
code {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
}
p code, li code, td code, th code {
  background: #f6f8fa; padding: 2px 5px; border-radius: 4px; font-size: 0.9em;
}
/* lowlight 语法高亮（GitHub light 配色，与编辑器 CodeBlockView 的观感基本一致） */
.hljs-comment, .hljs-quote { color: #6a737d; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-deletion { color: #d73a49; }
.hljs-string, .hljs-regexp, .hljs-addition { color: #032f62; }
.hljs-number, .hljs-literal, .hljs-built_in { color: #005cc5; }
.hljs-title, .hljs-title.function_, .hljs-section { color: #6f42c1; }
.hljs-attr, .hljs-attribute, .hljs-variable, .hljs-template-variable, .hljs-name { color: #e36209; }
.hljs-type, .hljs-title.class_, .hljs-class .hljs-title { color: #22863a; }
.hljs-meta, .hljs-meta .hljs-keyword { color: #735c0f; }
.hljs-symbol, .hljs-bullet, .hljs-link { color: #e36209; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 600; }
table {
  border-collapse: collapse; width: 100%; margin: 1em 0;
  page-break-inside: avoid;
}
th, td { border: 1px solid #d8dee4; padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: #f6f8fa; font-weight: 600; }
img { max-width: 100%; height: auto; }
hr { border: none; border-top: 1px solid #d8dee4; margin: 1.5em 0; }
ul, ol { padding-left: 1.6em; }
ul[data-type='taskList'] { list-style: none; padding-left: 0.4em; }
ul[data-type='taskList'] li { margin: 0.2em 0; }
ul[data-type='taskList'] input[type='checkbox'] { margin-right: 0.45em; }
/* 链接预览卡片：Schema 的 renderHTML 直接产出完整 DOM 结构（doc-editor-link-card 一族），
 * 这里给一套最接近编辑器观感的静态卡片样式 */
.doc-editor-link-card {
  display: block; margin: 0.8em 0; padding: 12px 14px;
  border: 1px solid #d8dee4; border-radius: 8px; text-decoration: none; color: inherit;
}
.doc-editor-link-card__title { font-weight: 600; color: #1f2328; }
.doc-editor-link-card__description { margin: 4px 0; color: #59636e; font-size: 0.92em; }
.doc-editor-link-card__meta { display: flex; align-items: center; gap: 6px; color: #0969da; font-size: 0.88em; }
.doc-editor-link-card__favicon { width: 14px; height: 14px; }
.doc-editor-link-card__image { max-width: 100%; border-radius: 6px; margin-bottom: 8px; }
`;

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * 把（已做过占位替换与 Mermaid 光栅化的）物化内容 JSON 转换成一份完整的、自包含的
 * HTML 文档字符串（见 tasks.md 3.1/3.4）：文档标题作为一级标题置于正文之前（标题是
 * 独立字段、不在正文 JSON 里，Markdown 导出同样在 handler 层拼 `# 标题`，两种格式
 * 行为一致）。
 */
export function buildExportHtmlDocument(title: string, content: unknown): string {
  const bodyHtml = generateHTML(
    content as Parameters<typeof generateHTML>[0],
    documentEditorExtensions
  );
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
${EXPORT_CSS}
</style>
</head>
<body>
<h1 class="export-document-title">${escapeHtml(title)}</h1>
${bodyHtml}
</body>
</html>`;
}
