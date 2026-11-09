// worker：todos 的唯一寫入者，並定時送通知、更新狀態列。
// manifest 有 statusBarItems，Orca 會在外掛啟用期間一直讓 worker 執行，所以計時器能持續跑。
import { randomUUID } from 'node:crypto';
import type { OrcaWorkerApi } from 'orca/worker';
import { parseDraft } from './core/draft.ts';
import { type Lang, messages } from './core/i18n.ts';
import type { Todo, TodoWorkspace } from './core/types.ts';
import type { ActionResult, Flash, ViewState } from './protocol.ts';
import { type BarItem, dueReminders, scheduleSignature, statusBar, summaryText } from './worker/engine.ts';
import { loadLang, loadTodos, saveLang, saveTodos } from './worker/store.ts';
import { listWorkspaces, workspaceApiReady, workspaceOptions } from './worker/workspaces.ts';

const TICK_MS = 15_000;

class UserError extends Error {}

let timer: ReturnType<typeof setInterval> | undefined;

export default function activate(orca: OrcaWorkerApi): void {
  // 定時檢查與面板請求都是「讀 → 改 → 寫」，排成一列執行，避免互相蓋掉
  let chain: Promise<unknown> = Promise.resolve();
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const next = chain.then(run);
    chain = next.catch(() => undefined);
    return next;
  }

  const barCache: Record<string, string> = {};
  let lastSignature = '';
  /** 啟動時從 storage 讀回（見 loadLang），面板開啟時以 lang.set 更新 */
  let lang: Lang = 'en';
  const msg = () => messages(lang);

  async function updateBar(id: 'now' | 'next', item: BarItem): Promise<void> {
    const key = JSON.stringify(item);
    if (barCache[id] === key) {
      return;
    }
    try {
      await orca.host.call('statusBar.update', item.visible ? { id, ...item } : { id, visible: false });
      barCache[id] = key;
    } catch (err) {
      orca.log(`statusBar.update ${id} failed: ${errorText(err)}`);
    }
  }

  /** 狀態列與面板跟著最新資料走；force＝資料剛改過，不管場次有沒有變都通知面板。 */
  async function publish(todos: Todo[], now: number, force: boolean): Promise<void> {
    const bar = statusBar(todos, now, lang);
    await updateBar('now', bar.now);
    await updateBar('next', bar.next);
    const signature = scheduleSignature(todos, now);
    if (force || signature !== lastSignature) {
      lastSignature = signature;
      orca.panels.post('state.changed', { todos });
    }
  }

  async function tick(): Promise<void> {
    const now = Date.now();
    const todos = await loadTodos(orca);
    const due = dueReminders(todos, now, lang);
    if (due.length > 0) {
      const ids = new Set(due.map((r) => r.id));
      // 先記下已處理，再送通知：送失敗也不要每 15 秒重送一次
      const updated = todos.map((t) => (ids.has(t.id) ? { ...t, notifiedThrough: now } : t));
      await saveTodos(orca, updated);
      for (const r of due) {
        try {
          await orca.host.call('notifications.show', { title: r.title, body: r.body });
        } catch (err) {
          orca.log(`notifications.show failed: ${errorText(err)}`);
        }
      }
      await publish(updated, now, true);
      return;
    }
    await publish(todos, now, false);
  }

  function runTick(): void {
    void serial(tick).catch((err) => orca.log(`tick failed: ${errorText(err)}`));
  }

  /** 讀 → 改 → 寫；改完更新狀態列並通知其他面板。UserError 轉成提示，其他錯誤照常拋出。 */
  function mutation<I>(run: (todos: Todo[], input: I, now: number) => { todos: Todo[]; flash?: Flash }) {
    return (input: I): Promise<ActionResult> =>
      serial(async () => {
        const now = Date.now();
        const current = await loadTodos(orca);
        try {
          const result = run(current, input, now);
          await saveTodos(orca, result.todos);
          await publish(result.todos, now, true);
          return withFlash({ todos: result.todos }, result.flash);
        } catch (err) {
          if (!(err instanceof UserError)) {
            throw err;
          }
          return withFlash({ todos: current }, { tone: 'danger', text: err.message });
        }
      });
  }

  function find(todos: Todo[], id: string): Todo {
    const todo = todos.find((t) => t.id === id);
    if (!todo) {
      throw new UserError(msg().errNotFound);
    }
    return todo;
  }

  orca.panels.handle('state.get', () => serial(async () => ({ todos: await loadTodos(orca) })));

  orca.panels.handle('todo.save', async (draft): Promise<ActionResult & { savedId?: string }> => {
    const parsed = parseDraft(draft, lang);
    if (!parsed.ok) {
      const todos = await serial(() => loadTodos(orca));
      return { state: { todos }, flash: { tone: 'danger', text: parsed.error } };
    }
    // 存下工作區當下的名稱與分支；查詢放在 serial 外，不卡住定時檢查
    const listed = draft.workspaceId ? await findWorkspace(draft.workspaceId) : null;
    let savedId = '';
    const result = await mutation<null>((todos, _input, now) => {
      // 存檔當下以前的場次都不補發通知：改時間或新增時不會冒出一串舊提醒
      if (draft.id) {
        const existing = find(todos, draft.id);
        savedId = existing.id;
        const workspace = pickWorkspace(draft.workspaceId, listed, existing);
        const next: Todo = { ...existing, ...parsed.fields, workspace, notifiedThrough: now, updatedAt: now };
        return { todos: todos.map((t) => (t.id === existing.id ? next : t)), flash: { tone: 'success', text: msg().flashSaved(next.title) } };
      }
      const workspace = pickWorkspace(draft.workspaceId, listed, undefined);
      const created: Todo = { id: randomUUID(), ...parsed.fields, workspace, notifiedThrough: now, createdAt: now, updatedAt: now };
      savedId = created.id;
      return { todos: [...todos, created], flash: { tone: 'success', text: msg().flashCreated(created.title) } };
    })(null);
    return result.flash?.tone === 'danger' ? result : { ...result, savedId };
  });

  orca.panels.handle(
    'todo.setStatus',
    mutation<{ id: string; status: Todo['status'] }>((todos, { id, status }, now) => {
      const todo = find(todos, id);
      // 重新啟用時，停用期間錯過的場次不補發
      const next: Todo = { ...todo, status, updatedAt: now, ...(status === 'enabled' ? { notifiedThrough: now } : {}) };
      return { todos: todos.map((t) => (t.id === id ? next : t)), flash: { tone: 'success', text: msg().flashStatus[status](todo.title) } };
    }),
  );

  orca.panels.handle(
    'todo.delete',
    mutation<{ id: string }>((todos, { id }) => {
      const todo = find(todos, id);
      return { todos: todos.filter((t) => t.id !== id), flash: { tone: 'success', text: msg().flashDeleted(todo.title) } };
    }),
  );

  orca.panels.handle(
    'todo.purge',
    mutation<{ statuses: ('done' | 'disabled')[] }>((todos, { statuses }) => {
      // 只收這兩種狀態，就算 panel 送了 enabled 也不刪
      const targets = new Set(statuses.filter((s) => s === 'done' || s === 'disabled'));
      if (targets.size === 0) {
        throw new UserError(msg().errPurgeNone);
      }
      const kept = todos.filter((t) => !targets.has(t.status as 'done' | 'disabled'));
      const removed = todos.length - kept.length;
      return { todos: kept, flash: { tone: removed > 0 ? 'success' : 'neutral', text: removed > 0 ? msg().flashPurged(removed) : msg().flashNothingMatched } };
    }),
  );

  orca.panels.handle('todo.testNotify', async ({ id }): Promise<{ flash: Flash }> => {
    const todos = await serial(() => loadTodos(orca));
    const todo = todos.find((t) => t.id === id);
    if (!todo) {
      return { flash: { tone: 'danger', text: msg().errNotFound } };
    }
    try {
      const { delivered } = await orca.host.call('notifications.show', { title: todo.title, body: msg().testBody });
      return {
        flash: delivered
          ? { tone: 'success', text: msg().testSent }
          : { tone: 'warning', text: msg().testUndelivered },
      };
    } catch (err) {
      return { flash: { tone: 'danger', text: msg().testFailed(errorText(err)) } };
    }
  });

  /** 找不到或查詢失敗都回 null，交給 pickWorkspace 決定沿用舊的或報錯。 */
  async function findWorkspace(id: string): Promise<TodoWorkspace | null> {
    if (!workspaceApiReady(orca)) {
      return null;
    }
    try {
      return (await listWorkspaces(orca)).find((w) => w.id === id) ?? null;
    } catch (err) {
      orca.log(`workspace.list failed: ${errorText(err)}`);
      return null;
    }
  }

  /** 沒改工作區時沿用存著的快照：工作區暫時列不出來（已移除、遠端主機離線）也能照常存檔。 */
  function pickWorkspace(id: string, listed: TodoWorkspace | null, existing: Todo | undefined): TodoWorkspace | null {
    if (!id) {
      return null;
    }
    if (listed) {
      return listed;
    }
    if (existing?.workspace?.id === id) {
      return existing.workspace;
    }
    throw new UserError(msg().errWorkspaceMissing);
  }

  orca.panels.handle('workspace.options', async () => {
    try {
      return await workspaceOptions(orca);
    } catch (err) {
      orca.log(`workspace options failed: ${errorText(err)}`);
      return { available: false, workspaces: [], currentId: null };
    }
  });

  orca.panels.handle('workspace.open', async ({ id }): Promise<{ flash?: Flash }> => {
    if (!workspaceApiReady(orca)) {
      return { flash: { tone: 'warning', text: msg().workspaceUnavailable } };
    }
    try {
      await orca.host.call('workspace.open', { workspaceId: id });
      return {};
    } catch (err) {
      return { flash: { tone: 'danger', text: msg().workspaceOpenFailed(errorText(err)) } };
    }
  });

  orca.commands.register('todo-list.showStatus', async () => summaryText(await serial(() => loadTodos(orca)), Date.now(), lang));

  orca.panels.handle('lang.set', (input) =>
    serial(async () => {
      const next: Lang = input.lang === 'zh' ? 'zh' : 'en';
      if (next !== lang) {
        lang = next;
        await saveLang(orca, next);
        // 狀態列文字跟著換語言；面板自己會重畫，不必通知
        await publish(await loadTodos(orca), Date.now(), false);
      }
      return { lang };
    }),
  );

  // 排在第一次定時檢查之前：通知與狀態列一開始就用對的語言
  void serial(async () => {
    lang = await loadLang(orca);
  }).catch((err) => orca.log(`loadLang failed: ${errorText(err)}`));
  runTick();
  clearInterval(timer);
  timer = setInterval(runTick, TICK_MS);
}

export function deactivate(): void {
  clearInterval(timer);
  timer = undefined;
}

/** 回給 panel 的值必須是嚴格 JSON：值為 undefined 的欄位會讓 Orca 拒收整個回應。 */
function withFlash(state: ViewState, flash: Flash | undefined): ActionResult {
  return flash ? { state, flash } : { state };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
