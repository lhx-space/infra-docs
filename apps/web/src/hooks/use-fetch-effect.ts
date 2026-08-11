import {useEffect} from 'react';

/**
 * 在依赖变化时发起一次异步请求，并自动处理"过期结果不应生效"的竞态问题：
 * 依赖变化或组件卸载后，尚未完成的请求的结果会被丢弃，不会触发 `onData`。
 *
 * 用来替代每个"在 effect 里发请求"的组件里手写的 `let ignore = false` + cleanup 样板代码——
 * 这类竞态防护属于系统性问题，应该在这一个地方解决一次，而不是每个组件各自重新实现一遍。
 *
 * 注意：这个 hook 只管"结果要不要生效"这一层竞态问题，不管"要不要真的发起网络请求"——
 * 后者（如 StrictMode 下 effect 双调用只应产生一次真实请求）由 `network/` 模块的
 * `http.get` 自动去重负责，两者分别在各自的层级解决，不要混在一起。
 *
 * @param fetcher 发起请求的函数，每次依赖变化时会被调用一次
 * @param onData 请求成功且结果未过期时调用
 * @param deps 依赖数组，语义与 `useEffect` 一致
 * @param enabled 为 `false` 时跳过本次请求（如依赖尚未就绪），默认 `true`
 */
export function useFetchEffect<T>(
  fetcher: () => Promise<T>,
  onData: (data: T) => void,
  deps: unknown[],
  enabled = true
): void {
  // 刻意只让调用方传入的 deps 决定何时重新请求；fetcher/onData/enabled 通常是调用方
  // 每次渲染新建的匿名函数/字面量，加进依赖数组会导致每次渲染都重新请求，这正是本 hook
  // 存在的意义（见上面 JSDoc @param deps 说明）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 见上方注释，fetcher/onData/enabled 刻意不进依赖数组
  useEffect(() => {
    if (!enabled) return;

    let ignore = false;
    fetcher()
      .then(data => {
        if (!ignore) onData(data);
      })
      .catch(() => {});

    return () => {
      ignore = true;
    };
    // deps 由调用方保证完整性并透传给 useEffect；用 [...deps] 包成数组字面量语法，
    // 满足 biome useExhaustiveDependencies 规则对"依赖列表必须是数组字面量"的静态检查要求，
    // 语义与直接传 deps 完全一致（React 按下标逐一比较，不关心外层数组的引用）。
  }, [...deps]);
}
