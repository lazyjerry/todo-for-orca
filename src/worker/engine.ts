// 定時檢查的計算：該送哪些通知、狀態列顯示什麼。純函式，時間由呼叫端給。
import { describeRepeat, firstLine, formatClock, formatDateTime, formatDuration, formatShort } from '../core/format.ts';
import { dueBetween, highlights, nextAfter, ongoingAt } from '../core/schedule.ts';
import type { Todo } from '../core/types.ts';

/** 晚於場次開始這麼久才送出的通知，標成「錯過的提醒」（例如 Orca 關著的期間）。 */
const LATE_MS = 2 * 60_000;
/** 狀態列文字與 tooltip 的上限（manifest 規格）。 */
const BAR_TEXT_MAX = 64;
const BAR_TOOLTIP_MAX = 256;

export interface Reminder {
  id: string;
  title: string;
  body: string;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 每筆啟用、有開啟通知的 todo，只通知 (notifiedThrough, now] 內最新的一場。 */
export function dueReminders(todos: readonly Todo[], now: number): Reminder[] {
  const out: Reminder[] = [];
  for (const todo of todos) {
    if (todo.status !== 'enabled' || !todo.notify) {
      continue;
    }
    const start = dueBetween(todo, todo.notifiedThrough, now);
    if (start === null) {
      continue;
    }
    const when = `${formatClock(start)} 開始${todo.durationMin > 0 ? `，持續 ${formatDuration(todo.durationMin)}` : ''}`;
    const late = now - start > LATE_MS ? `（錯過的提醒：${formatShort(start, now)}）` : '';
    out.push({ id: todo.id, title: clip(todo.title, 120), body: [when + late, firstLine(todo.body)].filter(Boolean).join('\n') });
  }
  return out;
}

export interface BarItem {
  visible: boolean;
  text: string;
  tooltip: string;
}

export function statusBar(todos: readonly Todo[], now: number): { now: BarItem; next: BarItem } {
  const { ongoing, next } = highlights(todos, now);
  const hidden: BarItem = { visible: false, text: '', tooltip: '' };

  let nowItem = hidden;
  const first = ongoing[0];
  if (first) {
    const suffix = ongoing.length > 1 ? ` 等 ${ongoing.length} 項` : `（至 ${formatClock(first.end)}）`;
    const prefix = '進行中：';
    nowItem = {
      visible: true,
      text: prefix + clip(first.todo.title, BAR_TEXT_MAX - prefix.length - suffix.length) + suffix,
      tooltip: clip(
        ongoing
          .map((o) => `${o.todo.title}　${formatClock(o.start)}–${formatClock(o.end)}（持續 ${formatDuration(o.todo.durationMin)}）`)
          .join('\n'),
        BAR_TOOLTIP_MAX,
      ),
    };
  }

  let nextItem = hidden;
  if (next) {
    const prefix = `下一個：${formatShort(next.at, now)} `;
    const details = [
      next.todo.title,
      formatDateTime(next.at),
      next.todo.durationMin > 0 ? `持續 ${formatDuration(next.todo.durationMin)}` : '',
      describeRepeat(next.todo.repeat),
    ];
    nextItem = {
      visible: true,
      text: prefix + clip(next.todo.title, BAR_TEXT_MAX - prefix.length),
      tooltip: clip(details.filter(Boolean).join('\n'), BAR_TOOLTIP_MAX),
    };
  }
  return { now: nowItem, next: nextItem };
}

/** 啟用中每筆的下一場與正在進行的場次；值變了才需要通知面板重畫。 */
export function scheduleSignature(todos: readonly Todo[], now: number): string {
  return todos
    .filter((t) => t.status === 'enabled')
    .map((t) => `${t.id}:${nextAfter(t, now) ?? '-'}:${ongoingAt(t, now)?.start ?? '-'}`)
    .join('|');
}

/** 指令與狀態列按下時顯示的摘要。 */
export function summaryText(todos: readonly Todo[], now: number): string {
  const { ongoing, next } = highlights(todos, now);
  const lines: string[] = [];
  for (const o of ongoing) {
    lines.push(`進行中：${o.todo.title}（${formatClock(o.start)}–${formatClock(o.end)}，持續 ${formatDuration(o.todo.durationMin)}）`);
  }
  lines.push(next ? `下一個：${formatShort(next.at, now)} ${next.todo.title}` : '下一個：沒有排定的 todo');
  return lines.join('\n');
}
