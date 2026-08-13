import {env} from '../env';

/**
 * 递归遍历 ProseMirror JSON 内容树，按图片 URL（`attrs.src`）统计"本项目上传接口产生
 * 的图片对象"节点的出现次数（见 upload-reliability-hardening design.md 决策 5）。
 * 完全镜像 `video-content.ts` 的 `countVideoAssetOccurrences`——唯一区别是图片节点
 * 存的是完整 URL（不是像视频那样的 `assetId`），这跟 `services/storage.ts` 的
 * `releaseImageRef` 现有的"按 URL 反查 `UploadedObject`"机制天然对得上，不需要引入
 * 新的标识字段。
 *
 * 只统计 `src` 命中 `env.MINIO_PUBLIC_URL` 前缀的节点——这个前缀就是本项目所有上传
 * 接口产生对象的公开访问地址；如果编辑器将来支持插入纯外部图片 URL，这类 URL 在
 * `UploadedObject` 表里查不到记录，`acquireImageRef`/`releaseImageRef` 按 URL 查不到
 * 时视为无操作，天然不会误处理，这里提前过滤掉也能少走几次无意义的数据库查询。
 */
export function countImageAssetOccurrences(content: unknown): Map<string, number> {
  const counts = new Map<string, number>();

  function walk(node: unknown): void {
    if (node === null || typeof node !== 'object') return;
    const n = node as {type?: unknown; attrs?: Record<string, unknown>; content?: unknown};

    if (n.type === 'image') {
      const src = n.attrs?.['src'];
      if (typeof src === 'string' && src.startsWith(env.MINIO_PUBLIC_URL)) {
        counts.set(src, (counts.get(src) ?? 0) + 1);
      }
    }

    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
    }
  }

  walk(content);
  return counts;
}

export interface ImageAssetRefDiff {
  /** 次数增加的图片 URL → 增加的次数（需要补 `acquireImageRef`） */
  acquired: Map<string, number>;
  /** 次数减少的图片 URL → 减少的次数（需要 `releaseImageRef`） */
  released: Map<string, number>;
}

/**
 * 比较"更新前内容"与"更新后内容"里每个图片 URL 的出现次数，得出需要增加/减少的引用
 * 计数差值（见 design.md 决策 5，跟 `video-content.ts` 的 `diffVideoAssetOccurrences`
 * 是同一套逻辑）。
 */
export function diffImageAssetOccurrences(
  oldContent: unknown,
  newContent: unknown
): ImageAssetRefDiff {
  const oldCounts = countImageAssetOccurrences(oldContent);
  const newCounts = countImageAssetOccurrences(newContent);
  const acquired = new Map<string, number>();
  const released = new Map<string, number>();

  const allSrcs = new Set([...oldCounts.keys(), ...newCounts.keys()]);
  for (const src of allSrcs) {
    const before = oldCounts.get(src) ?? 0;
    const after = newCounts.get(src) ?? 0;
    if (after > before) acquired.set(src, after - before);
    if (after < before) released.set(src, before - after);
  }

  return {acquired, released};
}
