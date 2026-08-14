import type {ErrorReport} from './types';

/**
 * `HttpReporter` 的本地持久化队列（见 error-monitor-network-support design.md 决策 6：
 * 可靠性靠持久化队列 + 下次启动补发，不靠"选对卸载瞬间的传输 API"）。三层降级：
 * `IndexedDB` 为主，不可用时退化到 `localStorage`，两者都不可用时退化为纯内存队列
 * （只在当前页面生命周期内有效，这一层丢失风险是显式接受的，见 Risks）。
 */
export interface QueueItem {
  report: ErrorReport;
  /** 写入队列的时间，用于 `maxAgeMs` 过期清理，避免长期离线导致队列无限增长。 */
  enqueuedAt: number;
}

export interface QueueBackend {
  loadAll(): Promise<QueueItem[]>;
  /** 尽最大努力写入，永不抛出——写入失败（比如 `IndexedDB` 配额已满）只打印
   * `console.error`，不影响调用方（`HttpReporter.report()`）继续往下执行。 */
  add(item: QueueItem): void;
  /** 尽最大努力删除，永不抛出，语义同 `add`。 */
  remove(id: string): void;
}

/**
 * 存储标识可配置——默认值只是"单个 `HttpReporter` 实例"这个最常见场景的合理默认，
 * 不应该被写死。同一页面里如果对接了多个不同 `endpoint` 的 `HttpReporter` 实例
 * （比如分别上报给两个不同的后端），各自传入不同的值就能拿到互不干扰的独立队列，
 * 不会因为共用同一个 `IndexedDB`/`localStorage` key 而互相覆盖对方尚未发送成功的
 * 报告——只有一个实例时不传，用默认值即可，不强制消费方关心这个细节。
 */
export interface PersistentQueueOptions {
  /** `IndexedDB` 数据库名。 */
  dbName?: string;
  /** `IndexedDB` object store 名。 */
  storeName?: string;
  /** `localStorage` 兜底时使用的 key。 */
  localStorageKey?: string;
}

const DEFAULT_DB_NAME = '__error_monitor_http_reporter__';
const DEFAULT_STORE_NAME = 'queue';
const DEFAULT_LOCAL_STORAGE_KEY = '__error_monitor_http_reporter_queue__';

function createIndexedDbBackend(dbName: string, storeName: string): QueueBackend {
  let dbPromise: Promise<IDBDatabase | null> | undefined;

  function getDb(): Promise<IDBDatabase | null> {
    dbPromise ??= new Promise(resolve => {
      try {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(storeName)) {
            req.result.createObjectStore(storeName, {keyPath: 'report.id'});
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return dbPromise;
  }

  return {
    async loadAll() {
      const db = await getDb();
      if (!db) return [];
      return new Promise(resolve => {
        try {
          const tx = db.transaction(storeName, 'readonly');
          const req = tx.objectStore(storeName).getAll();
          req.onsuccess = () => resolve((req.result as QueueItem[] | undefined) ?? []);
          req.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      });
    },
    add(item) {
      void getDb().then(db => {
        if (!db) return;
        try {
          db.transaction(storeName, 'readwrite').objectStore(storeName).put(item);
        } catch (err) {
          console.error('[error-monitor] failed to persist report to IndexedDB', err);
        }
      });
    },
    remove(id) {
      void getDb().then(db => {
        if (!db) return;
        try {
          db.transaction(storeName, 'readwrite').objectStore(storeName).delete(id);
        } catch (err) {
          console.error('[error-monitor] failed to remove report from IndexedDB', err);
        }
      });
    }
  };
}

function readLocalStorageQueue(localStorageKey: string): QueueItem[] {
  try {
    const raw = localStorage.getItem(localStorageKey);
    return raw ? (JSON.parse(raw) as QueueItem[]) : [];
  } catch {
    return [];
  }
}

function writeLocalStorageQueue(localStorageKey: string, items: QueueItem[]): void {
  try {
    localStorage.setItem(localStorageKey, JSON.stringify(items));
  } catch (err) {
    console.error('[error-monitor] failed to persist queue to localStorage', err);
  }
}

function createLocalStorageBackend(localStorageKey: string): QueueBackend {
  return {
    async loadAll() {
      return readLocalStorageQueue(localStorageKey);
    },
    add(item) {
      const items = readLocalStorageQueue(localStorageKey);
      items.push(item);
      writeLocalStorageQueue(localStorageKey, items);
    },
    remove(id) {
      writeLocalStorageQueue(
        localStorageKey,
        readLocalStorageQueue(localStorageKey).filter(i => i.report.id !== id)
      );
    }
  };
}

function createMemoryBackend(): QueueBackend {
  let items: QueueItem[] = [];
  return {
    async loadAll() {
      return items.slice();
    },
    add(item) {
      items.push(item);
    },
    remove(id) {
      items = items.filter(i => i.report.id !== id);
    }
  };
}

function isLocalStorageAvailable(): boolean {
  try {
    const probeKey = '__error_monitor_probe__';
    localStorage.setItem(probeKey, '1');
    localStorage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

/** 探测当前环境能力，选出可用的最优后端（见上方类型注释的三层降级策略）。非浏览器
 * 环境（`typeof window === 'undefined'`，比如未来某天核心逻辑被用在 Node 环境）直接
 * 退化为内存队列。不传 `options` 时用一组固定的默认存储标识——单个 `HttpReporter`
 * 实例场景下这就够了。 */
export function createQueueBackend(options: PersistentQueueOptions = {}): QueueBackend {
  const dbName = options.dbName ?? DEFAULT_DB_NAME;
  const storeName = options.storeName ?? DEFAULT_STORE_NAME;
  const localStorageKey = options.localStorageKey ?? DEFAULT_LOCAL_STORAGE_KEY;

  if (typeof window === 'undefined') return createMemoryBackend();
  if (typeof indexedDB !== 'undefined') return createIndexedDbBackend(dbName, storeName);
  if (typeof localStorage !== 'undefined' && isLocalStorageAvailable()) {
    return createLocalStorageBackend(localStorageKey);
  }
  return createMemoryBackend();
}
