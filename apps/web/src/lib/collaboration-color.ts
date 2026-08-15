/**
 * HSL 转 6 位十六进制颜色（标准转换公式，见 CSS Color 规范里 hsl-to-rgb 的算法）。
 * `h` 取值 0~360，`s`/`l` 取值 0~100（百分比，不是 0~1 的小数）。
 */
function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sNorm * Math.min(lNorm, 1 - lNorm);
  const f = (n: number) => lNorm - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) =>
    Math.round(255 * x)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/**
 * 按用户 id 生成确定性的区分色，同一个用户在任意设备/任意会话下颜色都一致（见
 * yjs-realtime-collaboration tasks.md 4.5「颜色可按 userId 做确定性映射」）。不引入
 * 额外依赖——只是一个简单的字符串哈希，不需要密码学强度。
 *
 * 最终吐出 6 位十六进制格式（而不是更直观的 `hsl(...)` 字符串）：`@tiptap/y-tiptap`
 * 的 `yCursorPlugin` 内部会校验 `awareness.user.color` 是否匹配
 * `/^#[0-9a-fA-F]{6}$/`（"We only support 6-digit RGB colors in y-prosemirror"），
 * 不匹配就 `console.warn('A user uses an unsupported color format', user)`——这个
 * 校验只影响它内部那条警告日志，不影响我们自己的 `renderCaret`/`renderCaretSelection`
 * 渲染（两者直接把颜色字符串塞进 `style`，浏览器原生认识 `hsl()`），但既然有现成的
 * 标准格式能满足这个校验、又不改变最终呈现的颜色本身，就没必要留着这条噪音警告。
 */
export function colorFromUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return hslToHex(hue, 65, 45);
}
