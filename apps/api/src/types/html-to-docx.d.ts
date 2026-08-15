/**
 * `html-to-docx` 1.x 不携带 TypeScript 类型声明（package.json 无 types 字段），这里按
 * 其 README/源码签名（dist/html-to-docx.esm.js 的 `export {generateContainer as default}`）
 * 手写最小声明：`(htmlString, headerHTMLString?, documentOptions?, footerHTMLString?) =>
 * Promise<Buffer | Blob>`，Node 环境返回 Buffer。
 */
declare module 'html-to-docx' {
  export interface HtmlToDocxDocumentOptions {
    orientation?: 'portrait' | 'landscape';
    pageSize?: {width?: string; height?: string};
    margins?: {
      top?: number | string;
      right?: number | string;
      bottom?: number | string;
      left?: number | string;
    };
    font?: string;
    fontSize?: number | string;
    decodeUnicode?: boolean;
    [key: string]: unknown;
  }

  function htmlToDocx(
    htmlString: string,
    headerHTMLString?: string | null,
    documentOptions?: HtmlToDocxDocumentOptions,
    footerHTMLString?: string | null
  ): Promise<Buffer | Blob>;

  export default htmlToDocx;
}
