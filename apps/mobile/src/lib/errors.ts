import {ApiError} from '@luhanxin/api-client';

/** 把任意异常翻译成用户可读文案；列表类请求只做通用的兜底（业务错误码不在此展开） */
export function toErrorMessage(error: unknown, fallback = '加载失败，请稍后重试'): string {
  if (error instanceof ApiError && error.status === 401) {
    return '登录状态已失效，请重新登录';
  }
  return fallback;
}
