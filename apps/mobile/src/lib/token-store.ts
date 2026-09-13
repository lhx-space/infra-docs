import * as SecureStore from 'expo-secure-store';

const REFRESH_TOKEN_KEY = 'auth.refresh-token';

/**
 * 读已持久化的 refresh token。任何失败（web 端无 SecureStore、系统权限等）都静默降级为
 * null——最坏结果是下次启动无法静默恢复会话，用户需重新登录，不应让主流程因存储层报错。
 */
export async function getStoredRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** 持久化 refresh token；传 null 表示清除。失败同样静默降级。 */
export async function setStoredRefreshToken(token: string | null): Promise<void> {
  try {
    if (token) {
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
    } else {
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    }
  } catch {
    // 静默降级
  }
}
