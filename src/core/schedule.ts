// 場次計算：第 k 次的開始時間 = startAt 依重複單位往後推 k * every。
import type { Repeat, Todo } from './types.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type Timed = Pick<Todo, 'startAt' | 'repeat'>;

/** 月份加法：31 號遇到小月時落在月底，不溢位到下個月。 */
function addMonths(ms: number, months: number): number {
  const d = new Date(ms);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.getTime();
}

/** 天、週用本地日期加法，跨日光節約時間仍維持同一個鐘點。 */
export function occurrence(start: number, repeat: Repeat | null, k: number): number {
  if (!repeat || k === 0) {
    return start;
  }
  const n = k * repeat.every;
  switch (repeat.unit) {
    case 'minute':
      return start + n * MINUTE;
    case 'hour':
      return start + n * HOUR;
    case 'day':
    case 'week': {
      const d = new Date(start);
      d.setDate(d.getDate() + (repeat.unit === 'week' ? 7 * n : n));
      return d.getTime();
    }
    case 'month':
      return addMonths(start, n);
  }
}

function approxStep(repeat: Repeat): number {
  const unit = { minute: MINUTE, hour: HOUR, day: DAY, week: 7 * DAY, month: 28 * DAY }[repeat.unit];
  return unit * repeat.every;
}

/** 不考慮停止條件時，開始時間 ≤ t 的最後一場；t 早於第一場回 -1。 */
function rawIndexAtOrBefore(start: number, repeat: Repeat | null, t: number): number {
  if (t < start) {
    return -1;
  }
  if (!repeat) {
    return 0;
  }
  // 先用近似步長估，再前後微調：月份長短、日光節約只會差幾步
  let k = Math.max(0, Math.floor((t - start) / approxStep(repeat)));
  while (k > 0 && occurrence(start, repeat, k) > t) {
    k--;
  }
  while (occurrence(start, repeat, k + 1) <= t) {
    k++;
  }
  return k;
}

/** 最後一場的索引；不停止或截止時間型回 Infinity（截止另外由時間判斷）。 */
function lastIndex(repeat: Repeat | null): number {
  if (!repeat) {
    return 0;
  }
  return repeat.end.kind === 'count' ? repeat.end.count - 1 : Number.POSITIVE_INFINITY;
}

function exists(todo: Timed & { startAt: number }, k: number): boolean {
  if (k < 0 || k > lastIndex(todo.repeat)) {
    return false;
  }
  const end = todo.repeat?.end;
  return !(end?.kind === 'until' && occurrence(todo.startAt, todo.repeat, k) > end.until);
}

/** 開始時間 ≤ t 的最後一場（含停止條件）；沒有則 null。 */
export function latestAtOrBefore(todo: Timed, t: number): number | null {
  if (todo.startAt === null) {
    return null;
  }
  const end = todo.repeat?.end;
  // 先把 t 截到截止時間，避免截止很久之後還要一步步往回找
  const bound = end?.kind === 'until' ? Math.min(t, end.until) : t;
  const k = Math.min(rawIndexAtOrBefore(todo.startAt, todo.repeat, bound), lastIndex(todo.repeat));
  return k >= 0 ? occurrence(todo.startAt, todo.repeat, k) : null;
}

/** 開始時間 > t 的第一場；沒有後續場次則 null。 */
export function nextAfter(todo: Timed, t: number): number | null {
  if (todo.startAt === null) {
    return null;
  }
  const timed = { ...todo, startAt: todo.startAt };
  const k = rawIndexAtOrBefore(timed.startAt, todo.repeat, t) + 1;
  return exists(timed, k) ? occurrence(timed.startAt, todo.repeat, k) : null;
}

/** 正在進行的場次：開始 ≤ now < 開始 + 持續時間。沒有持續時間的 todo 不會「正在進行」。 */
export function ongoingAt(todo: Pick<Todo, 'startAt' | 'repeat' | 'durationMin'>, now: number): { start: number; end: number } | null {
  if (todo.durationMin <= 0) {
    return null;
  }
  const start = latestAtOrBefore(todo, now);
  if (start === null) {
    return null;
  }
  const end = start + todo.durationMin * MINUTE;
  return now < end ? { start, end } : null;
}

/** (from, now] 之間最後一場的開始時間：worker 只通知最新的一場，錯過的多場不連發。 */
export function dueBetween(todo: Timed, from: number, now: number): number | null {
  const start = latestAtOrBefore(todo, now);
  return start !== null && start > from ? start : null;
}

export interface Highlights {
  ongoing: { todo: Todo; start: number; end: number }[];
  next: { todo: Todo; at: number } | null;
}

/** 側欄最上方與狀態列要顯示的：啟用中正在進行的全部，以及最近的下一場。 */
export function highlights(todos: readonly Todo[], now: number): Highlights {
  const ongoing: Highlights['ongoing'] = [];
  let next: Highlights['next'] = null;
  for (const todo of todos) {
    if (todo.status !== 'enabled') {
      continue;
    }
    const live = ongoingAt(todo, now);
    if (live) {
      ongoing.push({ todo, ...live });
    }
    const at = nextAfter(todo, now);
    if (at !== null && (!next || at < next.at)) {
      next = { todo, at };
    }
  }
  ongoing.sort((a, b) => a.end - b.end);
  return { ongoing, next };
}
