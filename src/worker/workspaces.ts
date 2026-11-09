// Orca 工作區（worktree／資料夾）：列出可指定的工作區、找出目前開啟的是哪一個。
// workspace.list／workspace.open 只有 worker 能呼叫（host API 1.3 起），面板經 plugin.request 轉過來。
import type { OrcaWorkerApi } from 'orca/worker';
import type { TodoWorkspace } from '../core/types.ts';
import type { WorkspaceOptions } from '../protocol.ts';

type Context = { branch: string; displayName: string } | null;

/** 舊版 Orca 沒有這兩個方法；沒授權 workspace:read 時呼叫會被拒，一律當作不可用。 */
export function workspaceApiReady(orca: OrcaWorkerApi): boolean {
  return orca.host.has('workspace.list') && orca.host.has('workspace.open');
}

export async function listWorkspaces(orca: OrcaWorkerApi): Promise<TodoWorkspace[]> {
  const { workspaces } = await orca.host.call('workspace.list');
  return workspaces.map((w) => ({ id: w.id, kind: w.kind, name: w.name, branch: w.branch }));
}

/**
 * readContext 不給 id，只能用名稱＋分支比對；displayName 可能是使用者改過的顯示名稱，
 * 對不到時退回只比分支。對到不只一個就不猜。
 */
export function matchCurrent(workspaces: TodoWorkspace[], context: Context): string | null {
  if (!context) {
    return null;
  }
  const unique = (hits: TodoWorkspace[]) => (hits.length === 1 ? hits[0]!.id : null);
  const byName = workspaces.filter((w) => w.name === context.displayName && (w.branch ?? '') === context.branch);
  if (byName.length > 0) {
    return unique(byName);
  }
  return context.branch ? unique(workspaces.filter((w) => w.branch === context.branch)) : null;
}

export async function workspaceOptions(orca: OrcaWorkerApi): Promise<WorkspaceOptions> {
  if (!workspaceApiReady(orca)) {
    return { available: false, workspaces: [], currentId: null };
  }
  const workspaces = await listWorkspaces(orca);
  const context = await orca.host.call('workspace.readContext').catch(() => null);
  return { available: true, workspaces, currentId: matchCurrent(workspaces, context) };
}
