/**
 * DiceBear（https://www.dicebear.com）确定性头像/图标生成服务的 URL 拼接。
 * "确定性"指同一个 seed 永远生成同一张图——不需要真实存储任何图片文件，
 * 用在"默认头像"（services/auth.ts）、"默认工作区封面"（services/wiki.ts）这类
 * "有个占位图就行、不需要用户手动上传"的场景。
 *
 * style 对应 DiceBear 的风格集合（如 'glass'、'shapes'），不同用途用不同风格区分视觉效果。
 */
export function buildDicebearUrl(style: string, seed: string): string {
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}
