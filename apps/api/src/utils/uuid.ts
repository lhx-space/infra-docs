/**
 * 校验字符串是否是合法的 UUID 格式（不区分版本，只校验结构）。
 * 路由参数（`:wikiId`/`:userId`）在查库前必须先过这道校验——
 * Postgres 的 `uuid` 列类型不接受非法格式的字符串，直接查会抛出裸的数据库错误而不是干净的 404。
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
