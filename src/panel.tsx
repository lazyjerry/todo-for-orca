// 右側欄面板：主畫面是「正在進行／下一個」與依狀態分組的清單；按項目開整頁 popup 檢視、編輯。
// Orca 的元件面板沒有 modal，popup 是把整個面板換成該畫面，左上角「← 返回」回到清單。
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Checkbox,
  EmptyState,
  env,
  Field,
  Heading,
  IconButton,
  Input,
  List,
  ListItem,
  Markdown,
  plugin,
  RadioGroup,
  read,
  Row,
  Select,
  Separator,
  set,
  Spinner,
  Stack,
  Switch,
  Tab,
  Tabs,
  Text,
  Textarea,
  update,
  type IconName,
  type OrcaNode,
  type PanelContext,
  type Tone,
} from 'orca';
import { BODY_MAX, draftFromTodo, emptyDraft, parseLocalDateTime, TITLE_MAX } from './core/draft.ts';
import { monthWeeks, sameDay, shiftMonth, withDate, withTime, yearMonthOf, type YearMonth } from './core/calendar.ts';
import { describeRepeat, formatClock, formatDateTime, formatDuration, formatShort } from './core/format.ts';
import { assistMarkdown, markdownHeading } from './core/markdown.ts';
import { type Lang, type Messages, messages, pickLang } from './core/i18n.ts';
import { highlights, nextAfter, ongoingAt } from './core/schedule.ts';
import type { RepeatUnit, Todo, TodoDraft, TodoProject, TodoStatus, TodoWorkspace } from './core/types.ts';
import type { ActionResult, Flash, ProjectOption, ProjectOptions, PurgeStatus, ViewState } from './protocol.ts';

type Popup =
  | { kind: 'detail'; id: string }
  | { kind: 'edit' }
  | { kind: 'purge' }
  /** 開啟專案時挑工作樹；back＝挑完或按返回後回到哪一頁 */
  | { kind: 'pick'; project: TodoProject; worktrees: TodoWorkspace[]; back: Popup | null };

const view = atom<ViewState | null>(null);
const flash = atom<Flash | null>(null);
const busy = atom(false);
const popup = atom<Popup | null>(null);
const draft = atom<TodoDraft>(emptyDraft());
const confirmDelete = atom(false);
/** 內容頁按了啟用／停用、等待確認的目標狀態 */
const confirmStatus = atom<ConfirmableStatus | null>(null);
type ConfirmableStatus = Exclude<TodoStatus, 'done'>;
const quickTitle = atom('');
const bodyTab = atom('write');
/** 清單只顯示一種狀態；不持久化，重開面板回到預設的「啟用」。 */
const statusFilter = atom<TodoStatus>('enabled');
const purgeChoice = atom<Record<PurgeStatus, boolean>>({ done: true, disabled: false });
/** 編輯頁的專案下拉選單；每次開編輯頁重抓，null＝載入中 */
const projectOpts = atom<ProjectOptions | null>(null);
/** 編輯頁專案欄位打的字；有字就篩選清單 */
const projectQuery = atom('');
/** 沒打字時按展開鈕列出全部專案 */
const projectBrowse = atom(false);
type PickerField = 'start' | 'until';
/** 編輯頁的日曆：null＝收起，否則是哪個欄位與正在看的月份；同時只開一個 */
const dateTimePicker = atom<{ field: PickerField; ym: YearMonth } | null>(null);

const STATUS_ORDER: TodoStatus[] = ['enabled', 'disabled', 'done'];
/** 狀態的代表色：清單外框、徽章共用，讓三組一眼分得開。 */
const STATUS_TONE: Record<TodoStatus, Tone> = { enabled: 'accent', disabled: 'warning', done: 'success' };
const FLASH_TIMEOUT_MS = 4000;
/** 持續時間快速按鈕（分鐘），順序對應 i18n 的 durationPresets */
const DURATION_PRESETS = [15, 30, 120, 300, 480] as const;

/** Orca 的介面語言：zh 開頭用繁中，其他用英文。在 render 時讀，語言切換後重畫就會跟著換。 */
function panelLang(): Lang {
  return pickLang(env.locale);
}

function msgs(): Messages {
  return messages(panelLang());
}

/** 成功／一般訊息幾秒後自動消失，警告與錯誤留著等使用者關閉。 */
function showFlash(next: Flash | null): void {
  set(flash, next);
  if (next && (next.tone === 'success' || next.tone === 'neutral')) {
    setTimeout(() => {
      if (read(flash) === next) {
        set(flash, null);
      }
    }, FLASH_TIMEOUT_MS);
  }
}

function applyState(state: ViewState): void {
  set(view, state);
  // 別處刪掉了正在看的那筆，就退回清單
  const open = read(popup);
  if (open?.kind === 'detail' && !state.todos.some((t) => t.id === open.id)) {
    closePopup();
  }
}

async function refresh(): Promise<void> {
  try {
    applyState(await plugin.request('state.get'));
  } catch (err) {
    showFlash({ tone: 'danger', text: msgs().loadFailed(errorText(err)) });
  }
}

/** 送出動作並套用回傳的最新狀態；動作期間鎖住按鈕，避免連點。回傳 false＝失敗。 */
async function act(run: () => Promise<ActionResult>): Promise<boolean> {
  set(busy, true);
  try {
    const result = await run();
    applyState(result.state);
    showFlash(result.flash ?? null);
    return result.flash?.tone !== 'danger';
  } catch (err) {
    showFlash({ tone: 'danger', text: errorText(err) });
    return false;
  } finally {
    set(busy, false);
  }
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('state.changed', (state) => applyState(state)));
  // worker 拿不到 Orca 的語言，由面板告訴它；失敗只影響通知與狀態列的語言，不擋清單
  void plugin.request('lang.set', { lang: panelLang() }).catch(() => undefined);
  void refresh();
}

function openPopup(next: Popup): void {
  set(confirmDelete, false);
  set(confirmStatus, null);
  set(popup, next);
}

function closePopup(): void {
  set(confirmDelete, false);
  set(confirmStatus, null);
  set(popup, null);
}

function openEditor(todo?: Todo): void {
  set(draft, todo ? draftFromTodo(todo) : emptyDraft());
  set(bodyTab, 'write');
  set(dateTimePicker, null);
  set(projectQuery, '');
  set(projectBrowse, false);
  openPopup({ kind: 'edit' });
  void loadProjectOptions(todo && !todo.project ? (todo.workspace ?? null) : null);
}

function patchDraft(patch: Partial<TodoDraft>): void {
  update(draft, (d) => ({ ...d, ...patch }));
}

/** 新增或編輯存好就回到清單 */
async function saveDraft(): Promise<void> {
  if (await act(() => plugin.request('todo.save', read(draft)))) {
    closePopup();
  }
}

/** 列表底部快速新增：只帶標題、其餘用預設值存檔，存好直接進該筆的編輯頁補其他欄位。 */
async function quickAdd(): Promise<void> {
  const title = read(quickTitle).trim();
  if (!title || read(busy)) {
    return;
  }
  let savedId: string | undefined;
  const ok = await act(async () => {
    const result = await plugin.request('todo.save', { ...emptyDraft(), title });
    savedId = result.savedId;
    return result;
  });
  const saved = ok && savedId ? read(view)?.todos.find((t) => t.id === savedId) : undefined;
  if (saved) {
    set(quickTitle, '');
    openEditor(saved);
  }
}

function setStatus(id: string, status: TodoStatus): Promise<boolean> {
  return act(() => plugin.request('todo.setStatus', { id, status }));
}

async function removeTodo(id: string): Promise<void> {
  if (await act(() => plugin.request('todo.delete', { id }))) {
    closePopup();
  }
}

/** legacy＝舊版只指定了工作區的 todo：載入後把下拉預設成該工作區所屬的專案 */
async function loadProjectOptions(legacy: TodoWorkspace | null): Promise<void> {
  set(projectOpts, null);
  let opts: ProjectOptions;
  try {
    opts = await plugin.request('project.options');
  } catch {
    opts = { available: false, projects: [], currentKey: null };
  }
  const owner = legacy ? opts.projects.find((p) => p.worktrees.some((w) => w.id === legacy.id)) : undefined;
  if (owner && read(draft).projectKey === '') {
    patchDraft({ projectKey: owner.key });
  }
  set(projectOpts, opts);
}

/** 只有一個工作樹就直接開，多個才進挑選頁 */
async function openProject(project: TodoProject): Promise<void> {
  try {
    const { worktrees, flash: result } = await plugin.request('project.worktrees', { key: project.key });
    if (result) {
      showFlash(result);
    } else if (worktrees.length === 1) {
      await openWorkspace(worktrees[0]!.id);
    } else {
      openPopup({ kind: 'pick', project, worktrees, back: read(popup) });
    }
  } catch (err) {
    showFlash({ tone: 'danger', text: errorText(err) });
  }
}

async function openWorkspace(id: string): Promise<void> {
  try {
    const { flash: result } = await plugin.request('workspace.open', { id });
    if (result) {
      showFlash(result);
    }
  } catch (err) {
    showFlash({ tone: 'danger', text: errorText(err) });
  }
}

async function testNotify(): Promise<void> {
  try {
    showFlash((await plugin.request('todo.testNotify')).flash);
  } catch (err) {
    showFlash({ tone: 'danger', text: errorText(err) });
  }
}

// ── 共用外觀 ──────────────────────────────────────────────

/** 有色按鈕：Button 的 tone 只有 accent（solid）與 danger 會上色，其他顏色改由外框 Box 的邊框呈現。 */
function TintButton(props: { tone: Tone; icon: IconName; disabled?: boolean; onPress: () => unknown; children: string }) {
  return (
    <Box border={props.tone} radius="sm">
      <Button size="xs" variant="ghost" icon={props.icon} disabled={props.disabled} onPress={props.onPress}>
        {props.children}
      </Button>
    </Box>
  );
}

/** 區塊外框：Card 沒有邊線參數、在側邊欄裡太淡，改用 Box 畫有色邊線。 */
function workspaceText(workspace: TodoWorkspace): string {
  return workspace.branch && workspace.branch !== workspace.name ? `${workspace.name} · ${workspace.branch}` : workspace.name;
}

/** 顯示 todo 指定的工作區，按下切過去 */
function WorkspaceButton({ workspace }: { workspace: TodoWorkspace }) {
  return (
    <Button
      size="xs"
      variant="ghost"
      icon={workspace.kind === 'folder' ? 'folder' : 'branch'}
      tooltip={msgs().workspaceJumpTooltip(workspace.name)}
      onPress={() => openWorkspace(workspace.id)}
    >
      {workspaceText(workspace)}
    </Button>
  );
}

/** 顯示 todo 指定的專案，按下挑要開的工作樹 */
function ProjectButton({ project }: { project: TodoProject }) {
  return (
    <Button
      size="xs"
      variant="ghost"
      icon={project.kind === 'folder' ? 'folder' : 'branch'}
      tooltip={msgs().projectJumpTooltip(project.name)}
      onPress={() => openProject(project)}
    >
      {project.name}
    </Button>
  );
}

/** todo 指定的專案；舊版只存了工作區的，照舊顯示工作區按鈕 */
function TodoLink({ todo }: { todo: Todo }) {
  if (todo.project) {
    return <ProjectButton project={todo.project} />;
  }
  return todo.workspace ? <WorkspaceButton workspace={todo.workspace} /> : null;
}

function hasLink(todo: Todo): boolean {
  return Boolean(todo.project ?? todo.workspace);
}

function Section({ title, tone = 'accent', children }: { title?: string; tone?: Tone; children?: OrcaNode }) {
  return (
    <Box border={tone} radius="lg" padding="md" background="card" gap="sm">
      {title ? <Heading level={3}>{title}</Heading> : null}
      {children}
    </Box>
  );
}

/** 內容頁時間條件的重點欄位：小標籤在上、大字的值在下 */
function KeyFact({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap="xs">
      <Text size="xs" muted>
        {label}
      </Text>
      <Text size="md" weight="semibold">
        {value}
      </Text>
    </Stack>
  );
}

/** 內容頁時間條件的附屬欄位：比 KeyValue 的 text-sm 再小一級 */
function MinorFact({ label, value }: { label: string; value: string }) {
  return (
    <Row gap="sm" align="start">
      <Box minWidth={56} shrink={false}>
        <Text size="xs" muted>
          {label}
        </Text>
      </Box>
      <Box grow minWidth={0}>
        <Text size="xs">{value}</Text>
      </Box>
    </Row>
  );
}

function Actions({ children }: { children?: OrcaNode }) {
  return (
    <Row justify="end" gap="xs" wrap>
      {children}
    </Row>
  );
}

function FlashBar() {
  const message = read(flash);
  if (!message) {
    return null;
  }
  return (
    <Box gap="sm" shrink={false}>
      <Separator />
      <Callout tone={message.tone}>
        <Row justify="between" align="center">
          <Text size="sm">{message.text}</Text>
          <IconButton icon="close" label={msgs().closeMessage} size="xs" variant="ghost" onPress={() => set(flash, null)} />
        </Row>
      </Callout>
    </Box>
  );
}

/** 整頁 popup 的骨架：上方標題列與返回鈕、中間捲動內容、下方固定動作列與訊息。 */
function PopupFrame({ title, footer, onBack = closePopup, children }: { title: string; footer?: OrcaNode; onBack?: () => unknown; children?: OrcaNode }) {
  const m = msgs();
  return (
    <Box height="100%" gap="md">
      <Box shrink={false} gap="sm">
        <Box paddingY="xs">
          <Row align="center" gap="sm">
            {/* 圖示集合沒有返回箭頭，用文字箭頭 */}
            <Button size="xs" variant="ghost" tooltip={m.backTooltip} onPress={onBack}>
              {m.back}
            </Button>
            <Text size="sm" weight="semibold">
              {title}
            </Text>
          </Row>
        </Box>
        <Separator />
      </Box>
      <Box grow minHeight={0} scroll="y">
        <Stack gap="md">{children}</Stack>
      </Box>
      {footer ? (
        <Box gap="sm" shrink={false}>
          <Separator />
          {footer}
        </Box>
      ) : null}
      <FlashBar />
    </Box>
  );
}

function ConfirmDelete({ title, onConfirm }: { title: string; onConfirm: () => unknown }) {
  const m = msgs();
  return (
    <Callout tone="danger" title={m.confirmDeleteTitle(title)}>
      <Stack gap="sm">
        <Text size="sm">{m.cannotUndo}</Text>
        <Actions>
          <Button size="xs" variant="outline" icon="close" onPress={() => set(confirmDelete, false)}>
            {m.cancel}
          </Button>
          <Button size="xs" variant="solid" tone="danger" icon="delete" disabled={read(busy)} onPress={onConfirm}>
            {m.confirmDelete}
          </Button>
        </Actions>
      </Stack>
    </Callout>
  );
}

/** 刪除與啟用／停用的確認同時只顯示一個 */
function askDelete(): void {
  set(confirmStatus, null);
  set(confirmDelete, true);
}

function askStatus(status: ConfirmableStatus): void {
  set(confirmDelete, false);
  set(confirmStatus, status);
}

function ConfirmStatus({ todo, status }: { todo: Todo; status: ConfirmableStatus }) {
  const m = msgs();
  const confirm = async () => {
    if (await setStatus(todo.id, status)) {
      set(confirmStatus, null);
    }
  };
  return (
    <Callout tone={status === 'enabled' ? 'success' : 'warning'} title={m.confirmStatusTitle[status](todo.title)}>
      <Stack gap="sm">
        <Text size="sm">{m.confirmStatusNote[status]}</Text>
        <Actions>
          <Button size="xs" variant="outline" icon="close" onPress={() => set(confirmStatus, null)}>
            {m.cancel}
          </Button>
          <TintButton tone={status === 'enabled' ? 'success' : 'warning'} icon={status === 'enabled' ? 'play' : 'pause'} disabled={read(busy)} onPress={confirm}>
            {m.confirmStatusAction[status]}
          </TintButton>
        </Actions>
      </Stack>
    </Callout>
  );
}

// ── 主畫面 ────────────────────────────────────────────────

/** 側欄最上方的醒目區：正在進行的 todo 與它的持續時間。 */
function OngoingCard({ items }: { items: ReturnType<typeof highlights>['ongoing'] }) {
  if (items.length === 0) {
    return null;
  }
  const lang = panelLang();
  const m = messages(lang);
  return (
    <Box border="warning" background="warning" radius="lg" padding="md" gap="sm">
      <Row justify="between" align="center">
        <Heading level={2}>{m.ongoing}</Heading>
        <Badge tone="warning">{m.itemCount(items.length)}</Badge>
      </Row>
      {items.map((o) => (
        <Box border="warning" background="card" radius="md" padding="sm" gap="xs">
          <Text size="md" weight="semibold">
            {o.todo.title}
          </Text>
          <Row gap="xs" align="center" wrap>
            <Badge tone="warning">{m.lasts(formatDuration(o.todo.durationMin, lang))}</Badge>
            <Text size="sm">{`${formatClock(o.start)} – ${formatClock(o.end)}`}</Text>
          </Row>
          <Actions>
            <Button size="xs" variant="outline" icon="file-text" onPress={() => openPopup({ kind: 'detail', id: o.todo.id })}>
              {m.view}
            </Button>
          </Actions>
        </Box>
      ))}
    </Box>
  );
}

function NextCard({ next, now }: { next: ReturnType<typeof highlights>['next']; now: number }) {
  if (!next) {
    return null;
  }
  const lang = panelLang();
  const m = messages(lang);
  const meta = [formatShort(next.at, now, lang), next.todo.durationMin > 0 ? m.lasts(formatDuration(next.todo.durationMin, lang)) : ''];
  return (
    <Box border="accent" radius="lg" padding="md" gap="xs">
      <Text size="xs" muted weight="medium">
        {m.next}
      </Text>
      <Row justify="between" align="center" gap="sm">
        <Box grow minWidth={0} gap="xs">
          <Text size="md" weight="semibold" truncate>
            {next.todo.title}
          </Text>
          <Text size="sm">{meta.filter(Boolean).join(' · ')}</Text>
        </Box>
        <Button size="xs" variant="outline" icon="file-text" onPress={() => openPopup({ kind: 'detail', id: next.todo.id })}>
          {m.view}
        </Button>
      </Row>
    </Box>
  );
}

function itemLine(todo: Todo, now: number): { icon: IconName; description: string } {
  const lang = panelLang();
  const m = messages(lang);
  const live = todo.status === 'enabled' ? ongoingAt(todo, now) : null;
  if (live) {
    return { icon: 'play', description: m.lineOngoing(formatClock(live.end)) };
  }
  if (todo.status === 'done') {
    return { icon: 'check', description: m.lineDone(formatShort(todo.updatedAt, now, lang)) };
  }
  if (todo.startAt === null) {
    return { icon: todo.status === 'disabled' ? 'pause' : 'file-text', description: m.unscheduled };
  }
  const parts: string[] = [];
  const at = nextAfter(todo, now);
  parts.push(at === null ? m.noMoreRuns : m.nextRun(formatShort(at, now, lang)));
  if (todo.repeat) {
    parts.push(describeRepeat(todo.repeat, lang));
  }
  if (todo.durationMin > 0) {
    parts.push(m.lasts(formatDuration(todo.durationMin, lang)));
  }
  const icon: IconName = todo.status === 'disabled' ? 'pause' : todo.notify ? 'bell' : 'calendar';
  return { icon, description: parts.join(' · ') };
}

/** 啟用：進行中優先，再依下一次時間；其他兩組依最後更新時間新到舊。 */
function sortGroup(todos: Todo[], status: TodoStatus, now: number): Todo[] {
  if (status !== 'enabled') {
    return [...todos].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  const key = (t: Todo) => (ongoingAt(t, now) ? -1 : (nextAfter(t, now) ?? Number.POSITIVE_INFINITY));
  return [...todos].sort((a, b) => key(a) - key(b) || b.updatedAt - a.updatedAt);
}

function Group({ status, todos, now }: { status: TodoStatus; todos: Todo[]; now: number }) {
  const m = msgs();
  const label = m.status[status];
  if (todos.length === 0) {
    return (
      <Text size="sm" muted>
        {m.emptyGroup(label)}
      </Text>
    );
  }
  // List 只能放 ListItem，ListItem 整列又是按鈕：有專案（或舊版工作區）的項目切成獨立一段，按鈕接在下方
  const segments: { items: Todo[]; link: Todo | null }[] = [];
  for (const todo of sortGroup(todos, status, now)) {
    const last = segments[segments.length - 1];
    if (!hasLink(todo) && last && !last.link) {
      last.items.push(todo);
    } else {
      segments.push({ items: [todo], link: hasLink(todo) ? todo : null });
    }
  }
  return (
    <Box border={STATUS_TONE[status]} radius="md" padding="xs">
      <Stack gap="none">
        {segments.map((segment) => (
          <Stack gap="none">
            <List label={label}>
              {segment.items.map((todo) => {
                const line = itemLine(todo, now);
                return (
                  <ListItem
                    title={todo.title}
                    description={line.description}
                    icon={line.icon}
                    current={line.icon === 'play'}
                    onPress={() => openPopup({ kind: 'detail', id: todo.id })}
                  />
                );
              })}
            </List>
            {segment.link ? (
              <Row justify="end">
                <TodoLink todo={segment.link} />
              </Row>
            ) : null}
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

function MainView({ state }: { state: ViewState }) {
  const now = Date.now();
  const { ongoing, next } = highlights(state.todos, now);
  const disabled = read(busy);
  const purgeable = state.todos.filter((t) => t.status !== 'enabled').length;
  const m = msgs();
  return (
    <Box height="100%" gap="sm">
      {/* 新增改由底部的快速新增；重新整理放在狀態頁籤同一行 */}
      <Row justify="end" gap="xs">
        <Button size="xs" variant="outline" icon="bell" disabled={disabled} onPress={testNotify}>
          {m.testNotify}
        </Button>
        <Button
          size="xs"
          variant="outline"
          tone="danger"
          icon="delete"
          tooltip={m.purgeTooltip}
          disabled={disabled || purgeable === 0}
          onPress={() => openPopup({ kind: 'purge' })}
        >
          {m.purge}
        </Button>
      </Row>
      <Box grow minHeight={0} scroll="y">
        <Stack gap="md">
          <OngoingCard items={ongoing} />
          <NextCard next={next} now={now} />
          {state.todos.length === 0 ? (
            <EmptyState icon="check" title={m.emptyTitle} description={m.emptyDescription} />
          ) : null}
          {/* 頁籤只當狀態切換、不放內容，右邊才放得下重新整理；清單接在下面 */}
          <Row align="center" gap="xs">
            <Box grow>
              {state.todos.length > 0 ? (
                <Tabs label={m.filterLabel} value={read(statusFilter)} onChange={(v) => set(statusFilter, v as TodoStatus)}>
                  {STATUS_ORDER.map((status) => (
                    <Tab value={status} label={m.tabLabel(m.status[status], state.todos.filter((t) => t.status === status).length)} />
                  ))}
                </Tabs>
              ) : null}
            </Box>
            <IconButton icon="refresh" label={m.refresh} size="xs" disabled={disabled} onPress={refresh} />
          </Row>
          {state.todos.length > 0 ? (
            <Group status={read(statusFilter)} todos={state.todos.filter((t) => t.status === read(statusFilter))} now={now} />
          ) : null}
        </Stack>
      </Box>
      <QuickAdd />
      <FlashBar />
    </Box>
  );
}

function QuickAdd() {
  const m = msgs();
  const empty = read(quickTitle).trim() === '';
  return (
    <Box gap="sm" shrink={false}>
      <Separator />
      <Row align="center" gap="xs">
        <Box grow>
          <Input
            label={m.quickAddLabel}
            labelHidden
            value={read(quickTitle)}
            maxLength={TITLE_MAX}
            placeholder={m.quickAddPlaceholder}
            disabled={read(busy)}
            onChange={(v) => set(quickTitle, v)}
            onSubmit={() => quickAdd()}
          />
        </Box>
        <Button size="xs" variant="solid" tone="accent" icon="add" disabled={read(busy) || empty} onPress={quickAdd}>
          {m.quickAddSubmit}
        </Button>
      </Row>
    </Box>
  );
}

// ── popup：檢視 ───────────────────────────────────────────

function DetailView({ todo }: { todo: Todo }) {
  const now = Date.now();
  const disabled = read(busy);
  const live = todo.status === 'enabled' ? ongoingAt(todo, now) : null;
  const at = nextAfter(todo, now);
  const lang = panelLang();
  const m = messages(lang);
  const footer = (
    <Stack gap="sm">
      {/* 三組：[刪除]、[完成／停用・啟用]、[編輯]；組間 lg、組內 xs，間距差得夠多才看得出分組 */}
      <Row justify="end" align="center" gap="lg" wrap>
        <Button size="xs" variant="outline" tone="danger" icon="delete" disabled={disabled} onPress={askDelete}>
          {m.delete}
        </Button>
        <Row align="center" gap="xs">
          {todo.status !== 'done' ? (
            <TintButton tone="success" icon="check" disabled={disabled} onPress={() => setStatus(todo.id, 'done')}>
              {m.markDone}
            </TintButton>
          ) : null}
          {todo.status === 'enabled' ? (
            <TintButton tone="warning" icon="pause" disabled={disabled} onPress={() => askStatus('disabled')}>
              {m.disable}
            </TintButton>
          ) : (
            <TintButton tone="success" icon="play" disabled={disabled} onPress={() => askStatus('enabled')}>
              {m.enable}
            </TintButton>
          )}
        </Row>
        <Button size="xs" variant="solid" tone="accent" icon="edit" disabled={disabled} onPress={() => openEditor(todo)}>
          {m.edit}
        </Button>
      </Row>
      {read(confirmDelete) ? <ConfirmDelete title={todo.title} onConfirm={() => removeTodo(todo.id)} /> : null}
      {read(confirmStatus) ? <ConfirmStatus todo={todo} status={read(confirmStatus)!} /> : null}
    </Stack>
  );
  return (
    <PopupFrame title={m.detailTitle} footer={footer}>
      {/* Heading 最大只有 text-base；Markdown 的 h1 是 18px，是元件面板裡最大的字 */}
      <Markdown key="detail-title" content={markdownHeading(todo.title)} />
      <Row gap="xs" wrap>
        <Badge tone={STATUS_TONE[todo.status]}>{m.status[todo.status]}</Badge>
        {live ? <Badge tone="warning">{m.badgeOngoing}</Badge> : null}
        {todo.notify && todo.startAt !== null ? <Badge tone="accent">{m.badgeNotify}</Badge> : null}
      </Row>
      {hasLink(todo) ? (
        <Row>
          <TodoLink todo={todo} />
        </Row>
      ) : null}
      {live ? (
        <Callout tone="warning" icon="play" title={m.ongoingCallout(formatDuration(todo.durationMin, lang))}>
          <Text size="sm">{`${formatClock(live.start)} – ${formatClock(live.end)}`}</Text>
        </Callout>
      ) : null}
      <Section title={m.timeSection}>
        <Box columns={2} gap="sm">
          <KeyFact label={m.startLabel} value={todo.startAt === null ? m.unscheduled : formatDateTime(todo.startAt)} />
          <KeyFact label={m.nextLabel} value={at === null ? '—' : formatDateTime(at)} />
        </Box>
        <Stack gap="xs">
          <MinorFact label={m.durationLabel} value={todo.durationMin > 0 ? formatDuration(todo.durationMin, lang) : '—'} />
          <MinorFact label={m.repeatLabel} value={describeRepeat(todo.repeat, lang)} />
          <MinorFact label={m.notifyLabel} value={todo.startAt === null ? m.notifyUnscheduled : todo.notify ? m.on : m.off} />
        </Stack>
      </Section>
      {/* 要做的事是內容頁的另一個重點：黃框，並跟上面的時間資訊多隔一點 */}
      <Box paddingY="sm">
        <Section title={m.bodySection} tone="warning">
          {todo.body.trim() ? <Markdown content={todo.body} /> : <Text size="sm" muted>{m.noBody}</Text>}
        </Section>
      </Box>
    </PopupFrame>
  );
}

// ── popup：新增／編輯 ─────────────────────────────────────

const REPEAT_UNITS: RepeatUnit[] = ['minute', 'hour', 'day', 'week', 'month'];

function repeatOptions(m: Messages): { value: RepeatUnit | 'none'; label: string }[] {
  return [{ value: 'none', label: m.repeatNone }, ...REPEAT_UNITS.map((unit) => ({ value: unit, label: m.repeatOption(unit) }))];
}

/** 帶入的時間取下一個整分鐘：存檔當下以前的場次不會通知，取整後馬上存仍趕得上。 */
function nextMinuteMs(): number {
  return Math.ceil((Date.now() + 1) / 60_000) * 60_000;
}

/** 截止時間的預設：明天的同一個整分（用 setDate 換日，不直接加 24 小時） */
function tomorrowMs(): number {
  const d = new Date(nextMinuteMs());
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: pad2(h) }));

/** 分鐘選項每 5 分一格；手打的值不在格上時也列進去，下拉才顯示得出目前值 */
function minuteOptions(current: number | null): { value: string; label: string }[] {
  const mins = Array.from({ length: 12 }, (_, i) => i * 5);
  if (current !== null && current % 5 !== 0) {
    mins.push(current);
    mins.sort((a, b) => a - b);
  }
  return mins.map((mi) => ({ value: String(mi), label: pad2(mi) }));
}

/** 欄位空白或打錯時，日曆與「帶入」按鈕的基準時間：開始時間取下一個整分，截止時間取明天同一時間 */
const PICKER_FALLBACK: Record<PickerField, () => number> = { start: nextMinuteMs, until: tomorrowMs };

/**
 * 日期時間欄位的日曆與時、分選單：按下就改寫 draft[field]，欄位仍可手打，驗證照舊走 parseDraft。
 * 欄位空白或打錯時，選日期沿用 PICKER_FALLBACK 的時分、選時分沿用其日期。
 */
function DateTimePicker({ field, ym, value }: { field: PickerField; ym: YearMonth; value: string }) {
  const m = msgs();
  const picked = parseLocalDateTime(value);
  const base = picked ?? PICKER_FALLBACK[field]();
  const now = Date.now();
  const setValue = (ms: number) => patchDraft({ [field]: formatDateTime(ms) });
  const pickedHour = picked === null ? undefined : String(new Date(picked).getHours());
  const pickedMinute = picked === null ? null : new Date(picked).getMinutes();
  return (
    <Box border radius="md" padding="sm" gap="xs">
      <Row justify="between" align="center">
        <Button size="xs" variant="ghost" onPress={() => set(dateTimePicker, { field, ym: shiftMonth(ym, -1) })}>
          {`‹ ${m.prevMonth}`}
        </Button>
        <Text size="sm" weight="medium">
          {m.monthTitle(ym.year, ym.month)}
        </Text>
        <Button size="xs" variant="ghost" onPress={() => set(dateTimePicker, { field, ym: shiftMonth(ym, 1) })}>
          {`${m.nextMonth} ›`}
        </Button>
      </Row>
      {/* Box columns 最多 6 欄，改用一週一列、每格 grow＋width 0 平分寬度 */}
      <Box direction="row" gap="xs">
        {m.weekdays.map((w) => (
          <Box grow width={0} align="center">
            <Text size="xs" muted>
              {w}
            </Text>
          </Box>
        ))}
      </Box>
      {monthWeeks(ym).map((week) => (
        <Box direction="row" gap="xs">
          {week.map((day) => {
            if (day === null) {
              return <Box grow width={0} />;
            }
            const selected = picked !== null && sameDay(picked, ym, day);
            return (
              <Box grow width={0} align="stretch">
                <Button
                  size="xs"
                  variant={selected ? 'solid' : sameDay(now, ym, day) ? 'outline' : 'ghost'}
                  tone={selected ? 'accent' : 'neutral'}
                  onPress={() => setValue(withDate(base, ym, day))}
                >
                  {String(day)}
                </Button>
              </Box>
            );
          })}
        </Box>
      ))}
      <Box columns={2} gap="sm">
        <Select
          label={m.hourLabel}
          value={pickedHour}
          placeholder="--"
          options={HOUR_OPTIONS}
          onChange={(v) => setValue(withTime(base, Number(v), new Date(base).getMinutes()))}
        />
        <Select
          label={m.minuteLabel}
          value={pickedMinute === null ? undefined : String(pickedMinute)}
          placeholder="--"
          options={minuteOptions(pickedMinute)}
          onChange={(v) => setValue(withTime(base, new Date(base).getHours(), Number(v)))}
        />
      </Box>
    </Box>
  );
}

/** 日期時間輸入框＋「帶入」與「選擇日期時間」按鈕＋展開的日曆 */
function DateTimeField(props: { field: PickerField; label: string; value: string; placeholder: string; fillLabel: string }) {
  const { field, value } = props;
  const m = msgs();
  const picker = read(dateTimePicker);
  const open = picker?.field === field;
  const fallback = PICKER_FALLBACK[field];
  return (
    <Stack gap="sm">
      <Input label={props.label} value={value} placeholder={props.placeholder} onChange={(v) => patchDraft({ [field]: v })} />
      <Actions>
        <Button size="xs" variant="outline" icon="calendar" onPress={() => patchDraft({ [field]: formatDateTime(fallback()) })}>
          {props.fillLabel}
        </Button>
        <Button
          size="xs"
          variant={open ? 'solid' : 'outline'}
          icon={open ? 'collapse' : 'expand'}
          onPress={() => set(dateTimePicker, open ? null : { field, ym: yearMonthOf(parseLocalDateTime(value) ?? fallback()) })}
        >
          {open ? m.pickerClose : m.pickerOpen}
        </Button>
      </Actions>
      {open && picker ? <DateTimePicker field={field} ym={picker.ym} value={value} /> : null}
    </Stack>
  );
}

function EditView({ state }: { state: ViewState }) {
  const d = read(draft);
  const disabled = read(busy);
  const existing = d.id ? state.todos.find((t) => t.id === d.id) : undefined;
  const hasStart = d.start.trim().length > 0;
  const m = msgs();
  const footer = (
    <Stack gap="xs">
      <Actions>
        {existing ? (
          <Button size="xs" variant="outline" tone="danger" icon="delete" disabled={disabled} onPress={() => set(confirmDelete, true)}>
            {m.delete}
          </Button>
        ) : null}
        <Button size="xs" variant="outline" icon="close" onPress={() => (existing ? openPopup({ kind: 'detail', id: existing.id }) : closePopup())}>
          {m.cancel}
        </Button>
        <Button size="xs" variant="solid" tone="accent" icon="check" disabled={disabled} onPress={saveDraft}>
          {m.save}
        </Button>
      </Actions>
      {existing && read(confirmDelete) ? <ConfirmDelete title={existing.title} onConfirm={() => removeTodo(existing.id)} /> : null}
    </Stack>
  );
  return (
    // 標題列用已儲存的標題，打字中的草稿不跟著變，存檔後才更新
    <PopupFrame title={existing ? existing.title : m.newTitle} footer={footer}>
      <Section title={m.basicSection}>
        <Input label={m.titleLabel} value={d.title} maxLength={TITLE_MAX} placeholder={m.titlePlaceholder} onChange={(v) => patchDraft({ title: v })} />
        <ProjectField draftKey={d.projectKey} existing={existing ?? null} />
        <Row justify="end" gap="xs">
          <Button size="xs" variant={read(bodyTab) === 'write' ? 'outline' : 'ghost'} icon="edit" onPress={() => set(bodyTab, 'write')}>
            {m.bodyWrite}
          </Button>
          <Button size="xs" variant={read(bodyTab) === 'preview' ? 'outline' : 'ghost'} icon="file-text" onPress={() => set(bodyTab, 'preview')}>
            {m.bodyPreview}
          </Button>
        </Row>
        {read(bodyTab) === 'write' ? (
          <Textarea
            label={m.bodyLabel}
            value={d.body}
            rows={10}
            maxLength={BODY_MAX}
            placeholder={m.bodyPlaceholder}
            onChange={(v) => update(draft, (cur) => ({ ...cur, body: assistMarkdown(cur.body, v) }))}
          />
        ) : (
          // 預覽沒有 Textarea 自帶的 label，用 Field 補上同一個標題
          <Field label={m.bodyLabel}>
            <Box border radius="md" padding="md" background="muted" minHeight={200}>
              {d.body.trim() ? <Markdown content={d.body} /> : <Text size="sm" muted>{m.noBody}</Text>}
            </Box>
          </Field>
        )}
      </Section>

      <Section title={m.timeSection}>
        <DateTimeField field="start" label={m.startLabel} value={d.start} placeholder={m.startPlaceholder} fillLabel={m.fillNow} />
        <Input label={m.durationInputLabel} value={d.duration} placeholder={m.durationPlaceholder} onChange={(v) => patchDraft({ duration: v })} />
        <Actions>
          {DURATION_PRESETS.map((minutes, i) => (
            <Button size="xs" variant="outline" tooltip={m.durationPresetTooltip(minutes)} onPress={() => patchDraft({ duration: String(minutes) })}>
              {m.durationPresets[i]}
            </Button>
          ))}
        </Actions>
        <Text size="xs" muted>
          {m.durationHint}
        </Text>
        <Select
          label={m.repeatLabel}
          value={d.repeatUnit}
          options={repeatOptions(m)}
          onChange={(v) => patchDraft({ repeatUnit: v as RepeatUnit | 'none' })}
        />
        {d.repeatUnit !== 'none' ? (
          <Stack gap="sm">
            <Input label={m.everyLabel(d.repeatUnit)} value={d.every} placeholder="1" onChange={(v) => patchDraft({ every: v })} />
            <RadioGroup
              label={m.endLabel}
              orientation="horizontal"
              value={d.endKind}
              options={[
                { value: 'never', label: m.endNever },
                { value: 'count', label: m.endCount },
                { value: 'until', label: m.endUntil },
              ]}
              onChange={(v) => patchDraft({ endKind: v as TodoDraft['endKind'] })}
            />
            {d.endKind === 'count' ? (
              <Input label={m.countLabel} value={d.count} placeholder={m.countPlaceholder} onChange={(v) => patchDraft({ count: v })} />
            ) : null}
            {d.endKind === 'until' ? (
              <DateTimeField field="until" label={m.untilLabel} value={d.until} placeholder="2026-12-31 23:59" fillLabel={m.fillTomorrow} />
            ) : null}
          </Stack>
        ) : null}
        <Switch label={m.notifySwitch} checked={d.notify} disabled={!hasStart} onChange={(v) => patchDraft({ notify: v })} />
        {hasStart ? null : (
          <Text size="xs" muted>
            {m.notifyNeedsStart}
          </Text>
        )}
      </Section>

      <Section title={m.statusSection}>
        <RadioGroup
          label={m.statusSection}
          labelHidden
          orientation="horizontal"
          value={d.status}
          options={STATUS_ORDER.map((s) => ({ value: s, label: m.status[s] }))}
          onChange={(v) => patchDraft({ status: v as TodoStatus })}
        />
      </Section>
    </PopupFrame>
  );
}

/** 展開的專案清單最多這麼高，超過就在框內捲動 */
const LIST_MAX_HEIGHT = 240;

/** 以空白分詞、不分大小寫，每個詞都要出現在「群組 / 專案」裡；沒輸入就是全部 */
function matchProjects(projects: ProjectOption[], query: string): ProjectOption[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return projects.filter((p) => {
    const text = `${p.group} / ${p.name}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/**
 * 一個輸入框兼搜尋與選擇（仿 select2）：Select 不能搜尋，元件目錄也沒有 Combobox。
 * 沒在打字時，輸入框的 placeholder 顯示已選的專案；打字就篩選，按右邊展開鈕列出全部，點一筆選定。
 * existing＝正在編輯的這筆：存著的專案已不在清單上時仍顯示得出名稱，存檔不會被默默清掉；
 * 舊版只存了工作區、又對不到專案的，提示存檔後會清除。
 */
function ProjectField({ draftKey, existing }: { draftKey: string; existing: Todo | null }) {
  const m = msgs();
  const opts = read(projectOpts);
  if (!opts) {
    return <Spinner label={m.projectLoading} />;
  }
  if (!opts.available) {
    return (
      <Text size="xs" muted>
        {m.workspaceUnavailable}
      </Text>
    );
  }
  const selected = opts.projects.find((p) => p.key === draftKey);
  const saved = existing?.project;
  const selectedLabel = selected
    ? m.projectOption(selected.group, selected.name, selected.kind, selected.worktrees.length)
    : saved && saved.key === draftKey
      ? m.projectUnlisted(saved.name)
      : null;
  const legacyLost = existing && !existing.project && existing.workspace && draftKey === '' ? existing.workspace : null;
  const current = opts.currentKey;
  const query = read(projectQuery);
  const searching = query.trim() !== '';
  const open = searching || read(projectBrowse);
  const shown = matchProjects(opts.projects, query);
  const pick = (key: string) => {
    patchDraft({ projectKey: key });
    set(projectQuery, '');
    set(projectBrowse, false);
  };
  const toggle = () => {
    set(projectQuery, '');
    set(projectBrowse, !open);
  };
  return (
    <Stack gap="sm">
      <Row align="end" gap="xs">
        <Box grow>
          <Input
            label={m.projectLabel}
            type="search"
            value={query}
            placeholder={selectedLabel ?? m.projectSearchPlaceholder}
            onChange={(v) => set(projectQuery, v)}
            onSubmit={() => searching && shown[0] && pick(shown[0].key)}
          />
        </Box>
        {draftKey ? <IconButton icon="close" label={m.projectClear} size="xs" onPress={() => pick('')} /> : null}
        <IconButton icon={open ? 'collapse' : 'expand'} label={open ? m.projectCollapse : m.projectExpand} size="xs" onPress={toggle} />
      </Row>
      {open ? (
        shown.length === 0 ? (
          <Text size="xs" muted>
            {m.projectSearchNone}
          </Text>
        ) : (
          <Box border="accent" radius="sm" padding="xs" maxHeight={LIST_MAX_HEIGHT} scroll="y">
            <List label={m.projectSearchResults}>
              {shown.map((p) => (
                <ListItem
                  title={p.name}
                  description={m.projectSearchHit(p.group, p.kind, p.worktrees.length)}
                  icon={p.kind === 'folder' ? 'folder' : 'branch'}
                  current={p.key === draftKey}
                  onPress={() => pick(p.key)}
                />
              ))}
            </List>
          </Box>
        )
      ) : null}
      {/* 說明收進 ⓘ 的 tooltip；按鈕停用時另以自己的 tooltip 說明認不出目前專案 */}
      <Actions>
        <IconButton icon="info" label={m.projectHelp} tooltip={m.projectHint} size="xs" variant="ghost" />
        <Button
          size="xs"
          variant="outline"
          icon="branch"
          tooltip={current ? undefined : m.projectNoCurrent}
          disabled={!current}
          onPress={() => current && pick(current)}
        >
          {m.projectUseCurrent}
        </Button>
      </Actions>
      {legacyLost ? (
        <Text size="xs" tone="warning">
          {m.projectLegacyLost(legacyLost.name)}
        </Text>
      ) : null}
    </Stack>
  );
}

// ── popup：挑工作樹 ───────────────────────────────────────

function PickView({ pick }: { pick: Extract<Popup, { kind: 'pick' }> }) {
  const m = msgs();
  const back = () => (pick.back ? openPopup(pick.back) : closePopup());
  const choose = async (id: string) => {
    await openWorkspace(id);
    back();
  };
  return (
    <PopupFrame title={m.pickTitle(pick.project.name)} onBack={back}>
      {pick.worktrees.length === 0 ? (
        <Text size="sm" muted>
          {m.projectGone}
        </Text>
      ) : (
        <List label={m.pickListLabel}>
          {pick.worktrees.map((w) => (
            <ListItem
              title={w.name}
              description={w.branch ?? m.worktreeFolder}
              icon={w.kind === 'folder' ? 'folder' : 'branch'}
              onPress={() => choose(w.id)}
            />
          ))}
        </List>
      )}
    </PopupFrame>
  );
}

// ── popup：批次刪除 ───────────────────────────────────────

function PurgeView({ state }: { state: ViewState }) {
  const choice = read(purgeChoice);
  const targets = state.todos.filter((t) => t.status !== 'enabled' && choice[t.status]);
  const count = (s: PurgeStatus) => state.todos.filter((t) => t.status === s).length;
  const statuses = (Object.keys(choice) as PurgeStatus[]).filter((s) => choice[s]);
  const m = msgs();
  const confirm = async () => {
    if (await act(() => plugin.request('todo.purge', { statuses }))) {
      closePopup();
    }
  };
  const footer = (
    <Actions>
      <Button size="xs" variant="outline" icon="close" onPress={closePopup}>
        {m.cancel}
      </Button>
      <Button size="xs" variant="solid" tone="danger" icon="delete" disabled={read(busy) || targets.length === 0} onPress={confirm}>
        {m.purgeConfirm(targets.length)}
      </Button>
    </Actions>
  );
  return (
    <PopupFrame title={m.purge} footer={footer}>
      <Section title={m.purgeSection} tone="danger">
        <Checkbox
          label={m.purgeOption(m.status.done, count('done'))}
          checked={choice.done}
          onChange={(v) => update(purgeChoice, (c) => ({ ...c, done: v }))}
        />
        <Checkbox
          label={m.purgeOption(m.status.disabled, count('disabled'))}
          checked={choice.disabled}
          onChange={(v) => update(purgeChoice, (c) => ({ ...c, disabled: v }))}
        />
        <Text size="xs" muted>
          {m.purgeKeepsEnabled}
        </Text>
      </Section>
      {targets.length > 0 ? (
        <Callout tone="danger" title={m.purgeListTitle(targets.length)}>
          <Stack gap="xs">
            {targets.map((t) => (
              <Text size="sm">{m.purgeListItem(t.title, m.status[t.status])}</Text>
            ))}
          </Stack>
        </Callout>
      ) : (
        <Text size="sm" muted>
          {m.nothingMatched}
        </Text>
      )}
    </PopupFrame>
  );
}

export default function Panel() {
  const state = read(view);
  if (!state) {
    const failure = read(flash);
    const m = msgs();
    return failure ? (
      <Callout tone="danger" title={m.loadFailedTitle}>
        <Stack gap="sm">
          <Text size="sm">{failure.text}</Text>
          <Button size="sm" icon="refresh" onPress={refresh}>
            {m.retry}
          </Button>
        </Stack>
      </Callout>
    ) : (
      <Spinner label={m.loading} />
    );
  }
  const open = read(popup);
  if (open?.kind === 'edit') {
    return <EditView state={state} />;
  }
  if (open?.kind === 'purge') {
    return <PurgeView state={state} />;
  }
  if (open?.kind === 'pick') {
    return <PickView pick={open} />;
  }
  if (open?.kind === 'detail') {
    const todo = state.todos.find((t) => t.id === open.id);
    if (todo) {
      return <DetailView todo={todo} />;
    }
  }
  return <MainView state={state} />;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
