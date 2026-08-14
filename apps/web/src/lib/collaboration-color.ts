/**
 * 按用户 id 生成确定性的区分色（HSL），同一个用户在任意设备/任意会话下颜色都一致
 * （见 yjs-realtime-collaboration tasks.md 4.5「颜色可按 userId 做确定性映射」）。
 * 不引入额外依赖——只是一个简单的字符串哈希，不需要密码学强度。
 */
export function colorFromUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}
