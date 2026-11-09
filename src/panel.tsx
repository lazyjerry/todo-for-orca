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
  Heading,
  IconButton,
  Input,
  KeyValue,
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
import { BODY_MAX, draftFromTodo, emptyDraft, TITLE_MAX } from './core/draft.ts';
import { describeRepeat, formatClock, formatDateTime, formatDuration, formatShort, STATUS_LABELS, UNIT_LABELS } from './core/format.ts';
import { highlights, nextAfter, ongoingAt } from './core/schedule.ts';
import type { RepeatUnit, Todo, TodoDraft, TodoStatus } from './core/types.ts';
import type { ActionResult, Flash, PurgeStatus, ViewState } from './protocol.ts';

type Popup = { kind: 'detail'; id: string } | { kind: 'edit' } | { kind: 'purge' };

const view = atom<ViewState | null>(null);
const flash = atom<Flash | null>(null);
const busy = atom(false);
const popup = atom<Popup | null>(null);
const draft = atom<TodoDraft>(emptyDraft());
const confirmDelete = atom(false);
const bodyTab = atom('write');
/** 清單只顯示一種狀態；不持久化，重開面板回到預設的「啟用」。 */
const statusFilter = atom<TodoStatus>('enabled');
const purgeChoice = atom<Record<PurgeStatus, boolean>>({ done: true, disabled: false });

const STATUS_ORDER: TodoStatus[] = ['enabled', 'disabled', 'done'];
/** 狀態的代表色：清單外框、徽章共用，讓三組一眼分得開。 */
const STATUS_TONE: Record<TodoStatus, Tone> = { enabled: 'accent', disabled: 'warning', done: 'success' };
const FLASH_TIMEOUT_MS = 4000;

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
    showFlash({ tone: 'danger', text: `讀取清單失敗：${errorText(err)}` });
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
  void refresh();
}

function openPopup(next: Popup): void {
  set(confirmDelete, false);
  set(popup, next);
}

function closePopup(): void {
  set(confirmDelete, false);
  set(popup, null);
}

function openEditor(todo?: Todo): void {
  set(draft, todo ? draftFromTodo(todo) : emptyDraft());
  set(bodyTab, 'write');
  openPopup({ kind: 'edit' });
}

function patchDraft(patch: Partial<TodoDraft>): void {
  update(draft, (d) => ({ ...d, ...patch }));
}

async function saveDraft(): Promise<void> {
  let savedId: string | undefined;
  const ok = await act(async () => {
    const result = await plugin.request('todo.save', read(draft));
    savedId = result.savedId;
    return result;
  });
  if (ok && savedId) {
    openPopup({ kind: 'detail', id: savedId });
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

async function testNotify(id: string): Promise<void> {
  try {
    showFlash((await plugin.request('todo.testNotify', { id })).flash);
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
function Section({ title, tone = 'accent', children }: { title?: string; tone?: Tone; children?: OrcaNode }) {
  return (
    <Box border={tone} radius="lg" padding="md" background="card" gap="sm">
      {title ? <Heading level={3}>{title}</Heading> : null}
      {children}
    </Box>
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
          <IconButton icon="close" label="關閉訊息" size="xs" variant="ghost" onPress={() => set(flash, null)} />
        </Row>
      </Callout>
    </Box>
  );
}

/** 整頁 popup 的骨架：上方標題列與返回鈕、中間捲動內容、下方固定動作列與訊息。 */
function PopupFrame({ title, footer, children }: { title: string; footer?: OrcaNode; children?: OrcaNode }) {
  return (
    <Box height="100%" gap="md">
      <Box shrink={false} gap="sm">
        <Box paddingY="xs">
          <Row align="center" gap="sm">
            {/* 圖示集合沒有返回箭頭，用文字箭頭 */}
            <Button size="xs" variant="ghost" tooltip="回到清單" onPress={closePopup}>
              ← 返回
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
  return (
    <Callout tone="danger" title={`確定刪除「${title}」？`}>
      <Stack gap="sm">
        <Text size="sm">刪除後無法復原。</Text>
        <Actions>
          <Button size="xs" variant="outline" icon="close" onPress={() => set(confirmDelete, false)}>
            取消
          </Button>
          <Button size="xs" variant="solid" tone="danger" icon="delete" disabled={read(busy)} onPress={onConfirm}>
            確定刪除
          </Button>
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
  return (
    <Box border="warning" background="warning" radius="lg" padding="md" gap="sm">
      <Row justify="between" align="center">
        <Heading level={2}>正在進行</Heading>
        <Badge tone="warning">{`${items.length} 項`}</Badge>
      </Row>
      {items.map((o) => (
        <Box border="warning" background="card" radius="md" padding="sm" gap="xs">
          <Text size="md" weight="semibold">
            {o.todo.title}
          </Text>
          <Row gap="xs" align="center" wrap>
            <Badge tone="warning">{`持續 ${formatDuration(o.todo.durationMin)}`}</Badge>
            <Text size="sm">{`${formatClock(o.start)} – ${formatClock(o.end)}`}</Text>
          </Row>
          <Actions>
            <Button size="xs" variant="outline" icon="file-text" onPress={() => openPopup({ kind: 'detail', id: o.todo.id })}>
              查看
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
  const meta = [formatShort(next.at, now), next.todo.durationMin > 0 ? `持續 ${formatDuration(next.todo.durationMin)}` : ''];
  return (
    <Box border="accent" radius="lg" padding="md" gap="xs">
      <Text size="xs" muted weight="medium">
        下一個
      </Text>
      <Row justify="between" align="center" gap="sm">
        <Box grow minWidth={0} gap="xs">
          <Text size="md" weight="semibold" truncate>
            {next.todo.title}
          </Text>
          <Text size="sm">{meta.filter(Boolean).join(' · ')}</Text>
        </Box>
        <Button size="xs" variant="outline" icon="file-text" onPress={() => openPopup({ kind: 'detail', id: next.todo.id })}>
          查看
        </Button>
      </Row>
    </Box>
  );
}

function itemLine(todo: Todo, now: number): { icon: IconName; description: string } {
  const live = todo.status === 'enabled' ? ongoingAt(todo, now) : null;
  if (live) {
    return { icon: 'play', description: `進行中 · 至 ${formatClock(live.end)}` };
  }
  if (todo.status === 'done') {
    return { icon: 'check', description: `完成於 ${formatShort(todo.updatedAt, now)}` };
  }
  if (todo.startAt === null) {
    return { icon: todo.status === 'disabled' ? 'pause' : 'file-text', description: '未排程' };
  }
  const parts: string[] = [];
  const at = nextAfter(todo, now);
  parts.push(at === null ? '已無後續場次' : `下一次 ${formatShort(at, now)}`);
  if (todo.repeat) {
    parts.push(describeRepeat(todo.repeat));
  }
  if (todo.durationMin > 0) {
    parts.push(`持續 ${formatDuration(todo.durationMin)}`);
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
  const label = STATUS_LABELS[status];
  if (todos.length === 0) {
    return (
      <Text size="sm" muted>
        {`沒有${label}的 todo`}
      </Text>
    );
  }
  return (
    <Box border={STATUS_TONE[status]} radius="md" padding="xs">
      <List label={label}>
        {sortGroup(todos, status, now).map((todo) => {
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
    </Box>
  );
}

function MainView({ state }: { state: ViewState }) {
  const now = Date.now();
  const { ongoing, next } = highlights(state.todos, now);
  const disabled = read(busy);
  const purgeable = state.todos.filter((t) => t.status !== 'enabled').length;
  return (
    <Box height="100%" gap="sm">
      <Row justify="end" gap="xs">
        <IconButton icon="add" label="新增 Todo" size="xs" variant="solid" tone="accent" disabled={disabled} onPress={() => openEditor()} />
        <IconButton
          icon="delete"
          label="批次刪除"
          tooltip="批次刪除已完成或停用的 todo"
          size="xs"
          variant="outline"
          tone="danger"
          disabled={disabled || purgeable === 0}
          onPress={() => openPopup({ kind: 'purge' })}
        />
        <IconButton icon="refresh" label="重新整理" size="xs" disabled={disabled} onPress={refresh} />
      </Row>
      <Box grow minHeight={0} scroll="y">
        <Stack gap="md">
          <OngoingCard items={ongoing} />
          <NextCard next={next} now={now} />
          {state.todos.length === 0 ? (
            <EmptyState icon="check" title="還沒有 todo" description="按右上角的「＋」建立第一筆；設定開始時間後，到時會發送桌面通知。" />
          ) : null}
          {state.todos.length > 0 ? (
            <Tabs label="依狀態過濾" value={read(statusFilter)} onChange={(v) => set(statusFilter, v as TodoStatus)}>
              {STATUS_ORDER.map((status) => {
                const todos = state.todos.filter((t) => t.status === status);
                return (
                  <Tab value={status} label={`${STATUS_LABELS[status]} ${todos.length}`}>
                    <Group status={status} todos={todos} now={now} />
                  </Tab>
                );
              })}
            </Tabs>
          ) : null}
        </Stack>
      </Box>
      <FlashBar />
    </Box>
  );
}

// ── popup：檢視 ───────────────────────────────────────────

function DetailView({ todo }: { todo: Todo }) {
  const now = Date.now();
  const disabled = read(busy);
  const live = todo.status === 'enabled' ? ongoingAt(todo, now) : null;
  const at = nextAfter(todo, now);
  const footer = (
    <Stack gap="sm">
      <Row justify="end" align="center" gap="sm" wrap>
        <Button size="xs" variant="outline" tone="danger" icon="delete" disabled={disabled} onPress={() => set(confirmDelete, true)}>
          刪除
        </Button>
        <Row align="center" gap="xs">
          {todo.status !== 'done' ? (
            <TintButton tone="success" icon="check" disabled={disabled} onPress={() => setStatus(todo.id, 'done')}>
              完成
            </TintButton>
          ) : null}
          {todo.status === 'enabled' ? (
            <TintButton tone="warning" icon="pause" disabled={disabled} onPress={() => setStatus(todo.id, 'disabled')}>
              停用
            </TintButton>
          ) : (
            <TintButton tone="success" icon="play" disabled={disabled} onPress={() => setStatus(todo.id, 'enabled')}>
              啟用
            </TintButton>
          )}
        </Row>
        <Row align="center" gap="xs">
          <Button size="xs" variant="outline" icon="bell" disabled={disabled} onPress={() => testNotify(todo.id)}>
            測試通知
          </Button>
          <Button size="xs" variant="solid" tone="accent" icon="edit" disabled={disabled} onPress={() => openEditor(todo)}>
            編輯
          </Button>
        </Row>
      </Row>
      {read(confirmDelete) ? <ConfirmDelete title={todo.title} onConfirm={() => removeTodo(todo.id)} /> : null}
    </Stack>
  );
  return (
    <PopupFrame title="Todo 內容" footer={footer}>
      <Heading level={1}>{todo.title}</Heading>
      <Row gap="xs" wrap>
        <Badge tone={STATUS_TONE[todo.status]}>{STATUS_LABELS[todo.status]}</Badge>
        {live ? <Badge tone="warning">進行中</Badge> : null}
        {todo.notify && todo.startAt !== null ? <Badge tone="accent">通知開啟</Badge> : null}
      </Row>
      {live ? (
        <Callout tone="warning" icon="play" title={`正在進行：持續 ${formatDuration(todo.durationMin)}`}>
          <Text size="sm">{`${formatClock(live.start)} – ${formatClock(live.end)}`}</Text>
        </Callout>
      ) : null}
      <Section title="時間條件">
        <KeyValue
          items={[
            { label: '開始時間', value: todo.startAt === null ? '未排程' : formatDateTime(todo.startAt) },
            { label: '持續時間', value: todo.durationMin > 0 ? formatDuration(todo.durationMin) : '—' },
            { label: '重複', value: describeRepeat(todo.repeat) },
            { label: '下一次', value: at === null ? '—' : formatDateTime(at) },
            { label: '桌面通知', value: todo.startAt === null ? '—（未排程）' : todo.notify ? '開啟' : '關閉' },
          ]}
        />
      </Section>
      <Section title="要做的事情">
        {todo.body.trim() ? <Markdown content={todo.body} /> : <Text size="sm" muted>（沒有內容）</Text>}
      </Section>
    </PopupFrame>
  );
}

// ── popup：新增／編輯 ─────────────────────────────────────

const REPEAT_OPTIONS: { value: RepeatUnit | 'none'; label: string }[] = [
  { value: 'none', label: '不重複' },
  ...(Object.keys(UNIT_LABELS) as RepeatUnit[]).map((unit) => ({ value: unit, label: `每 N ${UNIT_LABELS[unit]}` })),
];

/** 帶入的時間取下一個整分鐘：存檔當下以前的場次不會通知，取整後馬上存仍趕得上。 */
function nextMinute(): string {
  return formatDateTime(Math.ceil((Date.now() + 1) / 60_000) * 60_000);
}

function EditView({ state }: { state: ViewState }) {
  const d = read(draft);
  const disabled = read(busy);
  const existing = d.id ? state.todos.find((t) => t.id === d.id) : undefined;
  const hasStart = d.start.trim().length > 0;
  const footer = (
    <Stack gap="xs">
      <Actions>
        {existing ? (
          <Button size="xs" variant="outline" tone="danger" icon="delete" disabled={disabled} onPress={() => set(confirmDelete, true)}>
            刪除
          </Button>
        ) : null}
        <Button size="xs" variant="outline" icon="close" onPress={() => (existing ? openPopup({ kind: 'detail', id: existing.id }) : closePopup())}>
          取消
        </Button>
        <Button size="xs" variant="solid" tone="accent" icon="check" disabled={disabled} onPress={saveDraft}>
          儲存
        </Button>
      </Actions>
      {existing && read(confirmDelete) ? <ConfirmDelete title={existing.title} onConfirm={() => removeTodo(existing.id)} /> : null}
    </Stack>
  );
  return (
    <PopupFrame title={existing ? '編輯 Todo' : '新增 Todo'} footer={footer}>
      <Section title="基本資料">
        <Input label="標題" value={d.title} maxLength={TITLE_MAX} placeholder="單行標題" onChange={(v) => patchDraft({ title: v })} />
        <Tabs label="要做的事情" value={read(bodyTab)} onChange={(v) => set(bodyTab, v)}>
          <Tab value="write" label="撰寫" icon="edit">
            <Textarea
              label="要做的事情（Markdown）"
              value={d.body}
              rows={10}
              maxLength={BODY_MAX}
              placeholder={'- [ ] 第一步\n- [ ] 第二步'}
              onChange={(v) => patchDraft({ body: v })}
            />
          </Tab>
          <Tab value="preview" label="預覽" icon="file-text">
            {d.body.trim() ? <Markdown content={d.body} /> : <Text size="sm" muted>（沒有內容）</Text>}
          </Tab>
        </Tabs>
      </Section>

      <Section title="時間條件">
        <Input label="開始時間" value={d.start} placeholder="2026-11-10 14:00（留空＝不排程）" onChange={(v) => patchDraft({ start: v })} />
        <Actions>
          <Button size="xs" variant="outline" icon="calendar" onPress={() => patchDraft({ start: nextMinute() })}>
            帶入現在時間
          </Button>
        </Actions>
        <Input label="持續時間（分鐘）" value={d.duration} placeholder="0 或留空＝不標記" onChange={(v) => patchDraft({ duration: v })} />
        <Text size="xs" muted>
          持續時間目前只用來標記：場次開始後的這段時間，會顯示在側欄最上方與狀態列的「進行中」。
        </Text>
        <Select
          label="重複"
          value={d.repeatUnit}
          options={REPEAT_OPTIONS}
          onChange={(v) => patchDraft({ repeatUnit: v as RepeatUnit | 'none' })}
        />
        {d.repeatUnit !== 'none' ? (
          <Stack gap="sm">
            <Input label={`每隔幾${UNIT_LABELS[d.repeatUnit]}`} value={d.every} placeholder="1" onChange={(v) => patchDraft({ every: v })} />
            <RadioGroup
              label="停止條件"
              orientation="horizontal"
              value={d.endKind}
              options={[
                { value: 'never', label: '不停止' },
                { value: 'count', label: '重複次數' },
                { value: 'until', label: '截止時間' },
              ]}
              onChange={(v) => patchDraft({ endKind: v as TodoDraft['endKind'] })}
            />
            {d.endKind === 'count' ? (
              <Input label="總次數（含第一次）" value={d.count} placeholder="例如 5" onChange={(v) => patchDraft({ count: v })} />
            ) : null}
            {d.endKind === 'until' ? (
              <Input label="截止時間" value={d.until} placeholder="2026-12-31 23:59" onChange={(v) => patchDraft({ until: v })} />
            ) : null}
          </Stack>
        ) : null}
        <Switch label="到時發送桌面通知" checked={d.notify} disabled={!hasStart} onChange={(v) => patchDraft({ notify: v })} />
        {hasStart ? null : (
          <Text size="xs" muted>
            填了開始時間才會通知。
          </Text>
        )}
      </Section>

      <Section title="狀態">
        <RadioGroup
          label="狀態"
          labelHidden
          orientation="horizontal"
          value={d.status}
          options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
          onChange={(v) => patchDraft({ status: v as TodoStatus })}
        />
      </Section>
    </PopupFrame>
  );
}

// ── popup：批次刪除 ───────────────────────────────────────

function PurgeView({ state }: { state: ViewState }) {
  const choice = read(purgeChoice);
  const targets = state.todos.filter((t) => t.status !== 'enabled' && choice[t.status]);
  const count = (s: PurgeStatus) => state.todos.filter((t) => t.status === s).length;
  const statuses = (Object.keys(choice) as PurgeStatus[]).filter((s) => choice[s]);
  const confirm = async () => {
    if (await act(() => plugin.request('todo.purge', { statuses }))) {
      closePopup();
    }
  };
  const footer = (
    <Actions>
      <Button size="xs" variant="outline" icon="close" onPress={closePopup}>
        取消
      </Button>
      <Button size="xs" variant="solid" tone="danger" icon="delete" disabled={read(busy) || targets.length === 0} onPress={confirm}>
        {`確定刪除 ${targets.length} 筆`}
      </Button>
    </Actions>
  );
  return (
    <PopupFrame title="批次刪除" footer={footer}>
      <Section title="要刪除哪些狀態" tone="danger">
        <Checkbox
          label={`已完成（${count('done')} 筆）`}
          checked={choice.done}
          onChange={(v) => update(purgeChoice, (c) => ({ ...c, done: v }))}
        />
        <Checkbox
          label={`停用（${count('disabled')} 筆）`}
          checked={choice.disabled}
          onChange={(v) => update(purgeChoice, (c) => ({ ...c, disabled: v }))}
        />
        <Text size="xs" muted>
          啟用中的 todo 不會被刪除。
        </Text>
      </Section>
      {targets.length > 0 ? (
        <Callout tone="danger" title={`將刪除以下 ${targets.length} 筆，刪除後無法復原`}>
          <Stack gap="xs">
            {targets.map((t) => (
              <Text size="sm">{`・${t.title}（${STATUS_LABELS[t.status]}）`}</Text>
            ))}
          </Stack>
        </Callout>
      ) : (
        <Text size="sm" muted>
          沒有符合的項目。
        </Text>
      )}
    </PopupFrame>
  );
}

export default function Panel() {
  const state = read(view);
  if (!state) {
    const failure = read(flash);
    return failure ? (
      <Callout tone="danger" title="無法載入清單">
        <Stack gap="sm">
          <Text size="sm">{failure.text}</Text>
          <Button size="sm" icon="refresh" onPress={refresh}>
            重試
          </Button>
        </Stack>
      </Callout>
    ) : (
      <Spinner label="載入清單" />
    );
  }
  const open = read(popup);
  if (open?.kind === 'edit') {
    return <EditView state={state} />;
  }
  if (open?.kind === 'purge') {
    return <PurgeView state={state} />;
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
