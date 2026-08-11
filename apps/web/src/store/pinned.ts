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

  isWikiPinned: wikiId => get().pinnedWikiIds.includes(wikiId)
}));
