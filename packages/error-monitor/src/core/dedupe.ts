import type {DedupeOptions, ErrorReport} from './types';

interface DedupeEntry {
  count: number;
  timer: ReturnType<typeof setTimeout>;
}

/** 最多同时跟踪的错误种类数——超出后淘汰最早创建的一条（近似 LRU，不追求精确），
 * 防止长时间运行的 SPA 页面因为错误种类持续变化而让这个 Map 无限增长（见 design.md
 * Risks）。 */
const MAX_TRACKED_FINGERPRINTS = 200;

/** 默认去重时间窗口：10 秒内的重复错误合并成一条汇总。 */
export const DEFAULT_DEDUP_WINDOW_MS = 10_000;

/**
 * 按错误的 `message` + 堆栈（`componentStack` 优先，没有则用 `stack`）首行拼出一个简单的
 * 去重标识——不追求密码学强度的哈希，只要相同错误多次出现时能落到同一个 key 上即可
 * （见 design.md 决策 3）。
 */
export function computeFingerprint(
  report: Pick<ErrorReport, 'source' | 'message' | 'stack' | 'componentStack'>
): string {
  const stackFirstLine = (report.componentStack ?? report.stack ?? '').split('\n')[0]?.trim() ?? '';
  return `${report.source}::${report.message}::${stackFirstLine}`;
}

/**
 * 去重/节流管理器（见 spec.md「错误去重与节流」、design.md 决策 3）：同一个 fingerprint
 * 在时间窗口内第一次出现立即放行（不丢第一次现场），窗口内后续重复只计数、不重复调用
 * `send`，窗口结束时补一条附带累计次数的汇总记录。`windowMs` 传 `false` 时完全不做
 * 去重，每次调用 `handle` 都会立即放行。
 *
 * `maxCountPerWindow`：计数达到这个值就不再等窗口到期，立即结束窗口、发出汇总——避免
 * 死循环场景下 `occurrences` 涨到一个没有实际意义的天文数字，也能让"这个错误正在疯狂
 * 重复"这个信号更快被看到。
 *
 * `shouldDedupe`：每条报告分发时都会先问一遍这个钩子，返回 `false` 就完全跳过 fingerprint
 * 分桶、直接放行——用于"这条错误业务上认为每次都要看到"的场景。`handle` 的第三个参数
 * `forceBypass` 是调用点级别（`reportError(..., {dedupe: false})`）的覆盖，优先级比
 * `shouldDedupe` 钩子更高，两者任一成立都会跳过去重。
 */
export function createDeduper(options: DedupeOptions) {
  const windowMs = options.windowMs ?? DEFAULT_DEDUP_WINDOW_MS;
  const {maxCountPerWindow, shouldDedupe} = options;
  const tracked = new Map<string, DedupeEntry>();

  function evictOldestIfFull(): void {
    if (tracked.size < MAX_TRACKED_FINGERPRINTS) return;
    const oldestKey = tracked.keys().next().value;
    if (oldestKey === undefined) return;
    const oldestEntry = tracked.get(oldestKey);
    if (oldestEntry) clearTimeout(oldestEntry.timer);
    tracked.delete(oldestKey);
  }

  function flush(
    fingerprint: string,
    report: ErrorReport,
    send: (report: ErrorReport) => void
  ): void {
    const entry = tracked.get(fingerprint);
    if (!entry) return;
    clearTimeout(entry.timer);
    tracked.delete(fingerprint);
    if (entry.count > 1) {
      send({...report, occurrences: entry.count});
    }
  }

  function handle(
    report: ErrorReport,
    send: (report: ErrorReport) => void,
    forceBypass = false
  ): void {
    if (windowMs === false || forceBypass || shouldDedupe?.(report) === false) {
      send(report);
      return;
    }

    const fingerprint = computeFingerprint(report);
    const existing = tracked.get(fingerprint);

    if (existing) {
      existing.count += 1;
      // 窗口内重复出现：只计数，等窗口结束时统一补一条汇总，不重复调用 send——除非
      // 达到了 maxCountPerWindow，那就不等窗口到期了，直接提前收尾。
      if (maxCountPerWindow !== undefined && existing.count >= maxCountPerWindow) {
        flush(fingerprint, report, send);
      }
      return;
    }

    evictOldestIfFull();

    const timer = setTimeout(() => flush(fingerprint, report, send), windowMs);
    tracked.set(fingerprint, {count: 1, timer});
    send(report);
  }

  return {handle};
}

export type Deduper = ReturnType<typeof createDeduper>;
