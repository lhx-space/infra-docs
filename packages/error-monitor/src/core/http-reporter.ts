import {
  createQueueBackend,
  type PersistentQueueOptions,
  type QueueBackend,
  type QueueItem
} from './persistent-queue';
import type {ErrorReport, Reporter} from './types';

export interface HttpReporterOptions {
  /** 上报接口地址，由消费方配置——`error-monitor` 保持"通用工具库"定位，包本身不
   * 内置任何具体后端地址（见 design.md 决策 7）。 */
  endpoint: string;
  /** 每次发送前调用，获取需要携带的自定义请求头（如鉴权 `Authorization`）。支持
   * 异步，供 token 需要即时刷新的场景使用。 */
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  /** 本地持久化队列最多保留多少条尚未确认送达的报告，超出时丢弃最旧的一批。默认 50。 */
  maxQueueSize?: number;
  /** 队列里的报告超过多久（毫秒）未确认送达就直接丢弃，避免长期离线场景无限堆积。
   * 默认 7 天。 */
  maxAgeMs?: number;
  /** 本地持久化队列的存储标识（`IndexedDB` 数据库/object store 名、`localStorage`
   * 兜底时使用的 key），不传则用一组固定的默认值。同一页面里如果对接了多个不同
   * `endpoint` 的 `HttpReporter` 实例，各自传入不同的值才能拿到互不干扰的独立队列，
   * 否则会共用同一份存储、互相覆盖对方尚未发送成功的报告。 */
  storage?: PersistentQueueOptions;
}

const DEFAULT_MAX_QUEUE_SIZE = 50;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 内置的 HTTP 上报出口（见 error-monitor-network-support design.md 决策 6/7、
 * spec.md「基于本地持久化队列的 HTTP 上报出口」）。可靠性不靠"选对卸载瞬间的传输
 * API"，靠"本地持久化队列 + 下次启动补发"：
 *
 * 1. `report()` 收到报告后先同步调用 `backend.add()` 写入本地持久化队列（不等待任何
 *    网络往返），再尝试发送
 * 2. 发送成功后把这条从队列删除；失败则留在队列里，等下一次触发（页面卸载/下次启动）
 *    再重试
 * 3. 页面隐藏/卸载时（`visibilitychange`/`pagehide`，不用已经不可靠的 `unload`）
 *    机会性地尝试一次 flush——这只是"能发就发"的优化，不是正确性依赖的关键路径
 * 4. 构造时立即读一遍本地队列，重新尝试发送上一次会话未确认送达的报告
 *
 * 发送失败（`fetch` 抛异常或非 2xx）时只 `console.error` 记录，不调用任何会重新触发
 * `dispatchError` 的路径，避免自我循环（见 design.md Risks）。
 */
export class HttpReporter implements Reporter {
  private readonly endpoint: string;
  private readonly getHeaders: HttpReporterOptions['getHeaders'];
  private readonly maxQueueSize: number;
  private readonly maxAgeMs: number;
  private readonly backend: QueueBackend;
  private flushing = false;

  constructor(options: HttpReporterOptions) {
    this.endpoint = options.endpoint;
    this.getHeaders = options.getHeaders;
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.backend = createQueueBackend(options.storage);

    this.attachLifecycleListeners();
    // 应用本次启动时读一遍本地队列，补发上一次会话没确认送达的报告（见 spec.md「应用
    // 下次启动时补发未确认送达的报告」）。
    void this.flushQueue();
  }

  report(report: ErrorReport): void {
    const item: QueueItem = {report, enqueuedAt: Date.now()};
    // 同步写入队列，不等待任何网络往返——这一步跟"页面还能活多久"完全无关（见
    // design.md 决策 6）。
    this.backend.add(item);
    void this.trySend(item);
  }

  private attachLifecycleListeners(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const opportunisticFlush = (): void => {
      void this.flushQueue();
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') opportunisticFlush();
    });
    window.addEventListener('pagehide', opportunisticFlush);
  }

  private async trySend(item: QueueItem): Promise<void> {
    try {
      const customHeaders = await this.getHeaders?.();
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', ...customHeaders},
        body: JSON.stringify(item.report),
        // 见 design.md 决策 6：不引入 `navigator.sendBeacon`，`keepalive` 能同时满足
        // "页面卸载时请求也不会被中断"和"能带自定义鉴权 header"两个需求，正常路径下
        // 使用它也无害，不需要额外区分"是否在卸载瞬间"两套分支。
        keepalive: true
      });
      if (!response.ok) throw new Error(`HttpReporter received status ${response.status}`);
      this.backend.remove(item.report.id);
    } catch (err) {
      // 只记录到控制台，不允许再走回 `dispatchError`——否则上报失败会自我触发新一轮
      // 上报，形成死循环（见 design.md Risks）。报告继续留在本地队列里等待下次重试。
      console.error(
        '[error-monitor] HttpReporter failed to send a report, kept in local queue',
        err
      );
    }
  }

  /** 消费本地持久化队列：清理过期/超限的旧记录，对剩余的逐条重新尝试发送。 */
  private async flushQueue(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const items = await this.backend.loadAll();
      const now = Date.now();

      const fresh: QueueItem[] = [];
      for (const item of items) {
        if (now - item.enqueuedAt > this.maxAgeMs) {
          this.backend.remove(item.report.id);
        } else {
          fresh.push(item);
        }
      }

      const overflow = fresh.length - this.maxQueueSize;
      const toSend = overflow > 0 ? fresh.slice(overflow) : fresh;
      if (overflow > 0) {
        for (const item of fresh.slice(0, overflow)) this.backend.remove(item.report.id);
      }

      for (const item of toSend) {
        await this.trySend(item);
      }
    } finally {
      this.flushing = false;
    }
  }
}
