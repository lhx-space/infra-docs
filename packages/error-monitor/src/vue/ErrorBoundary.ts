import {defineComponent, onErrorCaptured, type PropType, ref, type VNode} from 'vue-demi';
import {dispatchError} from '../core/dispatch';

export type VueErrorBoundaryFallback = VNode | ((error: Error) => VNode | null) | null;

/**
 * Vue 版的渲染错误局部捕获（对应 `/react` 的 `ErrorBoundary`，见 design.md 决策 6）。
 *
 * 用纯 `.ts` + `h()` 渲染函数实现，不写 `.vue` 单文件组件——这样 tsup 不需要引入
 * Vue SFC 编译插件就能直接打包，产物体量和 `/react` 那边的 class 组件对等。
 *
 * 基于 `vue-demi` 桥接 Vue 2.7+ 与 Vue 3 的 Composition API 差异，同一份源码两个大版本
 * 都能用；`vue-demi` 依赖 Composition API，所以 Vue 2 端要求 `>=2.7`（更早的纯 Options API
 * 版本不在覆盖范围内，见 design.md「Open Questions」）。
 */
export const ErrorBoundary = defineComponent({
  name: 'ErrorMonitorErrorBoundary',
  props: {
    /**
     * 兜底 UI：可以是静态的 VNode，也可以是根据具体错误定制展示内容的渲染函数——
     * 跟 `/react` 的 `ErrorBoundary` 的 `fallback` prop 语义一致。
     */
    fallback: {
      type: [Object, Function] as PropType<VueErrorBoundaryFallback>,
      required: true
    }
  },
  setup(props, {slots}) {
    const caughtError = ref<Error | null>(null);

    onErrorCaptured((err, _instance, info) => {
      const error = err instanceof Error ? err : new Error(String(err));
      caughtError.value = error;

      dispatchError({
        source: 'render',
        level: 'error',
        message: error.message,
        stack: error.stack,
        // Vue 没有 React 那样的组件堆栈字符串，`info` 是 Vue 提供的触发场景描述
        // （如 `"render function"`、`"native event handler"`），放进 extra 留痕，
        // 不强行塞进 componentStack 字段（那是专属 React 来源的语义）。
        extra: {info}
      });

      // 返回 false 阻止错误继续向上冒泡到父级 onErrorCaptured / 全局 errorHandler，
      // 语义上对应 React ErrorBoundary 截断异常传播、只在这一层展示 fallback 的效果。
      return false;
    });

    return () => {
      if (caughtError.value) {
        const {fallback} = props;
        return typeof fallback === 'function' ? fallback(caughtError.value) : fallback;
      }
      return slots.default?.() ?? null;
    };
  }
});

export default ErrorBoundary;
