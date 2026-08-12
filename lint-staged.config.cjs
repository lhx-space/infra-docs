module.exports = {
  // CSS/Less/Scss 改用 stylelint 校验（biome.json 已把这三类扩展名排除在自己的
  // files.includes 之外），不再走 biome——biome 的 CSS 解析器不支持 Less/Scss 语法，
  // 对 Tailwind v4 的 `@theme`/`@custom-variant` 这类 at-rule 也只能整体排除文件，
  // 而 stylelint + postcss-less/postcss-scss 能真正按各自的语法规则校验。
  '*.{css,less,scss}': ['stylelint --fix'],
  '*': ['biome check --write --no-errors-on-unmatched --files-ignore-unknown=true']
};
