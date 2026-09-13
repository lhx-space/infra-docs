import {Platform} from 'react-native';

/**
 * 移动端运行时配置。`EXPO_PUBLIC_*` 由 Expo 在构建/运行时内联注入（见 Expo 环境变量文档）。
 *
 * 各环境的宿主机地址约定：
 * - iOS 模拟器：与 Mac 共享网络，`localhost` 就是宿主机；
 * - Android 模拟器：独立虚拟机，`localhost` 指向模拟器自身，访问宿主机必须用 `10.0.2.2`；
 * - 真机（iOS/Android）：`localhost`/`10.0.2.2` 都不对，需要在 `.env` 里把
 *   `EXPO_PUBLIC_API_URL` 设成电脑的局域网地址（如 http://192.168.x.x:3000）。
 *
 * 因此：跑模拟器时**不要**设置 `.env`（走下面按平台的默认值）；只有真机调试时才写 `.env`。
 */
function defaultBaseUrl(): string {
  if (Platform.OS === 'android') return 'http://10.0.2.2:3000';
  return 'http://localhost:3000';
}

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? defaultBaseUrl();
