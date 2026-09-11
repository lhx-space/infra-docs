/** core 包的运行时配置：由宿主（apps/web / apps/desktop）在启动时通过 `configureCore` 注入。 */
export interface CoreConfig {
  apiBaseUrl: string;
  collabWsUrl: string;
}

let config: CoreConfig | null = null;

export function configureCore(next: CoreConfig): void {
  config = next;
}

export function getCoreConfig(): CoreConfig {
  if (!config) {
    throw new Error('core 尚未配置，请先调用 configureCore()');
  }
  return config;
}
