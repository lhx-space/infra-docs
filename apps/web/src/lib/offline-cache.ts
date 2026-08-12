/**
 * 轻量 IndexedDB key-value 封装：缓存已浏览过的 Wiki 列表/文档树/文档内容，供离线只读场景
 * 展示（见 document-editor spec.md「离线只读缓存」）。不引入任何第三方库——只需要
 * "存一个 JSON 值、按 key 取回"这种最基础的能力，原生 `indexedDB` API 完全够用。
 * 任何失败（隐私模式下 IndexedDB 被禁用等）都静默降级，不抛出——离线缓存是体验加分项，
 * 不应该让主流程因为存储层报错。
 */
const DB_NAME = 'yjs-docs-offline-cache';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexeddb_unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function setCache<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // 静默失败，见文件头注释
  }
}

export async function getCache<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb();
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

/** 统一 key 命名，避免各处手写字符串拼接时出现不一致 */
export const offlineCacheKeys = {
  wikiList: () => 'wikis',
  documentTree: (wikiId: string) => `document-tree:${wikiId}`,
  document: (documentId: string) => `document:${documentId}`
};
