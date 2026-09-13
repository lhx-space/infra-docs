import {type SearchResult, search as searchRequest} from '@luhanxin/api-client';
import {create} from 'zustand';
import {toErrorMessage} from '../lib/errors';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface SearchState {
  results: SearchResult | null;
  status: LoadStatus;
  error: string | null;
  search: (keyword: string) => Promise<void>;
  reset: () => void;
}

export const useSearchStore = create<SearchState>(set => ({
  results: null,
  status: 'idle',
  error: null,

  search: async keyword => {
    const q = keyword.trim();
    if (!q) {
      set({results: null, status: 'idle', error: null});
      return;
    }
    set({status: 'loading', error: null});
    try {
      const results = await searchRequest(q);
      set({results, status: 'ready'});
    } catch (err) {
      set({error: toErrorMessage(err, '搜索失败，请稍后重试'), status: 'error'});
    }
  },

  reset: () => set({results: null, status: 'idle', error: null})
}));
