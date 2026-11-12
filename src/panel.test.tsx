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
      todo({ id: 'soon', title: '下一件事', startAt: now + 30 * MIN, project: { key: 'repo:a', kind: 'repo', name: '<專案>' } }),
      todo({ id: 'memo', title: '整理筆記', project: { key: 'folder:notes', kind: 'folder', name: 'notes' } }),
      // 舊版只指定了工作區的資料
      todo({ id: 'legacy', title: '舊的工作區', workspace: { id: 'w2', kind: 'worktree', name: 'feature-x', branch: 'fix-login' } }),
      todo({ id: 'off', title: '暫停中', status: 'disabled' }),
      todo({ id: 'fin', title: '做完了', status: 'done' }),
    ],
  };
}

const REPO_A = [
  { id: 'w1', kind: 'worktree' as const, name: '<專案>', branch: 'main' },
  { id: 'w2', kind: 'worktree' as const, name: 'feature-x', branch: 'fix-login' },
];
const NOTES = { id: 'w3', kind: 'folder' as const, name: 'notes', branch: null };

/** 新增鈕已拿掉：編輯頁的測試改從現有的「下一件事」進編輯頁 */
async function openEditPage(view: Awaited<ReturnType<typeof mount>>): Promise<void> {
  await view.press({ type: 'ListItem', label: '下一件事' });
  await view.press({ type: 'Button', text: '編輯' });
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
      'project.options': {
        available: true,
        projects: [
          { key: 'folder:notes', kind: 'folder', name: 'notes', group: 'docs', worktrees: [NOTES] },
          { key: 'repo:a', kind: 'repo', name: '<專案>', group: '<群組>', worktrees: REPO_A },
        ],
        currentKey: 'folder:notes',
      },
      'project.worktrees': (input: { key: string }) => ({ worktrees: input.key === 'repo:a' ? REPO_A : [NOTES] }),
      'todo.testNotify': () => {
        calls.push({ name: 'todo.testNotify', input: null });
        return { flash: { tone: 'success' as const, text: '已送出測試通知' } };
      },
      'workspace.open': (input: unknown) => {
        calls.push({ name: 'workspace.open', input });
        return {};
      },
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
  assert.ok(view.find({ testId: 'detail-title', text: '# 專注時段' }));
  assert.equal(view.find({ type: 'Button', text: '批次刪除' }), null);
  assert.equal(view.find({ type: 'Button', text: '測試通知' }), null);
  assert.ok(view.find({ type: 'Markdown' }));
  await view.press({ text: '刪除' });
  assert.equal(calls.length, 0);
  await view.press({ text: '確定刪除' });
  assert.deepEqual(calls, [{ name: 'todo.delete', input: { id: 'live' } }]);
  await view.unmount();
});

test('內容頁停用要先確認；取消不送出，確定才改狀態', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const view = await mount(panel, { host: host(calls), locale: 'zh-TW' });
  await view.press({ type: 'ListItem', label: '專注時段' });
  await view.press({ text: '停用' });
  assert.ok(view.find({ type: 'Callout', label: '確定停用「專注時段」？' }));
  await view.press({ text: '取消' });
  assert.equal(view.find({ text: '確定停用' }), null);
  await view.press({ text: '停用' });
  await view.press({ text: '確定停用' });
  assert.deepEqual(calls, [{ name: 'todo.setStatus', input: { id: 'live', status: 'disabled' } }]);
  await view.unmount();
});

test('編輯：填表後儲存送出草稿，存好回到列表', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const view = await mount(panel, { host: host(calls), locale: 'zh-TW' });
  await openEditPage(view);
  assert.ok(view.find({ type: 'Text', text: '下一件事' }));
  await view.type({ label: '標題' }, '寫週報', { replace: true });
  // 標題列顯示已儲存的標題，草稿改了不跟著變
  assert.ok(view.find({ type: 'Text', text: '下一件事' }));
  assert.equal(view.find({ type: 'Text', text: '寫週報' }), null);
  await view.type({ label: '開始時間' }, '2026-11-20 17:00', { replace: true });
  await view.type({ label: '持續時間（分鐘）' }, '45', { replace: true });
  await view.select({ label: '重複' }, 'week');
  await view.select({ label: '停止條件' }, 'count');
  await view.type({ label: '總次數（含第一次）' }, '4');
  await view.press({ text: '儲存' });
  const sent = calls[0]?.input as Record<string, unknown>;
  assert.equal(sent.title, '寫週報');
  assert.equal(sent.repeatUnit, 'week');
  assert.equal(sent.count, '4');
  assert.equal(sent.id, 'soon');
  assert.equal(view.find({ testId: 'detail-title', text: '# 下一件事' }), null);
  assert.ok(view.find({ type: 'Tabs' }));
  assert.deepEqual(view.errors, []);
  await view.unmount();
});

test('截止時間：帶入明天時間，日曆改寫截止時間，與開始時間的日曆同時只開一個', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const view = await mount(panel, { host: host(calls), locale: 'zh-TW' });
  await openEditPage(view);
  await view.type({ label: '開始時間' }, '2026-11-12 20:00', { replace: true });
  await view.select({ label: '重複' }, 'day');
  await view.select({ label: '停止條件' }, 'until');
  assert.equal(view.find({ type: 'Button', text: '帶入現在時間' }) !== null, true);
  await view.press({ type: 'Button', text: '帶入明天時間' });
  const filled = String(view.valueOf({ label: '截止時間' }));
  const ahead = new Date(filled.replace(' ', 'T')).getTime() - Date.now();
  assert.ok(ahead > 23 * 3600_000 && ahead <= 25 * 3600_000, filled);

  await view.type({ label: '截止時間' }, '2026-12-20 18:00', { replace: true });
  const [, openUntil] = view.findAll({ type: 'Button', text: '選擇日期時間' });
  await view.press(openUntil!);
  assert.ok(view.find({ text: '2026 年 12 月' }));
  assert.equal(view.valueOf({ label: '時' }), '18');
  await view.press({ type: 'Button', text: '24' });
  await view.select({ label: '分' }, '45');
  assert.equal(view.valueOf({ label: '截止時間' }), '2026-12-24 18:45');
  assert.equal(view.valueOf({ label: '開始時間' }), '2026-11-12 20:00');

  await view.press({ type: 'Button', text: '選擇日期時間' });
  assert.ok(view.find({ text: '2026 年 11 月' }));
  assert.equal(view.findAll({ label: '時' }).length, 1);
  assert.equal(view.find({ type: 'Button', text: '收起日曆' }) !== null, true);
  await view.press({ type: 'Button', text: '儲存' });
  assert.equal((calls[0]?.input as Record<string, unknown>).until, '2026-12-24 18:45');
  assert.deepEqual(view.errors, []);
  assert.deepEqual(view.warnings, []);
  await view.unmount();
});

test('批次刪除：列出將刪除的項目，確定後才送出勾選的狀態', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const view = await mount(panel, { host: host(calls), locale: 'zh-TW' });
  await view.press({ type: 'Button', text: '批次刪除' });
  assert.ok(view.find({ text: '・做完了（已完成）' }));
  await view.toggle({ label: '停用（1 筆）' });
  assert.equal(calls.length, 0);
  await view.press({ text: '確定刪除 2 筆' });
  assert.deepEqual(calls, [{ name: 'todo.purge', input: { statuses: ['done', 'disabled'] } }]);
  assert.ok(view.find({ type: 'Button', text: '批次刪除' }));
  await view.unmount();
});

test('英文介面：Orca 不是中文時顯示英文，並把語言回報給 worker', async () => {
  langReports.length = 0;
  const view = await mount(panel, { host: host([]), locale: 'en-US' });
  assert.ok(view.find({ text: 'In progress' }));
  assert.ok(view.find({ text: 'Lasts 25 min' }));
  assert.ok(view.find({ type: 'Button', text: 'Bulk delete' }));
  await view.press({ type: 'ListItem', label: '專注時段' });
  assert.ok(view.find({ text: 'Schedule' }));
  await view.press({ text: 'Delete' });
  assert.ok(view.find({ text: 'This cannot be undone.' }));
  assert.deepEqual(langReports, ['en']);
  assert.deepEqual(view.errors, []);
  await view.unmount();
});

test('列表底部快速新增：只送標題，存好跳到該筆的編輯頁，標題列顯示該筆標題', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const view = await mount(panel, { host: host(calls), locale: 'zh-TW' });
  await view.type({ label: '快速新增標題' }, '買牛奶');
  await view.press({ type: 'Button', text: '新增' });
  const sent = calls[0]?.input as Record<string, unknown>;
  assert.equal(calls[0]?.name, 'todo.save');
  assert.equal(sent.title, '買牛奶');
  assert.equal('id' in sent, false);
  assert.ok(view.find({ type: 'Text', text: '下一件事' }));
  assert.ok(view.find({ type: 'Button', text: '儲存' }));
  assert.deepEqual(view.errors, []);
  await view.unmount();
});

test('持續時間快速按鈕：2 小時填 120 分、5 小時填 300 分、8 小時填 480 分', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const view = await mount(panel, { host: host(calls), locale: 'zh-TW' });
  await openEditPage(view);
  await view.type({ label: '標題' }, '專注');
  await view.press({ type: 'Button', text: '2 小時' });
  await view.press({ type: 'Button', text: '儲存' });
  assert.equal((calls[0]?.input as Record<string, unknown>).duration, '120');
  await view.unmount();

  const calls2: { name: string; input: unknown }[] = [];
  const view2 = await mount(panel, { host: host(calls2), locale: 'zh-TW' });
  await openEditPage(view2);
  await view2.type({ label: '標題' }, '整天的事');
  await view2.press({ type: 'Button', text: '8 小時' });
  await view2.press({ type: 'Button', text: '儲存' });
  assert.equal((calls2[0]?.input as Record<string, unknown>).duration, '480');
  await view2.unmount();

  const calls3: { name: string; input: unknown }[] = [];
  const view3 = await mount(panel, { host: host(calls3), locale: 'zh-TW' });
  await openEditPage(view3);
  await view3.type({ label: '標題' }, '半天的事');
  await view3.press({ type: 'Button', text: '5 小時' });
  await view3.press({ type: 'Button', text: '儲存' });
  assert.equal((calls3[0]?.input as Record<string, unknown>).duration, '300');
  await view3.unmount();
});

test('專案：按專案按鈕挑工作樹再開，只有一個就直接開；從內容頁挑完回到內容頁', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const view = await mount(panel, { host: host(calls), locale: 'zh-TW' });
  await view.press({ type: 'Button', text: '<專案>' });
  assert.ok(view.find({ text: '開啟「<專案>」的工作樹' }));
  assert.equal(calls.length, 0);
  await view.press({ type: 'ListItem', label: 'feature-x' });
  assert.deepEqual(calls, [{ name: 'workspace.open', input: { id: 'w2' } }]);
  assert.ok(view.find({ type: 'Tabs' }));

  calls.length = 0;
  await view.press({ type: 'Button', text: 'notes' });
  assert.deepEqual(calls, [{ name: 'workspace.open', input: { id: 'w3' } }]);

  calls.length = 0;
  await view.press({ type: 'ListItem', label: '下一件事' });
  await view.press({ type: 'Button', text: '<專案>' });
  await view.press({ type: 'Button', text: '← 返回' });
  assert.ok(view.find({ testId: 'detail-title', text: '# 下一件事' }));
  assert.deepEqual(calls, []);
  assert.deepEqual(view.errors, []);
  assert.deepEqual(view.refusals, []);
  await view.unmount();
});

/** 專案欄位沒在打字時，placeholder 就是已選的專案 */
function shownProject(view: Awaited<ReturnType<typeof mount>>): unknown {
  return view.find({ type: 'Input', label: '指定專案' })?.props.placeholder;
}

test('專案：編輯頁可改成目前專案；舊版只指定工作區的，預設成它所屬的專案、照舊顯示工作區按鈕', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const view = await mount(panel, { host: host(calls), locale: 'zh-TW' });
  await openEditPage(view);
  assert.equal(shownProject(view), '<群組> / <專案>（2 個工作樹）');
  assert.match(String(view.find({ type: 'IconButton', label: '專案說明' })?.props.tooltip), /只有一個就直接開/);
  assert.equal(view.find({ text: /只有一個就直接開/, type: 'Text' }), null);
  await view.press({ type: 'Button', text: '帶入目前專案' });
  assert.equal(shownProject(view), 'docs / notes（資料夾）');
  await view.press({ type: 'Button', text: '儲存' });
  const save = calls.find((c) => c.name === 'todo.save')?.input as Record<string, unknown>;
  assert.equal(save.id, 'soon');
  assert.equal(save.projectKey, 'folder:notes');

  calls.length = 0;
  await view.press({ type: 'Button', text: 'feature-x · fix-login' });
  assert.deepEqual(calls, [{ name: 'workspace.open', input: { id: 'w2' } }]);
  await view.press({ type: 'ListItem', label: '舊的工作區' });
  await view.press({ type: 'Button', text: '編輯' });
  assert.equal(shownProject(view), '<群組> / <專案>（2 個工作樹）');
  assert.deepEqual(view.errors, []);
  await view.unmount();
});

test('專案欄位：同一個輸入框打字篩選、展開鈕列出全部，點一筆或按 Enter 選定並清空；可清除', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const view = await mount(panel, { host: host(calls), locale: 'zh-TW' });
  await openEditPage(view);
  assert.equal(view.find({ type: 'ListItem', label: 'notes' }), null);
  await view.press({ type: 'IconButton', label: '展開專案清單' });
  assert.ok(view.find({ type: 'ListItem', label: 'notes' }));
  assert.ok(view.find({ type: 'ListItem', label: '<專案>' }));
  await view.press({ type: 'ListItem', label: 'notes' });
  assert.equal(shownProject(view), 'docs / notes（資料夾）');
  assert.equal(view.find({ type: 'ListItem', label: '<專案>' }), null);

  await view.type({ label: '指定專案' }, '群組');
  assert.ok(view.find({ type: 'ListItem', label: '<專案>' }));
  assert.equal(view.find({ type: 'ListItem', label: 'notes' }), null);
  await view.type({ label: '指定專案' }, ' 專案', { submit: true });
  assert.equal(shownProject(view), '<群組> / <專案>（2 個工作樹）');
  assert.equal(view.valueOf({ label: '指定專案' }), '');

  await view.type({ label: '指定專案' }, 'zzz');
  assert.ok(view.find({ text: '沒有符合的專案。' }));

  await view.press({ type: 'IconButton', label: '清除專案' });
  assert.equal(shownProject(view), '未指定：輸入群組或專案名稱搜尋，或按右邊展開清單');
  await view.press({ type: 'Button', text: '儲存' });
  assert.equal((calls.find((c) => c.name === 'todo.save')?.input as Record<string, unknown>).projectKey, '');
  assert.deepEqual(view.errors, []);
  assert.deepEqual(view.warnings, []);
  await view.unmount();
});

test('編輯頁內容欄：切到預覽時仍顯示同一個標題', async () => {
  const view = await mount(panel, { host: host([]), locale: 'zh-TW' });
  await openEditPage(view);
  assert.ok(view.find({ type: 'Textarea', label: '要做的事情（Markdown）' }));
  await view.press({ type: 'Button', text: '預覽' });
  assert.equal(view.find({ type: 'Textarea' }), null);
  assert.ok(view.find({ type: 'Field', label: '要做的事情（Markdown）' }));
  assert.deepEqual(view.errors, []);
  assert.deepEqual(view.warnings, []);
  await view.unmount();
});

test('列表右上角測試通知：不需先選 todo，直接送出並顯示結果', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const view = await mount(panel, { host: host(calls), locale: 'zh-TW' });
  await view.press({ type: 'Button', text: '測試通知' });
  assert.deepEqual(calls, [{ name: 'todo.testNotify', input: null }]);
  assert.ok(view.find({ text: '已送出測試通知' }));
  assert.ok(view.find({ type: 'IconButton', label: '重新整理' }));
  await view.unmount();
});

test('開始時間日曆：選日期、時、分改寫開始時間，可換月，再按一次收起', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const view = await mount(panel, { host: host(calls), locale: 'zh-TW' });
  await openEditPage(view);
  await view.type({ label: '標題' }, '看牙醫', { replace: true });
  await view.type({ label: '開始時間' }, '2026-11-12 20:00', { replace: true });
  await view.press({ type: 'Button', text: '選擇日期時間' });
  assert.ok(view.find({ text: '2026 年 11 月' }));
  assert.equal(view.valueOf({ label: '時' }), '20');
  await view.press({ type: 'Button', text: '15' });
  assert.equal(view.valueOf({ label: '開始時間' }), '2026-11-15 20:00');
  await view.select({ label: '時' }, '9');
  await view.select({ label: '分' }, '30');
  assert.equal(view.valueOf({ label: '開始時間' }), '2026-11-15 09:30');
  await view.press({ type: 'Button', text: '下個月 ›' });
  assert.ok(view.find({ text: '2026 年 12 月' }));
  await view.press({ type: 'Button', text: '1' });
  assert.equal(view.valueOf({ label: '開始時間' }), '2026-12-01 09:30');
  await view.press({ type: 'Button', text: '收起日曆' });
  assert.equal(view.find({ label: '時' }), null);
  await view.press({ type: 'Button', text: '儲存' });
  assert.equal((calls[0]?.input as Record<string, unknown>).start, '2026-12-01 09:30');
  assert.deepEqual(view.errors, []);
  assert.deepEqual(view.warnings, []);
  await view.unmount();
});
