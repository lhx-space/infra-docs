const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前；超过 30 天回退到绝对日期（与 packages/core 一致） */
export function relativeTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

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
