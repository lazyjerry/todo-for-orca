// todos 存在外掛自己的 storage（storage:own），worker 是唯一的寫入者。
import type { JsonValue, OrcaWorkerApi } from 'orca/worker';
import type { Todo } from '../core/types.ts';

export const STORAGE_KEY = 'todos';
const VERSION = 1;

interface Stored {
  version: number;
  todos: Todo[];
}

function isTodo(value: unknown): value is Todo {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === 'string' &&
    typeof t.title === 'string' &&
    typeof t.body === 'string' &&
    (t.status === 'enabled' || t.status === 'disabled' || t.status === 'done') &&
    (t.startAt === null || typeof t.startAt === 'number') &&
    typeof t.durationMin === 'number' &&
    typeof t.notifiedThrough === 'number'
  );
}

/** 格式不對的項目丟掉，不讓一筆壞資料拖垮整份清單。 */
export async function loadTodos(orca: OrcaWorkerApi): Promise<Todo[]> {
  const raw = (await orca.storage.get(STORAGE_KEY)) as Partial<Stored> | null;
  return Array.isArray(raw?.todos) ? raw.todos.filter(isTodo) : [];
}

export async function saveTodos(orca: OrcaWorkerApi, todos: Todo[]): Promise<void> {
  const value: Stored = { version: VERSION, todos };
  await orca.storage.set(STORAGE_KEY, value as unknown as JsonValue);
}
