/** app 包的运行时开关：由宿主（apps/web / apps/desktop）在 bootstrap 时注入。
 * 用于替代 `import.meta.env.DEV`——包源码不假设自己一定被 Vite 编译，
 * 是否开发模式由宿主显式告知。 */
let devMode = false;

export function setAppDevMode(next: boolean): void {
  devMode = next;
}

export function isAppDevMode(): boolean {
  return devMode;
}

/** 路由模式：web 用 `browser`（干净路径，依赖 http 服务器 history），
 * desktop 打包后用 `hash`（`file://` 协议下 BrowserRouter 无法匹配路径会 404）。 */
export type RouterType = 'browser' | 'hash';

let routerType: RouterType = 'browser';

export function setRouterType(next: RouterType): void {
  routerType = next;
}

export function getRouterType(): RouterType {
  return routerType;
}
