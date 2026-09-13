import {type Document, listDocuments} from '@luhanxin/api-client';
import {create} from 'zustand';
import {buildDocumentTree, type DocumentTreeNode} from '../lib/document-tree';
import {toErrorMessage} from '../lib/errors';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface DocumentState {
  documents: Document[];
  tree: DocumentTreeNode[];
  status: LoadStatus;
  error: string | null;
  load: (wikiId: string) => Promise<void>;
  reset: () => void;
}

export const useDocumentStore = create<DocumentState>(set => ({
  documents: [],
  tree: [],
  status: 'idle',
  error: null,

  load: async wikiId => {
    set({status: 'loading', error: null});
    try {
      const {documents} = await listDocuments(wikiId);
      set({documents, tree: buildDocumentTree(documents), status: 'ready'});
    } catch (err) {
      set({error: toErrorMessage(err), status: 'error'});
    }
  },

  reset: () => set({documents: [], tree: [], status: 'idle', error: null})
}));
