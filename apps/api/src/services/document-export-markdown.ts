import {Node as ProseMirrorNode} from '@tiptap/pm/model';
import {MarkdownSerializer, type MarkdownSerializerState} from 'prosemirror-markdown';
import {documentSchema} from '../utils/document-schema';

/** 视频节点在所有导出格式中统一使用的降级文案（见 design.md 决策 6、spec.md「视频节点在
 * 所有导出格式中降级为文字提示」）：三种格式（Markdown 在这里、Word/HTML 见
 * services/document-export-html.ts）共用同一份文案常量，避免各自维护一套导致措辞漂移。 */
export const VIDEO_PLACEHOLDER_TEXT = '[视频内容，请在应用内查看]';
export const VIDEO_PROCESSING_TEXT = '[视频处理中，请稍后在应用内查看]';
export const VIDEO_FAILED_TEXT = '[视频处理失败]';

/** 转码中/上传失败的图片节点降级文案（见 spec.md「转码中或上传失败的媒体节点不导出为
 * 占位符」）——图片节点本身没有 `status` 概念（跟视频不同，见 utils/extensions.ts 的
 * `Image` 扩展只有 `src`/`alt`/`title`/`align`），只有当 `src` 为空（占位/上传未完成）
 * 时才需要这条降级，正常场景下 `src` 总是已经上传成功后才落库的完整 URL。
 * 导出供 HTML 中间层（services/document-export-html.ts）复用——视频/图片两条降级文案
 * 必须跟 Markdown 序列化是同一份，避免两处措辞漂移（见 tasks.md 3.2）。 */
export const IMAGE_PLACEHOLDER_TEXT = '[图片处理中或已失效]';

/** 给视频节点选取对应的降级文案（见 spec.md「视频节点在所有导出格式中降级为文字提示」
 * 「转码中或上传失败的媒体节点不导出为占位符」），Markdown/HTML 两处转换共用同一份判断
 * 逻辑，避免文案/分支条件出现漂移。 */
export function videoPlaceholderText(status: unknown): string {
  if (status === 'processing') return VIDEO_PROCESSING_TEXT;
  if (status === 'failed') return VIDEO_FAILED_TEXT;
  return VIDEO_PLACEHOLDER_TEXT;
}

function writeParagraphLike(state: MarkdownSerializerState, node: ProseMirrorNode): void {
  state.renderInline(node);
  state.closeBlock(node);
}

/** 代码块语言标注：`language` 为空（用户未选择语言）时输出裸 fenced code block，跟
 * GitHub 等主流渲染器的习惯一致，不强行填一个错误的语言名。 */
function codeBlockLanguage(node: ProseMirrorNode): string {
  const language = node.attrs['language'];
  return typeof language === 'string' ? language : '';
}

/** 有序列表的起始序号：非 1 时需要显式带出（如从第 3 项开始的有序列表），否则 Markdown
 * 渲染器会一律从 1 开始编号，丢失原文档的语义。 */
function orderedListItemMarker(node: ProseMirrorNode): (index: number) => string {
  const start = typeof node.attrs['start'] === 'number' ? (node.attrs['start'] as number) : 1;
  return index => `${start + index}. `;
}

/**
 * Markdown 导出的节点序列化规则（见 design.md 决策 1，tasks.md 2.1~2.4）：标准节点复用
 * `prosemirror-markdown` 的常规实现思路（`state.wrapBlock`/`renderList` 等），自定义节点
 * （Mermaid/视频/代码块语言标注/图片/链接预览）各自按 spec.md 约定的规则单独处理。
 *
 * 没有在这里显式列出的节点类型（`options.strict: false`，见下方 `serializeDocumentToMarkdown`）
 * 会被 `MarkdownSerializer` 静默忽略而不是抛错中断整篇转换——这是「未覆盖的未知节点类型
 * 兜底降级」的兜底层（tasks.md 2.4），已知的全部节点类型仍然都在这里显式处理，不依赖这个
 * 兜底覆盖正常场景。
 */
const nodeSerializers: MarkdownSerializer['nodes'] = {
  // `MarkdownSerializerState.render`/`renderInline` 按 `node.type.name` 查表分发，
  // 文本节点（`type.isLeaf === true`）不会落进 `strict: false` 的兜底分支（那个分支
  // 只处理非 leaf 节点），必须显式注册，否则所有内容里的纯文本都会被静默丢弃——这是
  // `prosemirror-markdown` 的既有设计，`defaultMarkdownSerializer` 同样需要这一条。
  text(state, node) {
    state.text(node.text ?? '', true);
  },

  paragraph: writeParagraphLike,

  heading(state, node) {
    const level = typeof node.attrs['level'] === 'number' ? (node.attrs['level'] as number) : 1;
    state.write(`${'#'.repeat(level)} `);
    state.renderInline(node);
    state.closeBlock(node);
  },

  blockquote(state, node) {
    state.wrapBlock('> ', null, node, () => state.renderContent(node));
  },

  horizontalRule(state, node) {
    state.write('---');
    state.closeBlock(node);
  },

  bulletList(state, node) {
    state.renderList(node, '  ', () => '- ');
  },

  orderedList(state, node) {
    state.renderList(node, '  ', orderedListItemMarker(node));
  },

  listItem(state, node) {
    state.renderContent(node);
  },

  taskList(state, node) {
    state.renderList(node, '  ', () => '- ');
  },

  taskItem(state, node) {
    // 只把复选框标记写在这一个列表项的第一行前面——`renderContent` 会继续按块节点正常
    // 渲染剩余内容（多段落的任务项、嵌套子列表），跟 `listItem` 是同一套写法，只是多了
    // 复选框前缀。
    state.write(node.attrs['checked'] ? '[x] ' : '[ ] ');
    state.renderContent(node);
  },

  codeBlock(state, node) {
    state.write(`\`\`\`${codeBlockLanguage(node)}\n`);
    state.text(node.textContent, false);
    state.ensureNewLine();
    state.write('```');
    state.closeBlock(node);
  },

  hardBreak(state, _node, parent, index) {
    // 完全对齐 `defaultMarkdownSerializer` 对 hard_break 的处理：段落末尾的换行不需要
    // 输出任何内容（下一个块自然会换行），只有段落中间的换行才需要显式的两个空格+换行。
    const isLastInParent = index === parent.childCount - 1;
    if (!isLastInParent && parent.type.spec.isolating !== true) {
      state.write('  \n');
    }
  },

  image(state, node) {
    const src = node.attrs['src'];
    if (typeof src !== 'string' || !src) {
      state.write(IMAGE_PLACEHOLDER_TEXT);
      return;
    }
    const alt = state.esc((node.attrs['alt'] as string | null) || '');
    const title = node.attrs['title'] ? ` "${state.esc(node.attrs['title'] as string)}"` : '';
    state.write(`![${alt}](${src}${title})`);
  },

  // Mermaid 图表：Markdown 导出保留原始源码，包成标注了 `mermaid` 语言的 fenced code
  // block，不做任何光栅化——GitHub 等主流 Markdown 渲染环境原生认识这个语法，PDF/Word
  // 才需要光栅化为图片（见 design.md 决策 5、spec.md「Mermaid 图表在 Markdown 导出中的
  // 处理」）。
  mermaid(state, node) {
    state.write('```mermaid\n');
    state.text((node.attrs['source'] as string | null) || '', false);
    state.ensureNewLine();
    state.write('```');
    state.closeBlock(node);
  },

  // 视频节点统一降级为文字说明（见 design.md 决策 6、spec.md「视频节点在所有导出格式中
  // 降级为文字提示」「转码中或上传失败的媒体节点不导出为占位符」），不区分来源
  // （upload/external），三种状态（processing/ready/failed）分别对应不同文案。
  video(state, node) {
    state.write(videoPlaceholderText(node.attrs['status']));
    state.closeBlock(node);
  },

  // 链接预览卡片降级为纯链接（见 proposal.md「What Changes」）：Markdown 天然不支持
  // 富媒体卡片排版，用标题（缺失时用 URL 本身兜底）+ 链接是信息损失最小的等价表示。
  linkPreviewCard(state, node) {
    const url = (node.attrs['url'] as string | null) || '';
    const title = (node.attrs['title'] as string | null) || url;
    state.write(`[${state.esc(title)}](${url})`);
    state.closeBlock(node);
  },

  table(state, node) {
    state.renderContent(node);
    state.closeBlock(node);
  },

  // GFM 管道表格不支持单元格合并（colspan/rowspan），跟 Word 导出接受的"复杂表格还原
  // 精度上限"是同一个工程取舍（见 design.md Risks）：合并单元格在导出的 Markdown 里会
  // 表现为看起来对不齐的多余空列，不阻断导出、不抛出异常。
  tableRow(state, node, parent) {
    const cells: string[] = [];
    node.forEach(cell => {
      cells.push(cellPlainText(cell));
    });
    state.write(`| ${cells.join(' | ')} |`);
    state.ensureNewLine();

    // 表头行结束后追加 GFM 分隔行；`parent`（table）的第一个子节点如果全部由
    // `tableHeader` 组成，视为表头行——跟编辑器里"第一行默认表头"的既有约定一致
    // （见 utils/extensions.ts 的 TableKit 配置）。
    const isFirstRow = parent.firstChild === node;
    const isHeaderRow = isFirstRow && isAllTableHeaderCells(node);
    if (isHeaderRow) {
      state.write(`| ${cells.map(() => '---').join(' | ')} |`);
      state.ensureNewLine();
    }
  },

  // tableCell/tableHeader 本身不需要单独的节点序列化函数——内容已经在 `tableRow` 里
  // 通过 `cellPlainText` 直接读取，这里注册空实现只是为了满足 `strict` 模式下
  // "每个出现的节点类型都必须有序列化函数"的要求，不会被单独调用到（`tableRow` 用
  // `node.forEach` 而不是 `state.renderContent`，不会触发 ProseMirror 常规的子节点
  // 渐进渲染流程）。
  tableCell() {},
  tableHeader() {}
};

function isAllTableHeaderCells(row: ProseMirrorNode): boolean {
  let allHeaders = true;
  row.forEach(cell => {
    if (cell.type.name !== 'tableHeader') allHeaders = false;
  });
  return allHeaders;
}

/** 管道表格里的单元格内容拼成单行纯文本：GFM 表格语法不允许单元格内部出现真正的换行，
 * 多段落/换行统一拼接成空格分隔的一行——跟"复杂表格还原精度上限"是同一个工程取舍
 * （见 design.md Risks），已经比直接抛出异常/中断导出好得多。 */
function cellPlainText(cell: ProseMirrorNode): string {
  const parts: string[] = [];
  cell.descendants(child => {
    if (child.isText) parts.push(child.text ?? '');
    return true;
  });
  return parts.join(' ').replace(/\|/g, '\\|').trim();
}

const markSerializers: MarkdownSerializer['marks'] = {
  bold: {open: '**', close: '**', mixable: true},
  italic: {open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true},
  strike: {open: '~~', close: '~~', mixable: true},
  code: {open: '`', close: '`', escape: false},
  link: {
    open: '[',
    close(_state, mark) {
      const href = (mark.attrs['href'] as string | null) || '';
      return `](${href})`;
    }
  }
};

/** 见 design.md 决策 1：`prosemirror-markdown` 的 `MarkdownSerializer` 专门设计成
 * "按节点/标记类型注册序列化函数"的扩展点，这里用跟服务端内容校验/HTML 生成共用的
 * `documentSchema`（`utils/document-schema.ts`）构建，保证"合法内容长什么样"的理解跟
 * 校验/其他两种导出格式完全一致。`strict: false` 是「未覆盖的未知节点类型兜底降级」
 * 的最后一道防线（tasks.md 2.4），已知节点类型都已在上面显式处理，这个选项只用于
 * 防御未来 Schema 扩展出的新节点类型意外导致整篇转换失败。 */
const documentMarkdownSerializer = new MarkdownSerializer(nodeSerializers, markSerializers, {
  strict: false
});

/**
 * 把文档物化内容 JSON 转换为标准 Markdown 文本（见 tasks.md 2.5、spec.md「Markdown 导出
 * 同步返回文件」）。用跟内容校验同一份 `documentSchema` 把 JSON 还原成 ProseMirror 文档
 * 树——这一步本身就会拒绝真正结构非法的内容（不合法的内容永远不会走到这里，`content`
 * 已经在保存前通过 `validateDocumentContent` 校验过），转换失败在这里只可能来自序列化
 * 规则本身的 bug，不做额外的 try/catch 掩盖。
 */
export function serializeDocumentToMarkdown(content: unknown): string {
  // 跟 `utils/document-schema.ts` 的 `validateDocumentContent` 用的是同一条还原路径
  // （同一份 `documentSchema`），保存前已经校验过的合法内容在这里不会再次失败。
  const doc = ProseMirrorNode.fromJSON(
    documentSchema,
    content as Parameters<typeof ProseMirrorNode.fromJSON>[1]
  );
  return documentMarkdownSerializer.serialize(doc, {tightLists: true});
}
