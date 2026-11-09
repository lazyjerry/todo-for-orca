import type { JsonValue } from 'orca';
import { assert, mockHost, mountWorker, test } from 'orca/testing';
import { emptyDraft } from './core/draft.ts';
import { formatDateTime } from './core/format.ts';
import type { Todo } from './core/types.ts';
import * as main from './worker.ts';

const MIN = 60_000;

function stored(todos: Partial<Todo>[]): Record<string, JsonValue> {
  const now = Date.now();
  return {
    todos: {
      version: 1,
      todos: todos.map((t, i) => ({
        id: `t${i}`,
        title: `todo ${i}`,
        body: '',
        status: 'enabled',
        startAt: null,
        durationMin: 0,
        repeat: null,
        notify: true,
        notifiedThrough: now,
        createdAt: now,
        updatedAt: now,
        ...t,
      })),
    },
    lang: 'zh',
  } as unknown as Record<string, JsonValue>;
}

test('新增：驗證通過才寫入，回應是嚴格 JSON 並帶 savedId', async () => {
  const host = mockHost();
  const worker = await mountWorker(main, { host });
  const bad = await worker.request('todo.save', { ...emptyDraft(), title: '  ' });
  assert.equal(bad.flash?.tone, 'danger');
  assert.equal(bad.savedId, undefined);

  const start = formatDateTime(Date.now() + 60 * MIN);
  const result = await worker.request('todo.save', { ...emptyDraft(), title: '開會', body: '- [ ] 準備', start, duration: '30' });
  // Orca 拒收含 undefined 欄位的回應，mountWorker 不檢查這點
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.equal(result.flash?.tone, 'success');
  const saved = result.state.todos.find((t) => t.id === result.savedId);
  assert.equal(saved?.durationMin, 30);
  assert.ok(worker.posts.some((p) => p.event === 'state.changed'));
  assert.deepEqual(worker.refusals, []);
  await worker.deactivate();
});

test('到時通知：啟動時補發錯過的最新一場，並記下已處理，不重複送', async () => {
  const now = Date.now();
  const host = mockHost({
    storage: stored([
      { title: '喝水', startAt: now - 3 * MIN, notifiedThrough: now - 10 * MIN },
      { title: '停用的', startAt: now - 3 * MIN, notifiedThrough: now - 10 * MIN, status: 'disabled' },
      { title: '關掉通知的', startAt: now - 3 * MIN, notifiedThrough: now - 10 * MIN, notify: false },
    ]),
  });
  const worker = await mountWorker(main, { host });
  await worker.request('state.get'); // 排在第一次定時檢查之後
  const shown = host.callsOf('notifications.show') as { title: string; body: string }[];
  assert.equal(shown.length, 1);
  assert.equal(shown[0]?.title, '喝水');
  assert.match(shown[0]?.body ?? '', /錯過的提醒/);
  const after = (host.data().storage.todos as { todos: Todo[] }).todos;
  assert.ok((after[0]?.notifiedThrough ?? 0) >= now);
  assert.deepEqual(worker.refusals, []);
  await worker.deactivate();
});

test('狀態列：正在進行顯示持續時間的結束點，下一個顯示最近一場；沒有時隱藏', async () => {
  const now = Date.now();
  const host = mockHost({
    storage: stored([
      { title: '專注時段', startAt: now - 5 * MIN, durationMin: 25 },
      { title: '下一件事', startAt: now + 30 * MIN },
    ]),
  });
  const worker = await mountWorker(main, { host });
  await worker.request('state.get');
  const updates = host.callsOf('statusBar.update') as { id: string; text?: string; visible?: boolean }[];
  const nowItem = updates.filter((u) => u.id === 'now').at(-1);
  const nextItem = updates.filter((u) => u.id === 'next').at(-1);
  assert.match(nowItem?.text ?? '', /^進行中：專注時段（至 \d\d:\d\d）$/);
  assert.match(nextItem?.text ?? '', /下一件事/);

  const all = (host.data().storage.todos as { todos: Todo[] }).todos;
  for (const t of all) {
    await worker.request('todo.setStatus', { id: t.id, status: 'done' });
  }
  const latest = (host.callsOf('statusBar.update') as { id: string; visible?: boolean }[]).slice(-2);
  assert.deepEqual(
    latest.map((u) => u.visible),
    [false, false],
  );
  await worker.deactivate();
});

test('批次刪除只刪勾選的已完成／停用，啟用中的保留', async () => {
  const host = mockHost({
    storage: stored([{ status: 'enabled' }, { status: 'disabled' }, { status: 'done' }, { status: 'done' }]),
  });
  const worker = await mountWorker(main, { host });
  const result = await worker.request('todo.purge', { statuses: ['done'] });
  assert.deepEqual(
    result.state.todos.map((t) => t.status),
    ['enabled', 'disabled'],
  );
  assert.equal(result.flash?.text, '已刪除 2 筆');
  const none = await worker.request('todo.purge', { statuses: [] });
  assert.equal(none.flash?.tone, 'danger');
  assert.equal(none.state.todos.length, 2);
  await worker.deactivate();
});

test('語言：面板回報英文後，狀態列與提示訊息改用英文，並記住給下次啟動', async () => {
  const now = Date.now();
  const host = mockHost({ storage: stored([{ title: 'Focus', startAt: now - 5 * MIN, durationMin: 25 }]) });
  const worker = await mountWorker(main, { host });
  const latestNow = () => (host.callsOf('statusBar.update') as { id: string; text?: string }[]).filter((u) => u.id === 'now').at(-1)?.text ?? '';
  await worker.request('state.get');
  assert.match(latestNow(), /^進行中：Focus/);
  assert.deepEqual(await worker.request('lang.set', { lang: 'en' }), { lang: 'en' });
  assert.match(latestNow(), /^Now: Focus \(until \d\d:\d\d\)$/);
  assert.equal(host.data().storage.lang, 'en');
  const bad = await worker.request('todo.save', { ...emptyDraft(), title: '' });
  assert.equal(bad.flash?.text, 'Title cannot be empty');
  assert.deepEqual(worker.refusals, []);
  await worker.deactivate();
});
