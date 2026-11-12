// panel 與 worker 的請求契約，兩邊共用。
import type { Lang } from './core/i18n.ts';
import type { Todo, TodoDraft, TodoProject, TodoStatus, TodoWorkspace } from './core/types.ts';

export type { Repeat, RepeatEnd, RepeatUnit, Todo, TodoDraft, TodoProject, TodoStatus, TodoWorkspace } from './core/types.ts';

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

/** 一個專案與它底下現有的工作樹；主工作樹排第一 */
export interface ProjectOption extends TodoProject {
  worktrees: TodoWorkspace[];
  /** 下拉選單的分組：專案所在的上層資料夾名稱（Orca 側欄的群組外掛讀不到）；取不到是空字串 */
  group: string;
}

/** 編輯頁的專案選項；available＝這版 Orca 有 workspace.list 且已授權 */
export interface ProjectOptions {
  available: boolean;
  projects: ProjectOption[];
  /** 目前開啟的工作區所屬的專案；認不出目前工作區時是 null */
  currentKey: string | null;
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
    /** 列表右上角的測試通知：確認 Orca 的通知權限，不針對某一筆 */
    'todo.testNotify': { output: { flash: Flash } };
    'project.options': { output: ProjectOptions };
    /** 開啟專案前列出它現有的工作樹；專案不見或沒權限時帶 flash、worktrees 為空 */
    'project.worktrees': { input: { key: string }; output: { worktrees: TodoWorkspace[]; flash?: Flash } };
    /** 切到指定的工作區（挑好的工作樹，或舊版 todo 存的工作區），跟點 Orca 側欄一樣 */
    'workspace.open': { input: { id: string }; output: { flash?: Flash } };
    /** 面板開啟時回報 Orca 的介面語言，worker 的通知、狀態列與提示訊息跟著換 */
    'lang.set': { input: { lang: Lang }; output: { lang: Lang } };
  }
  interface PluginPanelEvents {
    /** 資料變動，或場次跨過開始／結束時間時，送給所有開著的面板 */
    'state.changed': ViewState;
  }
}
