/** 日期/时间展示用的通用格式化工具，供数据看板表格等场景统一使用，避免各组件各自手写。 */

const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 仅日期：2026/09/11 */
export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? DATE_FORMATTER.format(date) : '—';
}

/** 日期 + 时间：2026/09/11 20:47 */
export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? DATE_TIME_FORMATTER.format(date) : '—';
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前；超过 30 天回退到绝对日期 */
export function relativeTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;

  return DATE_FORMATTER.format(date);
}
