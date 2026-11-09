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
  /** worker 已處理到的時間點：早於等於它的場次不再通知 */
  notifiedThrough: number;
  createdAt: number;
  updatedAt: number;
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
}
