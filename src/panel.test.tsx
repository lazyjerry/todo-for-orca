import { assert, mockHost, mount, test } from 'orca/testing';
import type { Todo } from './core/types.ts';
import * as panel from './panel.tsx';
import type { ViewState } from './protocol.ts';

const MIN = 60_000;
/** 面板回報給 worker 的語言（lang.set），不混進各測試的 calls */
const langReports: string[] = [];

function todo(patch: Partial<Todo>): Todo {
  const now = Date.now();
  return {
    id: 'x',
    title: 'x',
    body: '',
    status: 'enabled',
    startAt: null,
    durationMin: 0,
    repeat: null,
    notify: true,
    notifiedThrough: now,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function state(): ViewState {
  const now = Date.now();
  return {
    todos: [
      todo({ id: 'live', title: '專注時段', startAt: now - 5 * MIN, durationMin: 25, body: '## 目標\n- 寫測試' }),
      todo({ id: 'soon', title: '下一件事', startAt: now + 30 * MIN }),
      todo({ id: 'off', title: '暫停中', status: 'disabled' }),
      todo({ id: 'fin', title: '做完了', status: 'done' }),
    ],
  };
}

function host(calls: { name: string; input: unknown }[]) {
  const record = (name: string) => (input: unknown) => {
    calls.push({ name, input });
    return { state: state(), flash: { tone: 'success' as const, text: `${name} ok` } };
  };
  return mockHost({
    requests: {
      'lang.set': (input: { lang: 'zh' | 'en' }) => {
        langReports.push(input.lang);
        return input;
      },
      'state.get': () => state(),
      'todo.delete': record('todo.delete'),
      'todo.purge': record('todo.purge'),
      'todo.setStatus': record('todo.setStatus'),
      'todo.save': (input: unknown) => {
        calls.push({ name: 'todo.save', input });
        return { state: state(), savedId: 'soon', flash: { tone: 'success' as const, text: '已新增' } };
      },
    },
  });
}

test('側欄最上方顯示正在進行與持續時間；清單預設只顯示啟用，可切換狀態', async () => {
  const view = await mount(panel, { host: host([]), locale: 'zh-TW' });
  assert.ok(view.find({ text: '正在進行' }));
  assert.ok(view.find({ text: '持續 25 分鐘' }));
  assert.ok(view.find({ type: 'ListItem', label: '下一件事' }));
  assert.equal(view.find({ type: 'ListItem', label: '暫停中' }), null);
  await view.select({ type: 'Tabs' }, 'disabled');
  assert.ok(view.find({ type: 'ListItem', label: '暫停中' }));
  assert.equal(view.find({ type: 'ListItem', label: '下一件事' }), null);
  assert.deepEqual(view.errors, []);
  assert.deepEqual(view.refusals, []);
  await view.unmount();
});

test('點項目開整頁 popup 顯示 Markdown 內容；刪除要先確認', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const view = await mount(panel, { host: host(calls), locale: 'zh-TW' });
  await view.press({ type: 'ListItem', label: '專注時段' });
  assert.ok(view.find({ type: 'Heading', text: '專注時段' }));
  assert.equal(view.find({ type: 'IconButton', label: '新增 Todo' }), null);
  assert.ok(view.find({ type: 'Markdown' }));
  await view.press({ text: '刪除' });
  assert.equal(calls.length, 0);
  await view.press({ text: '確定刪除' });
  assert.deepEqual(calls, [{ name: 'todo.delete', input: { id: 'live' } }]);
  await view.unmount();
});

test('新增：填表後儲存送出草稿，存好跳到該筆的內容頁', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const view = await mount(panel, { host: host(calls), locale: 'zh-TW' });
  await view.press({ type: 'IconButton', label: '新增 Todo' });
  await view.type({ label: '標題' }, '寫週報');
  await view.type({ label: '開始時間' }, '2026-11-20 17:00');
  await view.type({ label: '持續時間（分鐘）' }, '45');
  await view.select({ label: '重複' }, 'week');
  await view.select({ label: '停止條件' }, 'count');
  await view.type({ label: '總次數（含第一次）' }, '4');
  await view.press({ text: '儲存' });
  const sent = calls[0]?.input as Record<string, unknown>;
  assert.equal(sent.title, '寫週報');
  assert.equal(sent.repeatUnit, 'week');
  assert.equal(sent.count, '4');
  assert.equal('id' in sent, false);
  assert.ok(view.find({ type: 'Heading', text: '下一件事' }));
  assert.deepEqual(view.errors, []);
  await view.unmount();
});

test('批次刪除：列出將刪除的項目，確定後才送出勾選的狀態', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const view = await mount(panel, { host: host(calls), locale: 'zh-TW' });
  await view.press({ type: 'IconButton', label: '批次刪除' });
  assert.ok(view.find({ text: '・做完了（已完成）' }));
  await view.toggle({ label: '停用（1 筆）' });
  assert.equal(calls.length, 0);
  await view.press({ text: '確定刪除 2 筆' });
  assert.deepEqual(calls, [{ name: 'todo.purge', input: { statuses: ['done', 'disabled'] } }]);
  assert.ok(view.find({ type: 'IconButton', label: '新增 Todo' }));
  await view.unmount();
});

test('英文介面：Orca 不是中文時顯示英文，並把語言回報給 worker', async () => {
  langReports.length = 0;
  const view = await mount(panel, { host: host([]), locale: 'en-US' });
  assert.ok(view.find({ text: 'In progress' }));
  assert.ok(view.find({ text: 'Lasts 25 min' }));
  assert.ok(view.find({ type: 'IconButton', label: 'Add todo' }));
  await view.press({ type: 'ListItem', label: '專注時段' });
  assert.ok(view.find({ text: 'Schedule' }));
  await view.press({ text: 'Delete' });
  assert.ok(view.find({ text: 'This cannot be undone.' }));
  assert.deepEqual(langReports, ['en']);
  assert.deepEqual(view.errors, []);
  await view.unmount();
});

test('列表底部快速新增：只送標題，存好跳到該筆的編輯頁', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const view = await mount(panel, { host: host(calls), locale: 'zh-TW' });
  await view.type({ label: '快速新增標題' }, '買牛奶');
  await view.press({ type: 'Button', text: '新增' });
  const sent = calls[0]?.input as Record<string, unknown>;
  assert.equal(calls[0]?.name, 'todo.save');
  assert.equal(sent.title, '買牛奶');
  assert.equal('id' in sent, false);
  assert.ok(view.find({ text: '編輯 Todo' }));
  assert.ok(view.find({ type: 'Button', text: '儲存' }));
  assert.deepEqual(view.errors, []);
  await view.unmount();
});

test('持續時間快速按鈕：一個時辰填 120 分、整天填 480 分', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const view = await mount(panel, { host: host(calls), locale: 'zh-TW' });
  await view.press({ type: 'IconButton', label: '新增 Todo' });
  await view.type({ label: '標題' }, '專注');
  await view.press({ type: 'Button', text: '一個時辰' });
  await view.press({ type: 'Button', text: '儲存' });
  assert.equal((calls[0]?.input as Record<string, unknown>).duration, '120');
  await view.unmount();

  const calls2: { name: string; input: unknown }[] = [];
  const view2 = await mount(panel, { host: host(calls2), locale: 'zh-TW' });
  await view2.press({ type: 'IconButton', label: '新增 Todo' });
  await view2.type({ label: '標題' }, '整天的事');
  await view2.press({ type: 'Button', text: '整天' });
  await view2.press({ type: 'Button', text: '儲存' });
  assert.equal((calls2[0]?.input as Record<string, unknown>).duration, '480');
  await view2.unmount();
});
