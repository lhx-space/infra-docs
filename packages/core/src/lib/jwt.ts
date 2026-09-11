/**
 * 极简 JWT payload 解码工具：仅做 base64url 解码读取 claims（如 `exp`），不做任何签名/有效性校验。
 * 仅用于前端读取"自己持有的" access token 的过期时间，安排后台静默刷新的时机；
 * 真正的签名校验只在后端 `apps/api/src/services/token.ts` 里进行，这里的解析结果不可作为任何安全判断依据。
 */
export function decodeJwtPayload<T = Record<string, unknown>>(token: string): T | null {
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      Array.from(atob(base64))
        .map(c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join('')
    );
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/** 读取 JWT 的 `exp`（秒级时间戳）并转换成毫秒时间戳；解析失败或缺少该字段时返回 null */
export function getJwtExpiryMs(token: string): number | null {
  const payload = decodeJwtPayload<{exp?: number}>(token);
  return typeof payload?.exp === 'number' ? payload.exp * 1000 : null;
}
