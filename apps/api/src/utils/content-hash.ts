import {createHash} from 'node:crypto';

/**
 * 对原始 buffer 计算 sha256（十六进制）——图片去重（`services/storage.ts`）与视频去重
 * （`services/video.ts`）共用同一个哈希实现，避免重复定义（见 video-dedup-and-lifecycle
 * design.md 决策 1：视频去重直接复用图片去重同款心智模型）。
 */
export function computeSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
