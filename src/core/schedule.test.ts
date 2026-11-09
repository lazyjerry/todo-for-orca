import { assert, test } from 'orca/testing';
import { parseDraft, parseLocalDateTime } from './draft.ts';
import { describeRepeat, formatDuration, formatShort } from './format.ts';
import { pickLang } from './i18n.ts';
import { dueBetween, highlights, latestAtOrBefore, nextAfter, ongoingAt } from './schedule.ts';
import type { Repeat, Todo } from './types.ts';

const at = (text: string) => {
  const ms = parseLocalDateTime(text);
  if (ms === null) {
    throw new Error(`bad fixture time: ${text}`);
  }
  return ms;
};

function todo(patch: Partial<Todo>): Todo {
  return {
    id: 't',
    title: 't',
    body: '',
    status: 'enabled',
    startAt: at('2026-11-10 09:00'),
    durationMin: 0,
    repeat: null,
    notify: true,
    notifiedThrough: 0,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

const daily = (end: Repeat['end']): Repeat => ({ unit: 'day', every: 1, end });

test('不重複：只有一場，之後沒有下一場', () => {
  const t = todo({});
  assert.equal(nextAfter(t, at('2026-11-10 08:00')), at('2026-11-10 09:00'));
  assert.equal(nextAfter(t, at('2026-11-10 09:00')), null);
  assert.equal(latestAtOrBefore(t, at('2026-11-10 08:59')), null);
});

test('次數型停止條件：共 3 次，第 4 天沒有場次', () => {
  const t = todo({ repeat: daily({ kind: 'count', count: 3 }) });
  assert.equal(nextAfter(t, at('2026-11-11 10:00')), at('2026-11-12 09:00'));
  assert.equal(nextAfter(t, at('2026-11-12 09:00')), null);
  assert.equal(latestAtOrBefore(t, at('2026-11-20 00:00')), at('2026-11-12 09:00'));
});

test('截止時間型：最後一場不晚於截止時間；截止很久以後也能立即算出', () => {
  const t = todo({ repeat: { unit: 'minute', every: 1, end: { kind: 'until', until: at('2026-11-10 09:30') } } });
  assert.equal(nextAfter(t, at('2026-11-10 09:29')), at('2026-11-10 09:30'));
  assert.equal(nextAfter(t, at('2026-11-10 09:30')), null);
  assert.equal(latestAtOrBefore(t, at('2030-01-01 00:00')), at('2026-11-10 09:30'));
});

test('每月 31 號遇到小月落在月底，下個月回到 31 號', () => {
  const t = todo({ startAt: at('2027-01-31 09:00'), repeat: { unit: 'month', every: 1, end: { kind: 'never' } } });
  assert.equal(nextAfter(t, at('2027-02-01 00:00')), at('2027-02-28 09:00'));
  assert.equal(nextAfter(t, at('2027-03-01 00:00')), at('2027-03-31 09:00'));
});

test('持續時間：開始後到結束前算正在進行，結束當下就不算', () => {
  const t = todo({ durationMin: 30, repeat: daily({ kind: 'never' }) });
  assert.deepEqual(ongoingAt(t, at('2026-11-11 09:10')), { start: at('2026-11-11 09:00'), end: at('2026-11-11 09:30') });
  assert.equal(ongoingAt(t, at('2026-11-11 09:30')), null);
  assert.equal(ongoingAt(todo({ durationMin: 0 }), at('2026-11-10 09:00')), null);
});

test('通知只回 (from, now] 內最新一場；錯過多場也只回一場', () => {
  const t = todo({ repeat: { unit: 'hour', every: 1, end: { kind: 'never' } } });
  assert.equal(dueBetween(t, at('2026-11-10 08:00'), at('2026-11-10 12:30')), at('2026-11-10 12:00'));
  assert.equal(dueBetween(t, at('2026-11-10 12:00'), at('2026-11-10 12:30')), null);
});

test('highlights 只看啟用的 todo，下一個取最早的一場', () => {
  const now = at('2026-11-10 09:10');
  const list = [
    todo({ id: 'a', durationMin: 30 }),
    todo({ id: 'b', startAt: at('2026-11-10 11:00') }),
    todo({ id: 'c', startAt: at('2026-11-10 10:00'), status: 'disabled' }),
    todo({ id: 'd', startAt: at('2026-11-10 10:30') }),
  ];
  const h = highlights(list, now);
  assert.deepEqual(
    h.ongoing.map((o) => o.todo.id),
    ['a'],
  );
  assert.equal(h.next?.todo.id, 'd');
});

test('日期解析拒絕不存在的日期；草稿驗證擋下沒有開始時間的重複', () => {
  assert.equal(parseLocalDateTime('2026-02-30 09:00'), null);
  assert.equal(parseLocalDateTime('2026/11/10 9:05'), at('2026-11-10 09:05'));
  const base = {
    title: 'x',
    body: '',
    status: 'enabled' as const,
    start: '',
    duration: '',
    repeatUnit: 'day' as const,
    every: '1',
    endKind: 'never' as const,
    count: '',
    until: '',
    notify: true,
  };
  const result = parseDraft(base, 'zh');
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /開始時間/);
  const ok = parseDraft({ ...base, start: '2026-11-10 09:00', endKind: 'count', count: '3', duration: '15' }, 'zh');
  assert.deepEqual(ok.ok && ok.fields.repeat, { unit: 'day', every: 1, end: { kind: 'count', count: 3 } });
  assert.equal(ok.ok && ok.fields.durationMin, 15);
});

test('語言：zh 開頭用繁中、其他用英文；英文的重複規則、持續時間與日期短格式', () => {
  assert.equal(pickLang('zh-TW'), 'zh');
  assert.equal(pickLang('zh-Hant'), 'zh');
  assert.equal(pickLang('en-US'), 'en');
  assert.equal(pickLang('ja'), 'en');
  assert.equal(describeRepeat(daily({ kind: 'count', count: 3 }), 'en'), 'Every day, 3 times');
  assert.equal(describeRepeat({ unit: 'week', every: 2, end: { kind: 'never' } }, 'en'), 'Every 2 weeks, no end');
  assert.equal(describeRepeat({ unit: 'month', every: 1, end: { kind: 'never' } }, 'zh'), '每月，不停止');
  assert.equal(formatDuration(90, 'en'), '1 h 30 min');
  assert.equal(formatDuration(25, 'zh'), '25 分鐘');
  assert.equal(formatShort(at('2026-11-11 14:00'), at('2026-11-10 09:00'), 'en'), 'Tomorrow 14:00');
  const result = parseDraft({ ...emptyDraftLike(), repeatUnit: 'day' }, 'en');
  assert.equal(result.ok ? '' : result.error, 'Set a start time before choosing a repeat');
});

function emptyDraftLike() {
  return {
    title: 'x',
    body: '',
    status: 'enabled' as const,
    start: '',
    duration: '',
    repeatUnit: 'none' as 'none' | 'day',
    every: '1',
    endKind: 'never' as const,
    count: '',
    until: '',
    notify: true,
  };
}
