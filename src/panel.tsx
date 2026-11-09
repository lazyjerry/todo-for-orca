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
import { describeRepeat, formatClock, formatDateTime, formatDuration, formatShort } from './core/format.ts';
import { type Lang, type Messages, messages, pickLang } from './core/i18n.ts';
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
const quickTitle = atom('');
const bodyTab = atom('write');
/** 清單只顯示一種狀態；不持久化，重開面板回到預設的「啟用」。 */
const statusFilter = atom<TodoStatus>('enabled');
const purgeChoice = atom<Record<PurgeStatus, boolean>>({ done: true, disabled: false });

const STATUS_ORDER: TodoStatus[] = ['enabled', 'disabled', 'done'];
/** 狀態的代表色：清單外框、徽章共用，讓三組一眼分得開。 */
const STATUS_TONE: Record<TodoStatus, Tone> = { enabled: 'accent', disabled: 'warning', done: 'success' };
const FLASH_TIMEOUT_MS = 4000;
/** 持續時間快速按鈕（分鐘），順序對應 i18n 的 durationPresets */
const DURATION_PRESETS = [15, 30, 120, 480] as const;

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
          <IconButton icon="close" label={msgs().closeMessage} size="xs" variant="ghost" onPress={() => set(flash, null)} />
        </Row>
      </Callout>
    </Box>
  );
}

/** 整頁 popup 的骨架：上方標題列與返回鈕、中間捲動內容、下方固定動作列與訊息。 */
function PopupFrame({ title, footer, children }: { title: string; footer?: OrcaNode; children?: OrcaNode }) {
  const m = msgs();
  return (
    <Box height="100%" gap="md">
      <Box shrink={false} gap="sm">
        <Box paddingY="xs">
          <Row align="center" gap="sm">
            {/* 圖示集合沒有返回箭頭，用文字箭頭 */}
            <Button size="xs" variant="ghost" tooltip={m.backTooltip} onPress={closePopup}>
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
  const m = msgs();
  return (
    <Box height="100%" gap="sm">
      <Row justify="end" gap="xs">
        <IconButton icon="add" label={m.addTodo} size="xs" variant="solid" tone="accent" disabled={disabled} onPress={() => openEditor()} />
        <IconButton
          icon="delete"
          label={m.purge}
          tooltip={m.purgeTooltip}
          size="xs"
          variant="outline"
          tone="danger"
          disabled={disabled || purgeable === 0}
          onPress={() => openPopup({ kind: 'purge' })}
        />
        <IconButton icon="refresh" label={m.refresh} size="xs" disabled={disabled} onPress={refresh} />
      </Row>
      <Box grow minHeight={0} scroll="y">
        <Stack gap="md">
          <OngoingCard items={ongoing} />
          <NextCard next={next} now={now} />
          {state.todos.length === 0 ? (
            <EmptyState icon="check" title={m.emptyTitle} description={m.emptyDescription} />
          ) : null}
          {state.todos.length > 0 ? (
            <Tabs label={m.filterLabel} value={read(statusFilter)} onChange={(v) => set(statusFilter, v as TodoStatus)}>
              {STATUS_ORDER.map((status) => {
                const todos = state.todos.filter((t) => t.status === status);
                return (
                  <Tab value={status} label={m.tabLabel(m.status[status], todos.length)}>
                    <Group status={status} todos={todos} now={now} />
                  </Tab>
                );
              })}
            </Tabs>
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
      <Row justify="end" align="center" gap="sm" wrap>
        <Button size="xs" variant="outline" tone="danger" icon="delete" disabled={disabled} onPress={() => set(confirmDelete, true)}>
          {m.delete}
        </Button>
        <Row align="center" gap="xs">
          {todo.status !== 'done' ? (
            <TintButton tone="success" icon="check" disabled={disabled} onPress={() => setStatus(todo.id, 'done')}>
              {m.markDone}
            </TintButton>
          ) : null}
          {todo.status === 'enabled' ? (
            <TintButton tone="warning" icon="pause" disabled={disabled} onPress={() => setStatus(todo.id, 'disabled')}>
              {m.disable}
            </TintButton>
          ) : (
            <TintButton tone="success" icon="play" disabled={disabled} onPress={() => setStatus(todo.id, 'enabled')}>
              {m.enable}
            </TintButton>
          )}
        </Row>
        <Row align="center" gap="xs">
          <Button size="xs" variant="outline" icon="bell" disabled={disabled} onPress={() => testNotify(todo.id)}>
            {m.testNotify}
          </Button>
          <Button size="xs" variant="solid" tone="accent" icon="edit" disabled={disabled} onPress={() => openEditor(todo)}>
            {m.edit}
          </Button>
        </Row>
      </Row>
      {read(confirmDelete) ? <ConfirmDelete title={todo.title} onConfirm={() => removeTodo(todo.id)} /> : null}
    </Stack>
  );
  return (
    <PopupFrame title={m.detailTitle} footer={footer}>
      <Heading level={1}>{todo.title}</Heading>
      <Row gap="xs" wrap>
        <Badge tone={STATUS_TONE[todo.status]}>{m.status[todo.status]}</Badge>
        {live ? <Badge tone="warning">{m.badgeOngoing}</Badge> : null}
        {todo.notify && todo.startAt !== null ? <Badge tone="accent">{m.badgeNotify}</Badge> : null}
      </Row>
      {live ? (
        <Callout tone="warning" icon="play" title={m.ongoingCallout(formatDuration(todo.durationMin, lang))}>
          <Text size="sm">{`${formatClock(live.start)} – ${formatClock(live.end)}`}</Text>
        </Callout>
      ) : null}
      <Section title={m.timeSection}>
        <KeyValue
          items={[
            { label: m.startLabel, value: todo.startAt === null ? m.unscheduled : formatDateTime(todo.startAt) },
            { label: m.durationLabel, value: todo.durationMin > 0 ? formatDuration(todo.durationMin, lang) : '—' },
            { label: m.repeatLabel, value: describeRepeat(todo.repeat, lang) },
            { label: m.nextLabel, value: at === null ? '—' : formatDateTime(at) },
            { label: m.notifyLabel, value: todo.startAt === null ? m.notifyUnscheduled : todo.notify ? m.on : m.off },
          ]}
        />
      </Section>
      <Section title={m.bodySection}>
        {todo.body.trim() ? <Markdown content={todo.body} /> : <Text size="sm" muted>{m.noBody}</Text>}
      </Section>
    </PopupFrame>
  );
}

// ── popup：新增／編輯 ─────────────────────────────────────

const REPEAT_UNITS: RepeatUnit[] = ['minute', 'hour', 'day', 'week', 'month'];

function repeatOptions(m: Messages): { value: RepeatUnit | 'none'; label: string }[] {
  return [{ value: 'none', label: m.repeatNone }, ...REPEAT_UNITS.map((unit) => ({ value: unit, label: m.repeatOption(unit) }))];
}

/** 帶入的時間取下一個整分鐘：存檔當下以前的場次不會通知，取整後馬上存仍趕得上。 */
function nextMinute(): string {
  return formatDateTime(Math.ceil((Date.now() + 1) / 60_000) * 60_000);
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
    <PopupFrame title={existing ? m.editTitle : m.newTitle} footer={footer}>
      <Section title={m.basicSection}>
        <Input label={m.titleLabel} value={d.title} maxLength={TITLE_MAX} placeholder={m.titlePlaceholder} onChange={(v) => patchDraft({ title: v })} />
        <Tabs label={m.bodySection} value={read(bodyTab)} onChange={(v) => set(bodyTab, v)}>
          <Tab value="write" label={m.bodyWrite} icon="edit">
            <Textarea
              label={m.bodyLabel}
              value={d.body}
              rows={10}
              maxLength={BODY_MAX}
              placeholder={m.bodyPlaceholder}
              onChange={(v) => patchDraft({ body: v })}
            />
          </Tab>
          <Tab value="preview" label={m.bodyPreview} icon="file-text">
            {d.body.trim() ? <Markdown content={d.body} /> : <Text size="sm" muted>{m.noBody}</Text>}
          </Tab>
        </Tabs>
      </Section>

      <Section title={m.timeSection}>
        <Input label={m.startLabel} value={d.start} placeholder={m.startPlaceholder} onChange={(v) => patchDraft({ start: v })} />
        <Actions>
          <Button size="xs" variant="outline" icon="calendar" onPress={() => patchDraft({ start: nextMinute() })}>
            {m.fillNow}
          </Button>
        </Actions>
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
              <Input label={m.untilLabel} value={d.until} placeholder="2026-12-31 23:59" onChange={(v) => patchDraft({ until: v })} />
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
