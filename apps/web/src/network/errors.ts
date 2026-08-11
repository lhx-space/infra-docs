/** 非 2xx 响应统一包装成这个错误类抛出，携带 HTTP 状态码和后端返回的错误详情，供调用方按需处理 */
export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}
