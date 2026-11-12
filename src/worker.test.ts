import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { JsonValue } from 'orca';
import { assert, mockHost, mountWorker, test } from 'orca/testing';
import { emptyDraft } from './core/draft.ts';
import { formatDateTime } from './core/format.ts';
import type { Todo } from './core/types.ts';
import * as main from './worker.ts';
import { currentWorkspaceId, groupProjects, matchCurrent, repoRoot } from './worker/workspaces.ts';

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

/** 暫存目錄裡造一個 repo：主工作樹 todo-list、連結的工作樹 feature-x，外加一個資料夾 notes */
function fakeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'todo-list-test-'));
  const linked = join(root, 'todo-list', '.git', 'worktrees', 'feature-x');
  mkdirSync(linked, { recursive: true });
  writeFileSync(join(linked, 'commondir'), '../..\n');
  mkdirSync(join(root, 'feature-x'));
  writeFileSync(join(root, 'feature-x', '.git'), `gitdir: ${linked}\n`);
  mkdirSync(join(root, 'notes'));
  return root;
}

const REPO = fakeRepo();
const REPO_KEY = `repo:local:${join(REPO, 'todo-list')}`;

// 故意讓連結的工作樹排在主工作樹前面，驗證分組後主工作樹排第一
const WORKSPACES = [
  { id: 'w2', kind: 'worktree', name: 'feature-x', path: join(REPO, 'feature-x'), branch: 'feature-x', hostId: 'local' },
  { id: 'w1', kind: 'worktree', name: 'todo-list', path: join(REPO, 'todo-list'), branch: 'main', hostId: null },
  { id: 'w3', kind: 'folder', name: 'notes', path: join(REPO, 'notes'), branch: null, hostId: null },
];

function workspaceHost(storage?: Record<string, JsonValue>) {
  return mockHost({
    storage,
    results: {
      'workspace.list': { workspaces: WORKSPACES, truncated: false },
      'workspace.readContext': { branch: 'feature-x', displayName: 'feature-x', terminals: [] },
      'workspace.open': { opened: true },
    },
  });
}

test('專案：同一個 repo 的工作樹歸成一個專案、主工作樹排第一；認出目前開啟的專案', async () => {
  const worker = await mountWorker(main, { host: workspaceHost() });
  const opts = await worker.request('project.options');
  assert.equal(opts.available, true);
  assert.deepEqual(
    opts.projects.map((p) => ({ name: p.name, kind: p.kind, group: p.group, ids: p.worktrees.map((w) => w.id) })),
    [
      { name: 'notes', kind: 'folder', group: basename(REPO), ids: ['w3'] },
      { name: 'todo-list', kind: 'repo', group: basename(REPO), ids: ['w1', 'w2'] },
    ],
  );
  assert.equal(opts.currentKey, REPO_KEY);
  await worker.deactivate();
});

test('專案：存檔記下專案名稱、清掉舊版工作區；開啟前列出專案現有的工作樹，挑好後呼叫 workspace.open', async () => {
  const legacy = { id: 'w2', kind: 'worktree', name: 'feature-x', branch: 'feature-x' };
  const host = workspaceHost(stored([{ title: '舊的', workspace: legacy as Todo['workspace'] }]));
  const worker = await mountWorker(main, { host });

  const result = await worker.request('todo.save', { ...emptyDraft(), title: '修 bug', projectKey: REPO_KEY });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  const saved = result.state.todos.find((t) => t.id === result.savedId);
  assert.deepEqual(saved?.project, { key: REPO_KEY, kind: 'repo', name: 'todo-list' });
  assert.equal(saved?.workspace, null);

  const migrated = await worker.request('todo.save', { ...emptyDraft(), id: 't0', title: '舊的', projectKey: REPO_KEY });
  assert.equal(migrated.state.todos[0]?.workspace, null);
  assert.equal(migrated.state.todos[0]?.project?.key, REPO_KEY);

  const none = await worker.request('todo.save', { ...emptyDraft(), title: '不指定' });
  assert.equal(none.state.todos.find((t) => t.id === none.savedId)?.project, null);

  const missing = await worker.request('todo.save', { ...emptyDraft(), title: '亂填', projectKey: 'repo:local:/gone' });
  assert.equal(missing.flash?.tone, 'danger');
  assert.equal(missing.savedId, undefined);

  const trees = await worker.request('project.worktrees', { key: REPO_KEY });
  assert.deepEqual(trees.worktrees.map((w) => w.id), ['w1', 'w2']);
  const gone = await worker.request('project.worktrees', { key: 'repo:local:/gone' });
  assert.deepEqual(gone.worktrees, []);
  assert.equal(gone.flash?.tone, 'warning');

  const opened = await worker.request('workspace.open', { id: 'w2' });
  assert.deepEqual(opened, {});
  assert.deepEqual(host.callsOf('workspace.open'), [{ workspaceId: 'w2' }]);
  assert.deepEqual(worker.refusals, []);
  await worker.deactivate();
});

test('專案：已不在清單上的專案，編輯時沒改就沿用存著的快照', async () => {
  const gone = { key: 'repo:local:/removed', kind: 'repo', name: 'removed' };
  const host = workspaceHost(stored([{ title: '舊的', project: gone as Todo['project'] }]));
  const worker = await mountWorker(main, { host });
  const result = await worker.request('todo.save', { ...emptyDraft(), id: 't0', title: '舊的改名', projectKey: gone.key });
  assert.equal(result.flash?.tone, 'success');
  assert.deepEqual(result.state.todos[0]?.project, gone);
  await worker.deactivate();
});

test('專案：沒有授權 workspace 權限時，選項標成不可用，列工作樹與切換都回提示而不是丟錯', async () => {
  const host = mockHost({ capabilities: ['storage:own', 'notifications:show'] });
  const worker = await mountWorker(main, { host });
  const opts = await worker.request('project.options');
  assert.equal(opts.available, false);
  const trees = await worker.request('project.worktrees', { key: REPO_KEY });
  assert.ok(trees.flash);
  const opened = await worker.request('workspace.open', { id: 'w1' });
  assert.ok(opened.flash);
  await worker.deactivate();
});

test('專案：遠端主機、讀不到 .git 的工作樹各自算一個專案；bare repo 的工作樹歸到 bare 目錄', () => {
  const remote = groupProjects([
    { id: 'r1', kind: 'worktree', name: 'a', path: '/srv/a', branch: 'main', hostId: 'ssh-box' },
    { id: 'r2', kind: 'worktree', name: 'b', path: '/srv/b', branch: 'dev', hostId: 'ssh-box' },
  ]);
  assert.deepEqual(remote.map((p) => p.worktrees.map((w) => w.id)), [['r1'], ['r2']]);

  // 群組取上層資料夾名稱，先依群組、再依名稱排序
  const grouped = groupProjects([
    { id: 'a', kind: 'folder', name: 'zeta', path: '/work/alpha/zeta', branch: null, hostId: null },
    { id: 'b', kind: 'folder', name: 'beta', path: '/work/omega/beta', branch: null, hostId: null },
    { id: 'c', kind: 'folder', name: 'alpha-2', path: '/work/alpha/alpha-2', branch: null, hostId: null },
  ]);
  assert.deepEqual(grouped.map((p) => `${p.group}/${p.name}`), ['alpha/alpha-2', 'alpha/zeta', 'omega/beta']);

  const bare = join(REPO, 'bare.git');
  const linked = join(bare, 'worktrees', 'wt');
  mkdirSync(linked, { recursive: true });
  writeFileSync(join(linked, 'commondir'), '../..\n');
  mkdirSync(join(REPO, 'wt'));
  writeFileSync(join(REPO, 'wt', '.git'), `gitdir: ${linked}\n`);
  assert.equal(repoRoot(join(REPO, 'wt')), bare);
  assert.equal(repoRoot(join(REPO, 'notes')), null);
});

test('目前工作區：用終端機查到的路徑對回工作區；主工作樹同名同分支時也認得出，查不到才退回名稱比對', async () => {
  const listed = [
    { id: 'a', kind: 'worktree' as const, name: 'main', path: '/x/app', branch: 'main', hostId: 'local' },
    { id: 'b', kind: 'worktree' as const, name: 'main', path: '/x/todo-list', branch: 'main', hostId: null },
  ];
  const context = { branch: 'main', displayName: 'main', terminals: [{ id: 'gone' }, { id: 'term_1' }] };
  const paths: Record<string, string> = { term_1: '/x/todo-list' };
  const locate = async (id: string) => paths[id] ?? null;
  assert.equal(await currentWorkspaceId(listed, context, locate), 'b');
  // 名稱與分支都重複、終端機也查不到：不猜
  assert.equal(await currentWorkspaceId(listed, { ...context, terminals: [] }, locate), null);
  assert.equal(await currentWorkspaceId(listed, null, locate), null);
});

test('工作區：目前工作區的顯示名稱對不到時，退回用唯一的分支比對；分支重複就不猜', () => {
  const list = WORKSPACES.map(({ id, kind, name, branch }) => ({ id, kind: kind as 'worktree' | 'folder', name, branch }));
  assert.equal(matchCurrent(list, { branch: 'main', displayName: 'todo-list', terminals: [] } as never), 'w1');
  assert.equal(matchCurrent(list, { branch: 'feature-x', displayName: '改過的名字' } as never), 'w2');
  const dup = [...list, { id: 'w4', kind: 'worktree' as const, name: 'other-repo', branch: 'main' }];
  assert.equal(matchCurrent(dup, { branch: 'main', displayName: '改過的名字' } as never), null);
  assert.equal(matchCurrent(list, null), null);
});
