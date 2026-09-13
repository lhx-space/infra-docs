const {getDefaultConfig} = require('expo/metro-config');
const path = require('node:path');

// 项目根：apps/mobile。workspace 根是上两级（apps/mobile -> apps -> 仓库根）。
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. 监听整个 monorepo 的文件，workspace 包（如 @luhanxin/api-client）改动能热更新
config.watchFolders = [workspaceRoot];
// 2. 让 Metro 先在本项目、再在 workspace 根解析 node_modules（pnpm 符号链接场景）。
//    保留 Metro 默认的层级查找：pnpm 隔离布局下，expo-router 等传递依赖藏在
//    .pnpm/<pkg>/node_modules 里，只能靠层级查找解析到（关掉会报 @expo/metro-runtime 找不到）。
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules')
];

module.exports = config;
