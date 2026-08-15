import type {IndexeddbPersistence} from 'y-indexeddb';
import type {WebsocketProvider} from 'y-websocket';
import type * as Y from 'yjs';

export interface CollaborationConnection {
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  persistence: IndexeddbPersistence;
}

interface PooledConnection extends CollaborationConnection {
  refCount: number;
  teardownTimer: ReturnType<typeof setTimeout> | null;
}

const pool = new Map<string, PooledConnection>();

/**
 * 按 `documentId` 复用协同连接（`Y.Doc` + `WebsocketProvider` + `IndexeddbPersistence`），
 * 给 `useDocumentCollaboration` 用，解决 React StrictMode 下"挂载→卸载→再挂载"（开发模式
 * 故意的双重调用 effect，用来帮你发现漏写的清理逻辑）导致的一个真实但良性的噪音：原来的写法
 * 每次挂载都新建一个 `WebsocketProvider`，紧接着的模拟卸载又立刻把它 `destroy()`——这时候
 * 浏览器原生的 WebSocket 握手往往还没完成，就会打印
 * `"WebSocket is closed before the connection is established"`。
 *
 * 跟 `network/dedupe.ts` 的 Singleflight（多个并发调用共享同一个 in-flight Promise）解决的
 * 是同一类问题（"同一时刻的重复调用不应该产生两份真实的副作用"），但 WebSocket 连接不是
 * 一次性的请求-响应，是长生命周期的有状态资源，不能等它"落地"就丢弃引用——所以这里换成
 * 带引用计数的连接池：`acquire` 增加引用计数（如果是复用已有连接，直接返回，不重新创建）；
 * `release` 减少引用计数，降到 0 时**不立即销毁**，而是排到下一个 event loop tick 才真正
 * 销毁。StrictMode 的"卸载→再挂载"是在同一次 effect flush 里同步发生的，`release` 排的
 * 那次销毁还没轮到执行，紧跟着的 `acquire` 就已经把它"认领"回来、取消了这次销毁——整个
 * 过程里从未真正调用过 `provider.destroy()`，也就没有任何 WebSocket 被提前关闭，问题从根上
 * 不会出现，而不是靠事后忽略/过滤这条警告。真实的离开页面（后面不会再有人 `acquire` 同一个
 * `documentId`）则会在下一个 tick 正常触发销毁，只比原来晚了不到一个 tick，用户完全感知不到。
 */
export function acquireCollaborationConnection(
  documentId: string,
  create: () => CollaborationConnection
): CollaborationConnection {
  const existing = pool.get(documentId);
  if (existing) {
    existing.refCount += 1;
    if (existing.teardownTimer !== null) {
      clearTimeout(existing.teardownTimer);
      existing.teardownTimer = null;
    }
    return existing;
  }

  const created = create();
  pool.set(documentId, {...created, refCount: 1, teardownTimer: null});
  return created;
}

export function releaseCollaborationConnection(documentId: string): void {
  const entry = pool.get(documentId);
  if (!entry) return;

  entry.refCount -= 1;
  if (entry.refCount > 0) return;

  entry.teardownTimer = setTimeout(() => {
    // 排队等待的这段时间里，如果又被 `acquireCollaborationConnection` 重新认领
    // （典型场景就是 StrictMode 的同步重新挂载），`refCount` 会变回正数，这里必须
    // 重新检查一次，不能假设"进了这个回调就一定该销毁"。
    const current = pool.get(documentId);
    if (!current || current.refCount > 0) return;
    pool.delete(documentId);
    current.provider.destroy();
    current.persistence.destroy();
    current.ydoc.destroy();
  }, 0);
}
