import {create} from 'zustand';

const STORAGE_KEY = 'pinned-wiki-ids';

function readStoredIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function persist(ids: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

interface PinnedState {
  pinnedWikiIds: string[];
  togglePinWiki: (wikiId: string) => void;
  isWikiPinned: (wikiId: string) => boolean;
  pruneMissingWikis: (existingIds: string[]) => void;
}

/** 已置顶（Pin）的 Wiki id 列表，持久化到 localStorage，供 Sidebar 展示置顶列表 */
export const usePinnedStore = create<PinnedState>((set, get) => ({
  pinnedWikiIds: readStoredIds(),

  togglePinWiki: wikiId => {
    const current = get().pinnedWikiIds;
    const next = current.includes(wikiId)
      ? current.filter(id => id !== wikiId)
      : [...current, wikiId];
    persist(next);
    set({pinnedWikiIds: next});
  },

  isWikiPinned: wikiId => get().pinnedWikiIds.includes(wikiId),

  /**
   * 把不在 existingIds 里的置顶记录全部清掉——工作区可能因为被删除、或当前用户被移出成员
   * 而从可见列表里消失，这两种情况都会导致 Sidebar 原本用"找不到就显示原始 id"兜底的展示
   * 方式变成永久残留的裸 UUID。统一在 `useWikiStore.fetchWikis()` 成功后调用一次，
   * 不需要在每个"让 Wiki 消失"的操作里各自打补丁（见 wiki-workspace-fixes design.md 决策 1）。
   */
  pruneMissingWikis: existingIds => {
    const current = get().pinnedWikiIds;
    const next = current.filter(id => existingIds.includes(id));
    if (next.length === current.length) return;
    persist(next);
    set({pinnedWikiIds: next});
  }
}));
