// Todo 資料模型，panel 與 worker 共用。時間一律存 epoch 毫秒，依執行環境的本地時區解讀。

/** enabled＝啟用、disabled＝停用、done＝已完成；只有啟用的會提醒、出現在狀態列。 */
export type TodoStatus = 'enabled' | 'disabled' | 'done';

export type RepeatUnit = 'minute' | 'hour' | 'day' | 'week' | 'month';

export type RepeatEnd =
  | { kind: 'never' }
  /** 總次數，含第一次 */
  | { kind: 'count'; count: number }
  /** 最後一次開始時間不晚於 until */
  | { kind: 'until'; until: number };

export interface Repeat {
  unit: RepeatUnit;
  every: number;
  end: RepeatEnd;
}

export interface Todo {
  id: string;
  title: string;
  /** Markdown */
  body: string;
  status: TodoStatus;
  /** null＝不排程，只是清單項目 */
  startAt: number | null;
  /** 0＝不標記持續時間 */
  durationMin: number;
  repeat: Repeat | null;
  notify: boolean;
  /** 舊版指定的單一工作區；仍照舊顯示與切換，存檔時一律清成 null、改存 project */
  workspace?: TodoWorkspace | null;
  /** 指定的 Orca 專案；開啟時再挑要切到哪一個工作樹。舊資料沒有這個欄位，視同 null */
  project?: TodoProject | null;
  /** worker 已處理到的時間點：早於等於它的場次不再通知 */
  notifiedThrough: number;
  createdAt: number;
  updatedAt: number;
}

/** 存下指定當時的名稱與分支：工作區被移除後清單仍顯示得出來 */
export interface TodoWorkspace {
  id: string;
  kind: 'worktree' | 'folder';
  name: string;
  branch: string | null;
}

/**
 * 專案＝同一個 Git repo 的所有工作樹，或單一資料夾。key 由 worker 依工作樹的 .git 推出（見 worker/workspaces.ts），
 * 存下指定當時的名稱：專案整個被移除後清單仍顯示得出來。
 */
export interface TodoProject {
  key: string;
  kind: 'repo' | 'folder';
  name: string;
}

/** 表單欄位，全部是使用者輸入的原始字串；由 worker 驗證後轉成 Todo。 */
export interface TodoDraft {
  id?: string;
  title: string;
  body: string;
  status: TodoStatus;
  start: string;
  duration: string;
  repeatUnit: RepeatUnit | 'none';
  every: string;
  endKind: RepeatEnd['kind'];
  count: string;
  until: string;
  notify: boolean;
  /** 空字串＝不指定專案 */
  projectKey: string;
}
