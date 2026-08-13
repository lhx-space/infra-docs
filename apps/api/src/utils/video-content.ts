/**
 * 递归遍历 ProseMirror JSON 内容树，按 `assetId` 统计"上传来源"视频节点的出现次数
 * （见 video-dedup-and-lifecycle design.md 决策 2）。用于在文档保存前后对比引用计数
 * 变化——跟 `services/document.ts` 里 `extractPlainText` 是同一种"信任结构、不假设
 * 节点类型白名单"的遍历风格，只关心 `type === 'video'` 这一种节点。
 *
 * 只统计 `sourceType === 'upload'` 的节点：外部粘贴的 `.m3u8` 地址（`sourceType ===
 * 'external'`）从不对应任何 `VideoAsset` 记录，没有引用计数需要维护（见 spec.md
 * 「视频插入来源」）。
 */
export function countVideoAssetOccurrences(content: unknown): Map<string, number> {
  const counts = new Map<string, number>();

  function walk(node: unknown): void {
    if (node === null || typeof node !== 'object') return;
    const n = node as {type?: unknown; attrs?: Record<string, unknown>; content?: unknown};

    if (n.type === 'video' && n.attrs?.['sourceType'] === 'upload') {
      const assetId = n.attrs?.['assetId'];
      if (typeof assetId === 'string' && assetId) {
        counts.set(assetId, (counts.get(assetId) ?? 0) + 1);
      }
    }

    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
    }
  }

  walk(content);
  return counts;
}

export interface VideoAssetRefDiff {
  /** 次数增加的 assetId → 增加的次数（需要补 `acquireVideoRef`） */
  acquired: Map<string, number>;
  /** 次数减少的 assetId → 减少的次数（需要 `releaseVideoRef`） */
  released: Map<string, number>;
}

/**
 * 比较"更新前内容"与"更新后内容"里每个 assetId 的出现次数，得出需要增加/减少的引用
 * 计数差值（见 design.md 决策 2、tasks.md 3.4）。`oldContent` 为 `undefined` 时视为
 * "此前没有内容"（如恢复到一个更早版本时不需要这个场景，但保留通用性）。
 */
export function diffVideoAssetOccurrences(
  oldContent: unknown,
  newContent: unknown
): VideoAssetRefDiff {
  const oldCounts = countVideoAssetOccurrences(oldContent);
  const newCounts = countVideoAssetOccurrences(newContent);
  const acquired = new Map<string, number>();
  const released = new Map<string, number>();

  const allAssetIds = new Set([...oldCounts.keys(), ...newCounts.keys()]);
  for (const assetId of allAssetIds) {
    const before = oldCounts.get(assetId) ?? 0;
    const after = newCounts.get(assetId) ?? 0;
    if (after > before) acquired.set(assetId, after - before);
    if (after < before) released.set(assetId, before - after);
  }

  return {acquired, released};
}
