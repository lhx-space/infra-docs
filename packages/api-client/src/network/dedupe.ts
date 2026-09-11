/**
 * 通用请求去重（Singleflight）工具。
 *
 * 同一个 `key` 在结果落地（成功或失败）之前的所有并发调用，全部复用同一个
 * in-flight Promise，只有第一次真正执行 `factory`；结果落地后立即清除缓存，
 * 下一次调用会重新触发一次全新的请求——不是"缓存结果"，只是"合并同一时刻的并发调用"。
 *
 * 适用场景：幂等、无副作用、多个调用方拿到的结果理应一致的请求（如查询用户资料、
 * 刷新 access token）。不适合"每次调用语义都不同、后来者应该取消前者"的场景
 * （如搜索框输入变化），那种场景应该用 AbortController 取消，而不是在这里去重共享。
 */
const inflight = new Map<string, Promise<unknown>>();

export function dedupe<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = factory().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}
