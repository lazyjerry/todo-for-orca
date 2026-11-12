// 表單草稿 ↔ Todo：驗證使用者輸入，錯誤訊息直接給面板顯示。
import { formatDateTime } from './format.ts';
import { type Lang, messages } from './i18n.ts';
import type { Repeat, RepeatUnit, Todo, TodoDraft } from './types.ts';

export const TITLE_MAX = 200;
export const BODY_MAX = 10_000;

const UNITS: readonly RepeatUnit[] = ['minute', 'hour', 'day', 'week', 'month'];

/** 接受 2026-11-10 14:00、2026/11/10 14:00、2026-11-10T14:00；日期不存在（2/30）視為錯誤。 */
export function parseLocalDateTime(text: string): number | null {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) {
    return null;
  }
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi);
  const valid =
    date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && date.getHours() === h && date.getMinutes() === mi;
  return valid ? date.getTime() : null;
}

function parseCount(text: string, min: number): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) {
    return null;
  }
  const n = Number(t);
  return n >= min && n <= 1_000_000 ? n : null;
}

export type DraftFields = Pick<Todo, 'title' | 'body' | 'status' | 'startAt' | 'durationMin' | 'repeat' | 'notify'>;

export function parseDraft(draft: TodoDraft, lang: Lang): { ok: true; fields: DraftFields } | { ok: false; error: string } {
  const t = messages(lang);
  const fail = (error: string) => ({ ok: false as const, error });
  const title = draft.title.trim();
  if (!title) {
    return fail(t.errTitleEmpty);
  }
  if (title.includes('\n') || title.length > TITLE_MAX) {
    return fail(t.errTitleTooLong(TITLE_MAX));
  }
  if (draft.body.length > BODY_MAX) {
    return fail(t.errBodyTooLong(BODY_MAX));
  }
  if (!['enabled', 'disabled', 'done'].includes(draft.status)) {
    return fail(t.errStatus);
  }

  let startAt: number | null = null;
  if (draft.start.trim()) {
    startAt = parseLocalDateTime(draft.start);
    if (startAt === null) {
      return fail(t.errStart);
    }
  }

  const durationMin = draft.duration.trim() ? parseCount(draft.duration, 0) : 0;
  if (durationMin === null) {
    return fail(t.errDuration);
  }

  let repeat: Repeat | null = null;
  if (draft.repeatUnit !== 'none') {
    if (!UNITS.includes(draft.repeatUnit)) {
      return fail(t.errUnit);
    }
    if (startAt === null) {
      return fail(t.errRepeatNeedsStart);
    }
    const every = parseCount(draft.every || '1', 1);
    if (every === null) {
      return fail(t.errEvery);
    }
    if (draft.endKind === 'count') {
      const count = parseCount(draft.count, 1);
      if (count === null) {
        return fail(t.errCount);
      }
      repeat = { unit: draft.repeatUnit, every, end: { kind: 'count', count } };
    } else if (draft.endKind === 'until') {
      const until = parseLocalDateTime(draft.until);
      if (until === null) {
        return fail(t.errUntil);
      }
      if (until < startAt) {
        return fail(t.errUntilBeforeStart);
      }
      repeat = { unit: draft.repeatUnit, every, end: { kind: 'until', until } };
    } else {
      repeat = { unit: draft.repeatUnit, every, end: { kind: 'never' } };
    }
  }

  return { ok: true, fields: { title, body: draft.body, status: draft.status, startAt, durationMin, repeat, notify: draft.notify } };
}

export function emptyDraft(): TodoDraft {
  return {
    title: '',
    body: '',
    status: 'enabled',
    start: '',
    duration: '',
    repeatUnit: 'none',
    every: '1',
    endKind: 'never',
    count: '',
    until: '',
    notify: true,
    projectKey: '',
  };
}

export function draftFromTodo(todo: Todo): TodoDraft {
  const end = todo.repeat?.end;
  return {
    id: todo.id,
    title: todo.title,
    body: todo.body,
    status: todo.status,
    start: todo.startAt === null ? '' : formatDateTime(todo.startAt),
    duration: todo.durationMin > 0 ? String(todo.durationMin) : '',
    repeatUnit: todo.repeat?.unit ?? 'none',
    every: String(todo.repeat?.every ?? 1),
    endKind: end?.kind ?? 'never',
    count: end?.kind === 'count' ? String(end.count) : '',
    until: end?.kind === 'until' ? formatDateTime(end.until) : '',
    notify: todo.notify,
    // 舊版只指定了工作區的，由編輯頁載入專案清單後換成所屬專案
    projectKey: todo.project?.key ?? '',
  };
}
