// 这些非 TS 资源（CSS/Less/图片）由宿主（apps/web、apps/desktop 的 Vite）负责打包，
// 包自身不做构建，这里只声明模块类型让 tsc 认识这些 import（侧效应 import 与 `@/assets/*` 引用）。
declare module '*.css';
declare module '*.less';
declare module '*.png';
declare module '*.svg';
