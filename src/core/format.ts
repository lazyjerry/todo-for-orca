// 顯示用文字：日期、持續時間、重複規則。
import { type Lang, messages } from './i18n.ts';
import type { Repeat } from './types.ts';

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
export function formatShort(ms: number, now: number, lang: Lang): string {
  const t = messages(lang);
  const d = new Date(ms);
  const today = new Date(now);
  const dayDiff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000,
  );
  const clock = formatClock(ms);
  if (dayDiff === 0) {
    return t.today(clock);
  }
  if (dayDiff === 1) {
    return t.tomorrow(clock);
  }
  if (dayDiff === -1) {
    return t.yesterday(clock);
  }
  const date = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  return d.getFullYear() === today.getFullYear() ? `${date} ${clock}` : `${d.getFullYear()}/${date} ${clock}`;
}

export function formatDuration(min: number, lang: Lang): string {
  const t = messages(lang);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) {
    return t.minutes(m);
  }
  return m === 0 ? t.hours(h) : t.hoursMinutes(h, m);
}

export function describeRepeat(repeat: Repeat | null, lang: Lang): string {
  const t = messages(lang);
  if (!repeat) {
    return t.repeatNone;
  }
  const every = t.repeatEvery(repeat.every, repeat.unit);
  switch (repeat.end.kind) {
    case 'never':
      return t.repeatNever(every);
    case 'count':
      return t.repeatCount(every, repeat.end.count);
    case 'until':
      return t.repeatUntil(every, formatDateTime(repeat.end.until));
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
