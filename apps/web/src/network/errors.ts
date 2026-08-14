/** 非 2xx 响应统一包装成这个错误类抛出，携带 HTTP 状态码和后端返回的错误详情，供调用方按需处理 */
export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;
  /** 从响应头 `x-trace-id` 读取（见 error-monitor-network-support），可跟 `apps/api`
   * 同一请求的服务端结构化日志行关联，排查时不必再靠时间戳硬凑。 */
  readonly traceId?: string;

  constructor(status: number, message: string, details?: unknown, traceId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.traceId = traceId;
  }
}
