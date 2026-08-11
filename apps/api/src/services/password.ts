import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

/** 密码哈希，输入/输出均不落日志 */
export function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/** 校验密码：只比较哈希，不比较明文 */
export function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}
