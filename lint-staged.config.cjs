module.exports = {
  // CSS/Less/Scss 改用 stylelint 校验（biome.json 已把这三类扩展名排除在自己的
  // files.includes 之外），不再走 biome——biome 的 CSS 解析器不支持 Less/Scss 语法，
  // 对 Tailwind v4 的 `@theme`/`@custom-variant` 这类 at-rule 也只能整体排除文件，
  // 而 stylelint + postcss-less/postcss-scss 能真正按各自的语法规则校验。
  '*.{css,less,scss}': ['stylelint --fix'],
  // Rust（apps/collab-server，见 openspec/changes/yjs-realtime-collaboration）：
  // 直接调用 `rustfmt` 而不是 `cargo fmt`——`cargo fmt` 不接受具体文件路径参数，只能
  // 对整个 crate/workspace 格式化，没法只处理本次暂存的文件；`rustfmt` 二进制本身
  // 支持按文件路径原地格式化，跟 biome/stylelint 处理暂存文件的方式一致。
  // `cargo clippy` 不放在这里：它是 workspace 级别的编译期检查，没法按文件列表拆分，
  // 每次 commit 都跑一次全量编译会明显拖慢提交速度——跟 TS 侧的 `tsc`/`typecheck`
  // 同样不进 lint-staged（只留给 CI/`make clippy` 手动执行）是同一个理由。
  '*.rs': ['rustfmt'],
  '*': ['biome check --write --no-errors-on-unmatched --files-ignore-unknown=true']
};
