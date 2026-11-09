// panel 與 worker 的請求契約，兩邊共用。
import type { Lang } from './core/i18n.ts';
import type { Todo, TodoDraft, TodoStatus, TodoWorkspace } from './core/types.ts';

export type { Repeat, RepeatEnd, RepeatUnit, Todo, TodoDraft, TodoStatus, TodoWorkspace } from './core/types.ts';

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

/** 編輯頁的工作區選項；available＝這版 Orca 有 workspace.list 且已授權 */
export interface WorkspaceOptions {
  available: boolean;
  workspaces: TodoWorkspace[];
  /** 目前開啟的工作區；比對不到（或對到不只一個）時是 null */
  currentId: string | null;
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
    'workspace.options': { output: WorkspaceOptions };
    /** 切到 todo 指定的工作區，跟點 Orca 側欄一樣 */
    'workspace.open': { input: { id: string }; output: { flash?: Flash } };
    /** 面板開啟時回報 Orca 的介面語言，worker 的通知、狀態列與提示訊息跟著換 */
    'lang.set': { input: { lang: Lang }; output: { lang: Lang } };
  }
  interface PluginPanelEvents {
    /** 資料變動，或場次跨過開始／結束時間時，送給所有開著的面板 */
    'state.changed': ViewState;
  }
}
