import type {ErrorReport, Reporter} from './types';

/**
 * 内置的上报出口：直接把结构化的 `ErrorReport` 对象打进浏览器控制台（见 design.md
 * 决策 5——不拼接成字符串，方便在控制台展开查看完整字段，也方便对照未来 `HttpReporter`
 * 要传的请求体结构）。
 *
 * 这是过渡占位方案：接后端上报接口后应同步评估是否要在生产环境移除/降级（见 design.md
 * 「Open Questions」）。
 */
export class ConsoleReporter implements Reporter {
  report(report: ErrorReport): void {
    console.log('[error-monitor]', report);
  }
}
