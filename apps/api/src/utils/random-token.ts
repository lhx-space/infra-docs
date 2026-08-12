import {randomBytes} from 'node:crypto';

/**
 * 生成一个 URL 安全的随机 token，用于团队邀请链接 / Wiki 分享链接。
 * 24 字节随机数 -> base64url 编码后约 32 字符，足够抵御猜测攻击，且不含需要转义的字符。
 */
export function generateToken(): string {
  return randomBytes(24).toString('base64url');
}
