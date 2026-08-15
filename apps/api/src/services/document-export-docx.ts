import htmlToDocxModule from 'html-to-docx';

/**
 * Word 导出（见 document-export design.md 决策 3）：从 HTML 中间层产物生成 `.docx`
 * Buffer。`html-to-docx` 是纯 JS、无原生依赖的转换库，覆盖标题层级/列表/表格/图片/
 * 代码块的基础排版；复杂表格与深层嵌套列表的还原精度是 v1 明确接受的保真度上限
 * （见 design.md Risks，跟 Markdown 遇到不支持的节点降级是同一个工程取舍）。
 *
 * CJS interop：该包 main 指向 UMD 构建（rollup 产出 `exports.default = ...`），Node
 * ESM 下默认导入拿到的是命名空间对象而不是函数本身，这里兼容两种形态取真正的调用体。
 */
const htmlToDocx =
  (htmlToDocxModule as unknown as {default?: typeof htmlToDocxModule}).default ?? htmlToDocxModule;

/**
 * `html-to-docx` 内部在解析前会做一次 `minifyHTMLString`——把源 HTML 里所有字面换行
 * 替换成空格（见其 dist 源码 `htmlString.replace(/\n/g, ' ')`），这会把 `<pre>` 代码块
 * 的换行全部破坏成一行。规避方式：交给它之前把 `<pre>` 块内部的换行先转成 `&#10;`
 * 实体——minify 只匹配字面 `\n` 不会动实体，后续解析阶段（`decodeUnicode: true` 或
 * htmlparser2 的 decodeEntities）会把实体还原回换行，代码块的行结构得以保留。
 */
function protectPreLineBreaks(html: string): string {
  return html.replace(/<pre[^>]*>[\s\S]*?<\/pre>/g, block => block.replaceAll('\n', '&#10;'));
}

/** 把导出 HTML 文档转换成 `.docx` Buffer（见 tasks.md 3.3，Word 同步返回文件）。 */
export async function convertExportHtmlToDocx(html: string): Promise<Buffer> {
  const result = await htmlToDocx(protectPreLineBreaks(html), null, {
    // 文档正文含中文（标题/段落/占位文案），开启实体解码配合上面的 `&#10;` 保护
    decodeUnicode: true
  });
  return Buffer.from(result as Buffer);
}
