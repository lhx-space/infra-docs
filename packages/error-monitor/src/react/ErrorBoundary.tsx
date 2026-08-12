import {Component, type ErrorInfo, type ReactNode} from 'react';
import {dispatchError} from '../core/dispatch';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * 兜底 UI：可以是静态节点，也可以是根据具体错误定制展示内容的渲染函数（见
   * spec.md「支持自定义兜底内容」）。
   */
  fallback: ReactNode | ((error: Error) => ReactNode);
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * React 渲染错误的局部捕获（见 spec.md「React 渲染错误的局部捕获与自定义兜底 UI」）。
 * 只能捕获子树渲染阶段/生命周期方法/构造函数抛出的错误——事件处理函数、异步代码里的
 * 错误不在这个组件的能力范围内，那部分由 `core/listeners.ts` 挂的全局监听器兜底
 * （见 design.md Context，这也是这次要补的核心动机）。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {error: null};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {error};
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    dispatchError({
      source: 'render',
      level: 'error',
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined
    });
  }

  render(): ReactNode {
    const {error} = this.state;
    if (error) {
      return typeof this.props.fallback === 'function'
        ? this.props.fallback(error)
        : this.props.fallback;
    }
    return this.props.children;
  }
}
