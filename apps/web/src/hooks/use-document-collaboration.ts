import type {CollaborationStatus} from '@luhanxin/tiptap-editor';
import {useEffect, useRef, useState} from 'react';
import {IndexeddbPersistence} from 'y-indexeddb';
import {WebsocketProvider} from 'y-websocket';
import * as Y from 'yjs';
import {useAuthStore} from '@/store/auth';

const COLLAB_WS_URL = import.meta.env.VITE_COLLAB_WS_URL;

export interface DocumentCollaboration {
  document: Y.Doc;
  provider: WebsocketProvider;
  status: CollaborationStatus;
  reconnect: () => void;
}

interface CollaborationRefs {
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  persistence: IndexeddbPersistence;
  synced: boolean;
}

/**
 * 给指定文档创建/维护一份实时协同连接（`Y.Doc` + 标准 `y-websocket` Provider +
 * `y-indexeddb` 离线缓存），供 `DocumentEditorPage` 传给 `DocumentEditor` 的
 * `collaboration` prop 使用（见 yjs-realtime-collaboration design.md 决策 8、
 * tasks.md 5.1/5.2/5.3）。
 *
 * - 连接地址指向 `apps/collab-server`，房间名直接用 `documentId`（对齐 Rust 侧
 *   `Document.id` 作为房间标识的约定，见 design.md 决策 4）；鉴权走 URL query
 *   参数携带当前 `accessToken`（Rust 侧 `handler::ws::upgrade` 从这里读取）。
 * - access token 刷新后（复用 `store/auth.ts` 现有的 `scheduleBackgroundRefresh`
 *   时机——这里不新增第二套定时器，只是响应 `accessToken` 这个已有状态的变化）
 *   同步更新 provider 的连接参数并重连，不需要重建整个 `Y.Doc`/离线缓存。
 * - 离线场景：`y-indexeddb` 持久化跟 `Y.Doc` 生命周期绑定，即使 WebSocket 从未
 *   连接成功（比如完全离线打开这篇文档），本地此前缓存过的状态依然能被
 *   `IndexeddbPersistence` 异步加载进 `Y.Doc`，编辑器仍然能展示最近一次同步过的
 *   内容（只读，由页面层的 `editable`/`offline` prop 控制，不受这里影响）。
 */
export function useDocumentCollaboration(
  documentId: string | undefined
): DocumentCollaboration | null {
  const accessToken = useAuthStore(state => state.accessToken);
  const [status, setStatus] = useState<CollaborationStatus>('connecting');
  const [ready, setReady] = useState(false);
  const stateRef = useRef<CollaborationRefs | null>(null);

  // 这个 effect 只依赖 documentId：内部读取 token 用的是 `useAuthStore.getState()`
  // 非响应式取值，不是上面的响应式 `accessToken` 变量，所以本来就不该把它列进依赖——
  // token 变化的重连逻辑由下面单独的 effect 处理（见其注释），这里不能重复响应
  // accessToken 变化，否则每次静默刷新都会重建整个 Y.Doc/IndexeddbPersistence，
  // 丢失尚未同步的本地状态订阅。
  useEffect(() => {
    if (!documentId) return;

    const ydoc = new Y.Doc();
    const persistence = new IndexeddbPersistence(`yjs-docs:document:${documentId}`, ydoc);
    const provider = new WebsocketProvider(COLLAB_WS_URL, documentId, ydoc, {
      params: {token: useAuthStore.getState().accessToken ?? ''},
      connect: Boolean(useAuthStore.getState().accessToken)
    });

    const refs: CollaborationRefs = {ydoc, provider, persistence, synced: false};
    stateRef.current = refs;

    function computeStatus(): void {
      if (!provider.wsconnected && !provider.wsconnecting) {
        setStatus('disconnected');
        return;
      }
      setStatus(refs.synced ? 'synced' : 'connecting');
    }

    function onStatus(): void {
      computeStatus();
    }

    function onSync(isSynced: boolean): void {
      refs.synced = isSynced;
      computeStatus();
    }

    provider.on('status', onStatus);
    provider.on('sync', onSync);
    setReady(true);
    setStatus('connecting');

    return () => {
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      provider.destroy();
      persistence.destroy();
      ydoc.destroy();
      stateRef.current = null;
      setReady(false);
      setStatus('connecting');
    };
  }, [documentId]);

  useEffect(() => {
    const refs = stateRef.current;
    if (!refs || !accessToken) return;
    if (refs.provider.params['token'] === accessToken) return;
    refs.provider.disconnect();
    refs.provider.params = {token: accessToken};
    refs.provider.connect();
  }, [accessToken]);

  function reconnect(): void {
    const refs = stateRef.current;
    if (!refs) return;
    refs.provider.disconnect();
    const token = useAuthStore.getState().accessToken;
    if (token) refs.provider.params = {token};
    refs.provider.connect();
  }

  if (!ready || !stateRef.current) return null;
  return {
    document: stateRef.current.ydoc,
    provider: stateRef.current.provider,
    status,
    reconnect
  };
}
