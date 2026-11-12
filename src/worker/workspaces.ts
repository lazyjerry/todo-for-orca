// Orca 工作區（worktree／資料夾）：依所屬 repo 分成專案、找出目前開啟的是哪一個。
// workspace.list／workspace.open 只有 worker 能呼叫（host API 1.3 起），面板經 plugin.request 轉過來。
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { OrcaWorkerApi } from 'orca/worker';
import type { TodoWorkspace } from '../core/types.ts';
import type { ProjectOption, ProjectOptions } from '../protocol.ts';

type Context = { branch: string; displayName: string; terminals?: { id: string }[] } | null;

/** 舊版 Orca 沒有這兩個方法；沒授權 workspace:read 時呼叫會被拒，一律當作不可用。 */
export function workspaceApiReady(orca: OrcaWorkerApi): boolean {
  return orca.host.has('workspace.list') && orca.host.has('workspace.open');
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

type Listed = { id: string; kind: 'worktree' | 'folder'; name: string; path: string; branch: string | null; hostId: string | null };

/**
 * 工作樹所屬 repo 的根目錄。workspace.list 不給專案（id 是 `identity:…`，看不出 repo），
 * trusted worker 能讀檔，就照 Git 的規則找：.git 是目錄＝主工作樹本身；
 * 是檔案＝連結的工作樹，內容 `gitdir: <repo>/.git/worktrees/<名稱>`，該目錄的 commondir 指回共用的 .git。
 * 讀不到（遠端主機、路徑不存在、不是 Git）回 null。
 */
export function repoRoot(path: string): string | null {
  try {
    const dotGit = join(path, '.git');
    if (statSync(dotGit).isDirectory()) {
      return path;
    }
    const gitDir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1]?.trim();
    if (!gitDir) {
      return null;
    }
    const linked = resolve(path, gitDir);
    let common = linked;
    try {
      common = resolve(linked, readFileSync(join(linked, 'commondir'), 'utf8').trim());
    } catch {
      // 沒有 commondir 就當 gitdir 本身是共用的
    }
    // bare repo 的工作樹沒有 .git 這層，共用目錄本身就是 repo
    return basename(common) === '.git' ? dirname(common) : common;
  } catch {
    return null;
  }
}

/** 本機的工作樹才讀得到 .git；遠端（SSH／WSL）與推不出 repo 的，各自算一個專案 */
export function groupProjects(workspaces: Listed[], rootOf: (path: string) => string | null = repoRoot): ProjectOption[] {
  const projects = new Map<string, ProjectOption>();
  for (const w of workspaces) {
    const host = w.hostId ?? 'local';
    const root = w.kind === 'worktree' && host === 'local' ? rootOf(w.path) : null;
    const key = root ? `repo:${host}:${root}` : `${w.kind}:${host}:${w.path}`;
    const name = root ? basename(root) : w.name;
    const group = basename(dirname(root ?? w.path));
    const project = projects.get(key) ?? { key, kind: w.kind === 'folder' ? 'folder' : 'repo', name, group, worktrees: [] };
    const entry: TodoWorkspace = { id: w.id, kind: w.kind, name: w.name, branch: w.branch };
    // 主工作樹（路徑就是 repo 根）排第一，其他照名稱
    if (root === w.path) {
      project.worktrees.unshift(entry);
    } else {
      project.worktrees.push(entry);
    }
    projects.set(key, project);
  }
  // 同群組排在一起，下拉選單才看得出分組
  return [...projects.values()].sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

export async function listProjects(orca: OrcaWorkerApi): Promise<ProjectOption[]> {
  const { workspaces } = await orca.host.call('workspace.list');
  return groupProjects(workspaces);
}

/** worker 跑在 Orca.app 裡：從 resourcesPath 或 execPath 推出 CLI 位置，都推不出就靠 PATH */
export function orcaCli(): string {
  const candidates: string[] = [];
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  if (resources) {
    candidates.push(join(resources, 'bin', 'orca'));
  }
  const app = /^(.*?\.app)\//.exec(process.execPath)?.[1];
  if (app) {
    candidates.push(join(app, 'Contents', 'Resources', 'bin', 'orca'));
  }
  return candidates.find((p) => existsSync(p)) ?? 'orca';
}

/** 終端機所在 worktree 的路徑；`orca terminal show` 查不到或逾時回 null */
export function terminalWorktreePath(terminalId: string): Promise<string | null> {
  return new Promise((done) => {
    execFile(orcaCli(), ['terminal', 'show', '--terminal', terminalId, '--json'], { timeout: 5000 }, (err, stdout) => {
      if (err) {
        done(null);
        return;
      }
      try {
        const path: unknown = JSON.parse(stdout)?.result?.terminal?.worktreePath;
        done(typeof path === 'string' ? path : null);
      } catch {
        done(null);
      }
    });
  });
}

/**
 * 目前開啟的工作區 id。readContext 不給 id，但給了它的終端機 id；用 CLI 查終端機所在路徑，對回 workspace.list。
 * 只比本機的；沒有終端機或查不到，退回名稱＋分支比對（主工作樹多半都叫 main，常認不出）。
 */
export async function currentWorkspaceId(
  listed: Listed[],
  context: Context,
  locate: (terminalId: string) => Promise<string | null> = terminalWorktreePath,
): Promise<string | null> {
  if (!context) {
    return null;
  }
  for (const terminal of (context.terminals ?? []).slice(0, 3)) {
    const path = await locate(terminal.id);
    const hit = path ? listed.find((w) => w.path === path && (w.hostId ?? 'local') === 'local') : undefined;
    if (hit) {
      return hit.id;
    }
  }
  return matchCurrent(listed, context);
}

export async function projectOptions(orca: OrcaWorkerApi): Promise<ProjectOptions> {
  if (!workspaceApiReady(orca)) {
    return { available: false, projects: [], currentKey: null };
  }
  const { workspaces } = await orca.host.call('workspace.list');
  const projects = groupProjects(workspaces);
  const context = await orca.host.call('workspace.readContext').catch(() => null);
  const currentId = await currentWorkspaceId(workspaces, context);
  if (!currentId && context) {
    // 「帶入目前專案」會停用；留下 CLI 位置，查得出是不是找不到 orca CLI
    orca.log(`current workspace not found (terminals ${context.terminals?.length ?? 0}, cli ${orcaCli()})`);
  }
  const current = currentId ? projects.find((p) => p.worktrees.some((w) => w.id === currentId)) : undefined;
  return { available: true, projects, currentKey: current?.key ?? null };
}
