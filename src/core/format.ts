// 顯示用文字：日期、持續時間、重複規則。
import type { Repeat, RepeatUnit, TodoStatus } from './types.ts';

export const STATUS_LABELS: Record<TodoStatus, string> = { enabled: '啟用', disabled: '停用', done: '已完成' };

export const UNIT_LABELS: Record<RepeatUnit, string> = { minute: '分鐘', hour: '小時', day: '天', week: '週', month: '個月' };

const pad = (n: number) => String(n).padStart(2, '0');

/** 表單與詳細資料用的完整格式：2026-11-10 14:00 */
export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 清單與狀態列用的短格式：今天 14:00／明天 09:30／11/12 14:00／2027/01/05 14:00 */
export function formatShort(ms: number, now: number): string {
  const d = new Date(ms);
  const today = new Date(now);
  const dayDiff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000,
  );
  const clock = formatClock(ms);
  if (dayDiff === 0) {
    return `今天 ${clock}`;
  }
  if (dayDiff === 1) {
    return `明天 ${clock}`;
  }
  if (dayDiff === -1) {
    return `昨天 ${clock}`;
  }
  const date = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  return d.getFullYear() === today.getFullYear() ? `${date} ${clock}` : `${d.getFullYear()}/${date} ${clock}`;
}

export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) {
    return `${m} 分鐘`;
  }
  return m === 0 ? `${h} 小時` : `${h} 小時 ${m} 分鐘`;
}

export function describeRepeat(repeat: Repeat | null): string {
  if (!repeat) {
    return '不重複';
  }
  const unit = UNIT_LABELS[repeat.unit];
  const every = repeat.every === 1 ? `每${unit === '個月' ? '月' : unit}` : `每 ${repeat.every} ${unit}`;
  switch (repeat.end.kind) {
    case 'never':
      return `${every}，不停止`;
    case 'count':
      return `${every}，共 ${repeat.end.count} 次`;
    case 'until':
      return `${every}，至 ${formatDateTime(repeat.end.until)}`;
  }
}

/** Markdown 的第一行純文字，給通知內文與狀態列 tooltip 用。 */
export function firstLine(markdown: string, max = 120): string {
  const line =
    markdown
      .split('\n')
      .map((l) => l.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+|>\s*)/, '').replace(/[*_`~]/g, '').trim())
      .find((l) => l.length > 0) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
