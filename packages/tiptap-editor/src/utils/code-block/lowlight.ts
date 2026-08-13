import {common, createLowlight} from 'lowlight';

/**
 * 代码块支持的语言范围：只注册这 12 种（见 document-editor spec.md「代码块的语言支持与交互」）。
 * 不用 lowlight 自带的 `all` 全量语言包——那个包含 190+ 种语言语法定义，体积远超需要，
 * 这里刻意从体积更小的 `common` 集合里精选，控制打包体积。
 */
const SUPPORTED_LANGUAGES = [
  'javascript',
  'typescript',
  'go',
  'cpp',
  'rust',
  'java',
  'python',
  'kotlin',
  'sql',
  'json',
  'css',
  'xml'
] as const;

export const documentLowlight = createLowlight();

for (const language of SUPPORTED_LANGUAGES) {
  const grammar = common[language];
  if (grammar) documentLowlight.register(language, grammar);
}
// HTML 内容用 highlight.js 的 xml 语法高亮即可覆盖标签结构，这里只是加一个更符合用户直觉的别名
documentLowlight.registerAlias({xml: ['html']});
