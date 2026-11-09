// panel 與 worker 的請求契約，兩邊共用。
import type { Todo, TodoDraft, TodoStatus } from './core/types.ts';

export type { Repeat, RepeatEnd, RepeatUnit, Todo, TodoDraft, TodoStatus } from './core/types.ts';

export interface ViewState {
  todos: Todo[];
}

export interface Flash {
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  text: string;
}

export interface ActionResult {
  state: ViewState;
  flash?: Flash;
}

/** 批次刪除只允許這兩種狀態，啟用中的不會被誤刪。 */
export type PurgeStatus = Exclude<TodoStatus, 'enabled'>;

declare module 'orca' {
  interface PluginRequests {
    'state.get': { output: ViewState };
    /** draft.id 有值＝更新，沒有＝新增；savedId 是存好的那筆，驗證失敗時沒有 */
    'todo.save': { input: TodoDraft; output: ActionResult & { savedId?: string } };
    'todo.setStatus': { input: { id: string; status: TodoStatus }; output: ActionResult };
    'todo.delete': { input: { id: string }; output: ActionResult };
    'todo.purge': { input: { statuses: PurgeStatus[] }; output: ActionResult };
    'todo.testNotify': { input: { id: string }; output: { flash: Flash } };
  }
  interface PluginPanelEvents {
    /** 資料變動，或場次跨過開始／結束時間時，送給所有開著的面板 */
    'state.changed': ViewState;
  }
}
