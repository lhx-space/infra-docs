import type {HttpMethod} from './types';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 8000;

/** 5xx 服务端瞬时故障 + 429 限流，都是"值得重试"的响应状态；4xx 里其余状态码是业务错误，不重试 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * 只对幂等方法开放自动重试：`GET`/`PUT`/`DELETE` 重复执行结果一致，重试是安全的；
 * `POST` 默认不是幂等的（如"创建"类接口），重试可能导致重复副作用（如重复创建记录），
 * 因此不纳入自动重试范围——除非未来引入 Idempotency-Key 机制，否则不应该对 POST 重试。
 */
const IDEMPOTENT_METHODS = new Set<HttpMethod>(['GET', 'PUT', 'DELETE']);

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/** 可被 signal 中断的 sleep：等待期间调用方 abort 了，立即 reject，不会傻等 backoff 结束 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      {once: true}
    );
  });
}

/** 解析 429 响应的 `Retry-After` 头：可能是秒数，也可能是 HTTP 日期，解析失败返回 null 走默认退避 */
function parseRetryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(header);
  return Number.isNaN(dateMs) ? null : Math.max(0, dateMs - Date.now());
}

/** 指数退避：1s → 2s → 4s，封顶 8s，避免服务端本来就在恢复中还被越来越猛地打 */
function computeBackoffMs(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
}

/**
 * 对"网络层瞬时故障"做有限次数重试，只对幂等方法生效：
 * - 5xx（500/502/503/504）：服务端瞬时故障，指数退避后重试
 * - 429：遵守 `Retry-After`，不自己瞎猜等待时间；没有该头时退回指数退避
 * - `fetch` 抛出的网络异常（断网/DNS 失败等）：视为跟 5xx 同等的"不确定是否执行成功"情况，一样重试
 *
 * 全程遵守 `signal`：重试等待中途被 abort，立即停止并抛出 abort 错误；主动取消不算"网络故障"，
 * 不计入重试次数、不重试。
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  method: HttpMethod
): Promise<Response> {
  const retryable = IDEMPOTENT_METHODS.has(method);
  let attempt = 0;

  while (true) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      if (isAbortError(err) || !retryable || attempt >= MAX_RETRIES) throw err;
      attempt += 1;
      await sleep(computeBackoffMs(attempt), init.signal as AbortSignal | undefined);
      continue;
    }

    if (!retryable || !RETRYABLE_STATUS.has(response.status) || attempt >= MAX_RETRIES) {
      return response;
    }

    attempt += 1;
    const retryAfterMs = response.status === 429 ? parseRetryAfterMs(response) : null;
    await sleep(retryAfterMs ?? computeBackoffMs(attempt), init.signal as AbortSignal | undefined);
  }
}
