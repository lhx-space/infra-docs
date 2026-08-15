import {registerNetworkConnection} from '@luhanxin/error-monitor';
import type {CollaborationStatus} from '@luhanxin/tiptap-editor';
import {useEffect, useRef, useState} from 'react';
import {IndexeddbPersistence} from 'y-indexeddb';
import {WebsocketProvider} from 'y-websocket';
import * as Y from 'yjs';
import {
  acquireCollaborationConnection,
  releaseCollaborationConnection
} from '@/lib/collaboration-connection-pool';
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
 * - 连接的创建/销毁委托给 `lib/collaboration-connection-pool.ts`（带引用计数的连接池），
 *   不在这个 effect 里直接 `new WebsocketProvider(...)`/`.destroy()`——这是为了修一个
 *   React StrictMode 下的真实噪音：开发模式故意的"挂载→卸载→再挂载"会让原来的写法每次
 *   都新建一个 WebSocket、紧接着立刻关掉还没握手完成的那个，浏览器会打印
 *   `"WebSocket is closed before the connection is established"`。换成连接池后，
 *   卸载不会立即销毁，紧跟着的再挂载会直接复用同一个连接、取消这次销毁，过程中不会有
 *   任何 WebSocket 被提前关闭（详见该文件顶部注释）。
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

    const {ydoc, provider, persistence} = acquireCollaborationConnection(documentId, () => {
      const doc = new Y.Doc();
      const persist = new IndexeddbPersistence(`yjs-docs:document:${documentId}`, doc);
      const ws = new WebsocketProvider(COLLAB_WS_URL, documentId, doc, {
        params: {token: useAuthStore.getState().accessToken ?? ''},
        connect: Boolean(useAuthStore.getState().accessToken)
      });
      return {ydoc: doc, provider: ws, persistence: persist};
    });

    stateRef.current = {ydoc, provider, persistence};

    // 不再自己维护一份 `synced` 布尔值——直接读 `provider.synced`（y-websocket 自己
    // 暴露的公开状态），复用连接池里可能"早就已经同步过"的连接时，才能立刻反映真实
    // 状态，而不是每次挂载都从 `false` 重新起步、等下一次真实的同步事件才更新过来。
    function computeStatus(): void {
      if (!provider.wsconnected && !provider.wsconnecting) {
        setStatus('disconnected');
        return;
      }
      setStatus(provider.synced ? 'synced' : 'connecting');
    }

    provider.on('status', computeStatus);
    provider.on('sync', computeStatus);
    setReady(true);
    computeStatus();

    // 把这份协同连接接入 error-monitor 的 `network` 来源（见
    // error-monitor-network-support tasks.md 8.5），这样连接失败/异常关闭在没有任何
    // `ErrorBoundary`/`unhandledrejection` 能接住的情况下也能被上报。`WebsocketProvider`
    // 每次重连都会创建一份全新的原生 `WebSocket`（`.ws` 属性会变化，见
    // node_modules/y-websocket 的 `setupWS`），只有在这里显式跟踪 `.ws` 的变化并重新
    // 注册才能覆盖每一次重连（design.md「Open Questions」：本函数只认原生
    // `WebSocket`/`EventSource` 实例，不理解 `WebsocketProvider` 这层封装）。
    let registeredWs: WebSocket | null = null;
    let unregisterNetwork: (() => void) | undefined;
    function syncNetworkRegistration(): void {
      if (provider.ws === registeredWs) return;
      unregisterNetwork?.();
      registeredWs = provider.ws;
      unregisterNetwork = registeredWs
        ? registerNetworkConnection(registeredWs, 'websocket', `document:${documentId}`)
        : undefined;
    }
    provider.on('status', syncNetworkRegistration);
    syncNetworkRegistration();

    return () => {
      provider.off('status', computeStatus);
      provider.off('sync', computeStatus);
      provider.off('status', syncNetworkRegistration);
      unregisterNetwork?.();
      releaseCollaborationConnection(documentId);
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
