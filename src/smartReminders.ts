import Dexie, { type Transaction } from 'dexie'
import { db } from './db'
import { getLocale } from './i18n'
import { notifyReminderChanges } from './reminderEvents'

export type ReminderKind = 'water' | 'meal' | 'weather' | 'mood' | 'metro' | 'plan'
export interface Reminder {
  id: string
  title: string
  kind: ReminderKind
  enabled: boolean
  scheduledAt: string | null
  repeatMinutes: number | null
  temperatureBelow: number | null
  station: string
  exit: string
  leadMinutes: number
  status: 'pending' | 'due' | 'completed'
  deliveredAt: string | null
  snoozedUntil: string | null
  createdAt: string
}
/** Identity of a scheduled occurrence, not a new persisted reminder field. */
export type ReminderNotificationSnapshot = {
  createdAt: string
  scheduledAt: string | null
  snoozedUntil: string | null
}
export interface ReminderContext {
  temperature: number | null
  weatherObservedAt: string | null
  mood: 'unknown' | 'okay' | 'low'
  moodObservedAt: string | null
}
export interface ReminderState {
  reminders: Reminder[]
  context: ReminderContext
  /** Local wall-clock minutes [0, 1439]. Equal start/end means all day. */
  quietHours: { enabled: boolean; start: number; end: number }
}

// Internal, unencrypted device-only state: excluded from backups and removed by
// clearAllData/importData, like other __ settings. No seeds, network or timers.
const key = '__smartReminders:v1'
const minute = 60_000
const kinds: ReminderKind[] = ['water', 'meal', 'weather', 'mood', 'metro', 'plan']
const inputFields = ['title', 'kind', 'enabled', 'scheduledAt', 'repeatMinutes', 'temperatureBelow', 'station', 'exit', 'leadMinutes']
const fields = [...inputFields, 'id', 'status', 'deliveredAt', 'snoozedUntil', 'createdAt']
function check(value: unknown): asserts value {
  if (!value) throw new Error('无效的提醒数据或设置')
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function exact(value: unknown, names: string[]): asserts value is Record<string, unknown> {
  check(record(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)))
}
function number(value: unknown, min: number, max: number, integer = false): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value))
}
function text(value: unknown, max: number, required = false): value is string {
  return typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value) && (!required || value.trim().length > 0)
}
function idCheck(id: unknown): asserts id is string {
  check(typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id))
}
/** Require explicit timezone and reject Date.parse's normalization of Feb 30. */
function timestamp(value: unknown): string {
  check(typeof value === 'string' && value.length <= 35)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  check(match)
  const [, year, month, day, hour, min, sec, , zone, , zoneHour, zoneMin] = match
  const y = Number(year), m = Number(month), d = Number(day)
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  check(y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1] && Number(hour) < 24 && Number(min) < 60 && Number(sec) < 60)
  check(zone === 'Z' || (Number(zoneHour) <= 14 && Number(zoneMin) < 60 && (Number(zoneHour) !== 14 || Number(zoneMin) === 0)))
  check(Number.isFinite(Date.parse(value)))
  return new Date(value).toISOString()
}
function optionalTimestamp(value: unknown): string | null { return value === null ? null : timestamp(value) }
function clock(now: Date): Date {
  check(now instanceof Date && Number.isFinite(now.getTime()))
  // Keep persisted timestamps inside the supported four-digit year range.
  timestamp(now.toISOString())
  return new Date(now.getTime())
}
function validateInput(value: unknown): Omit<Reminder, 'id' | 'status' | 'deliveredAt' | 'snoozedUntil' | 'createdAt'> {
  exact(value, inputFields)
  check(text(value.title, 200, true) && kinds.includes(value.kind as ReminderKind) && typeof value.enabled === 'boolean')
  const scheduledAt = optionalTimestamp(value.scheduledAt)
  check(value.repeatMinutes === null || number(value.repeatMinutes, 1, 525600, true))
  check(value.temperatureBelow === null || number(value.temperatureBelow, -100, 100))
  check(text(value.station, 100) && text(value.exit, 100) && number(value.leadMinutes, 0, 1440, true))
  if (value.kind === 'weather') check(value.temperatureBelow !== null)
  if (value.kind === 'metro') check(scheduledAt !== null && value.station.trim() && value.exit.trim())
  if (['water', 'meal', 'plan'].includes(value.kind as string)) check(scheduledAt !== null)
  return { ...(value as unknown as ReturnType<typeof validateInput>), title: value.title.trim(), station: value.station.trim(), exit: value.exit.trim(), scheduledAt }
}
function validateReminder(value: unknown): Reminder {
  exact(value, fields)
  const input = validateInput(Object.fromEntries(inputFields.map(name => [name, value[name]])))
  idCheck(value.id)
  check(['pending', 'due', 'completed'].includes(value.status as string))
  const deliveredAt = optionalTimestamp(value.deliveredAt), snoozedUntil = optionalTimestamp(value.snoozedUntil), createdAt = timestamp(value.createdAt)
  check(value.status !== 'due' || (deliveredAt !== null && snoozedUntil === null))
  check(value.status !== 'completed' || snoozedUntil === null)
  check(snoozedUntil === null || value.status === 'pending')
  check(deliveredAt === null || Date.parse(deliveredAt) >= Date.parse(createdAt))
  return { ...input, id: value.id, status: value.status as Reminder['status'], deliveredAt, snoozedUntil, createdAt }
}
function validateContext(value: unknown): ReminderContext {
  exact(value, ['temperature', 'weatherObservedAt', 'mood', 'moodObservedAt'])
  check(value.temperature === null || number(value.temperature, -100, 100))
  check(['unknown', 'okay', 'low'].includes(value.mood as string))
  const weatherObservedAt = optionalTimestamp(value.weatherObservedAt), moodObservedAt = optionalTimestamp(value.moodObservedAt)
  check((value.temperature === null) === (weatherObservedAt === null))
  check((value.mood === 'unknown') === (moodObservedAt === null))
  return { temperature: value.temperature as number | null, weatherObservedAt, mood: value.mood as ReminderContext['mood'], moodObservedAt }
}
function validateQuiet(value: unknown): ReminderState['quietHours'] {
  exact(value, ['enabled', 'start', 'end'])
  check(typeof value.enabled === 'boolean' && number(value.start, 0, 1439, true) && number(value.end, 0, 1439, true))
  return { enabled: value.enabled, start: value.start, end: value.end }
}
function empty(): ReminderState {
  return { reminders: [], context: { temperature: null, weatherObservedAt: null, mood: 'unknown', moodObservedAt: null }, quietHours: { enabled: true, start: 1320, end: 480 } }
}
async function readState(): Promise<ReminderState> {
  const setting = await db.settings.get(key)
  if (!setting) return empty()
  const value = setting.value
  exact(value, ['reminders', 'context', 'quietHours'])
  check(Array.isArray(value.reminders) && value.reminders.length <= 500)
  const reminders = value.reminders.map(validateReminder)
  check(new Set(reminders.map(reminder => reminder.id)).size === reminders.length)
  return { reminders, context: validateContext(value.context), quietHours: validateQuiet(value.quietHours) }
}
const changeTransactions = new WeakSet<Transaction>()
async function persist(state: ReminderState): Promise<void> {
  await db.settings.put({ key, value: state })
  // Nested transactions resolve before their enclosing transaction commits.
  // Subscribe to the root's completion instead, coalescing changes per commit.
  let transaction = Dexie.currentTransaction
  check(transaction)
  while (transaction.parent) transaction = transaction.parent
  if (!changeTransactions.has(transaction)) {
    changeTransactions.add(transaction)
    transaction.on('complete', notifyReminderChanges)
  }
}
export async function loadReminderState(): Promise<ReminderState> { return readState() }

export async function addReminder(input: Omit<Reminder, 'id' | 'status' | 'deliveredAt' | 'snoozedUntil' | 'createdAt'>, now = new Date()): Promise<Reminder> {
  const at = clock(now), validated = validateInput(input)
  // A journey must be in the future; its lead-time alert may already be due.
  check(validated.scheduledAt === null || Date.parse(validated.scheduledAt) > at.getTime())
  return db.transaction('rw', db.settings, async () => {
    const state = await readState()
    if (state.reminders.length >= 500) throw new Error('最多保存 500 条提醒，请先删除旧提醒')
    const id = globalThis.crypto.randomUUID()
    check(!state.reminders.some(reminder => reminder.id === id))
    const reminder: Reminder = { ...validated, id, status: 'pending', deliveredAt: null, snoozedUntil: null, createdAt: at.toISOString() }
    state.reminders.push(reminder)
    await persist(state)
    return reminder
  })
}

/** Completion re-arms due repeats at the first future delivery slot, never backlog;
 * completing a pending repeat is a no-op to deduplicate stale UI/tab actions.
 * Snooze is an explicit 10-minute promise, overriding contextual freshness/condition
 * and the original schedule. Quiet hours still apply; metro always bypasses them.
 * Toggle preserves delivery state so disable/re-enable cannot redeliver a due item.
 * Missing IDs are a no-op (safe for stale views); malformed IDs/actions reject.
 */
export async function updateReminder(id: string, action: 'complete' | 'snooze' | 'toggle' | 'delete', now = new Date()): Promise<void> {
  idCheck(id); check(['complete', 'snooze', 'toggle', 'delete'].includes(action))
  const at = clock(now)
  await db.transaction('rw', db.settings, async () => {
    const state = await readState(), reminder = state.reminders.find(item => item.id === id)
    if (!reminder) return
    if (action === 'delete') state.reminders = state.reminders.filter(item => item.id !== id)
    else if (action === 'toggle') reminder.enabled = !reminder.enabled
    else if (!applyReminderAction(reminder, action, at)) return
    await persist(state)
  })
}
/** Shared in-transaction mutations: preserve the existing UI action semantics. */
function applyReminderAction(reminder: Reminder, action: 'complete' | 'snooze', at: Date): boolean {
  if (reminder.status === 'completed') return false
  const before = JSON.stringify(reminder)
  if (action === 'snooze') {
    reminder.status = 'pending'; reminder.deliveredAt = null
    reminder.snoozedUntil = timestamp(new Date(at.getTime() + 10 * minute).toISOString())
  } else {
    // A second tab completing the same occurrence must not advance it twice.
    if (reminder.repeatMinutes !== null && reminder.status !== 'due') return false
    reminder.snoozedUntil = null
    if (reminder.repeatMinutes !== null) {
      const interval = reminder.repeatMinutes * minute
      const lead = reminder.kind === 'metro' ? reminder.leadMinutes * minute : 0
      const base = reminder.scheduledAt === null ? at.getTime() : Date.parse(reminder.scheduledAt) - lead
      const next = base + Math.max(1, Math.floor((at.getTime() - base) / interval) + 1) * interval
      reminder.scheduledAt = timestamp(new Date(next + lead).toISOString())
      reminder.status = 'pending'; reminder.deliveredAt = null
    } else reminder.status = 'completed'
  }
  return before !== JSON.stringify(reminder)
}
function validateNotificationSnapshot(value: unknown): ReminderNotificationSnapshot {
  exact(value, ['createdAt', 'scheduledAt', 'snoozedUntil'])
  const createdAt = timestamp(value.createdAt)
  const scheduledAt = optionalTimestamp(value.scheduledAt), snoozedUntil = optionalTimestamp(value.snoozedUntil)
  check(snoozedUntil === null || Date.parse(snoozedUntil) >= Date.parse(createdAt))
  return { createdAt, scheduledAt, snoozedUntil }
}
function matchesNotificationOccurrence(reminder: Reminder, snapshot: ReminderNotificationSnapshot): boolean {
  if (reminder.status === 'completed' || reminder.createdAt !== snapshot.createdAt || reminder.scheduledAt !== snapshot.scheduledAt) return false
  if (reminder.status === 'pending') return reminder.snoozedUntil === snapshot.snoozedUntil
  return snapshot.snoozedUntil === null || (reminder.snoozedUntil === null && reminder.deliveredAt !== null && Date.parse(reminder.deliveredAt) >= Date.parse(snapshot.snoozedUntil))
}
/** Pure occurrence matching for service deduplication, including disabled due
 * reminders so toggling cannot re-deliver an already delivered occurrence.
 * Invalid external snapshots are non-matches, not exceptions. */
export function sameReminderNotificationOccurrence(reminder: Reminder, snapshot: ReminderNotificationSnapshot): boolean {
  try { return matchesNotificationOccurrence(validateReminder(reminder), validateNotificationSnapshot(snapshot)) }
  catch { return false }
}

/** Consume an already-delivered native signal atomically. Context and quiet hours
 * are intentionally not re-evaluated: the planner handled them at scheduling.
 * Rejects changed repeat slots and pending snoozes. The service additionally
 * invalidates old native IDs when snoozing, since delivered snoozes clear their
 * timestamp and intentionally do not add an occurrence ledger to this schema. */
export async function actOnReminderNotification(id: string, snapshot: ReminderNotificationSnapshot, fireAt: string, action: 'open' | 'complete' | 'snooze', now = new Date()): Promise<boolean> {
  return db.transaction('rw', db.settings, async () => {
    idCheck(id); check(['open', 'complete', 'snooze'].includes(action))
    const occurrence = validateNotificationSnapshot(snapshot), fire = timestamp(fireAt), at = clock(now)
    const state = await readState(), reminder = state.reminders.find(item => item.id === id)
    if (!reminder || !reminder.enabled || !matchesNotificationOccurrence(reminder, occurrence)) return false
    const earliest = occurrence.snoozedUntil !== null ? Date.parse(occurrence.snoozedUntil)
      : occurrence.scheduledAt !== null ? Date.parse(occurrence.scheduledAt) - (reminder.kind === 'metro' ? reminder.leadMinutes * minute : 0)
      : Date.parse(occurrence.createdAt)
    if (at.getTime() < Date.parse(fire) || Date.parse(fire) < Math.max(earliest, Date.parse(occurrence.createdAt))) return false
    let changed = false
    if (reminder.status === 'pending') {
      reminder.status = 'due'; reminder.deliveredAt = at.toISOString(); reminder.snoozedUntil = null
      changed = true
    }
    if (action !== 'open') changed = applyReminderAction(reminder, action, at) || changed
    if (changed) await persist(state)
    return true
  })
}

export async function saveReminderContext(context: ReminderContext): Promise<void> {
  const validated = validateContext(context), now = Date.now()
  check([validated.weatherObservedAt, validated.moodObservedAt].every(at => at === null || Date.parse(at) <= now))
  await db.transaction('rw', db.settings, async () => {
    const state = await readState()
    if (JSON.stringify(state.context) === JSON.stringify(validated)) return
    state.context = validated; await persist(state)
  })
}
export async function saveReminderQuietHours(quiet: ReminderState['quietHours']): Promise<void> {
  const validated = validateQuiet(quiet)
  await db.transaction('rw', db.settings, async () => {
    const state = await readState()
    if (JSON.stringify(state.quietHours) === JSON.stringify(validated)) return
    state.quietHours = validated; await persist(state)
  })
}
function quietNow(quiet: ReminderState['quietHours'], now: Date): boolean {
  if (!quiet.enabled) return false
  const value = now.getHours() * 60 + now.getMinutes()
  return quiet.start === quiet.end || (quiet.start < quiet.end ? value >= quiet.start && value < quiet.end : value >= quiet.start || value < quiet.end)
}
function fresh(observedAt: string | null, now: number, hours: number): boolean {
  if (observedAt === null) return false
  const age = now - Date.parse(observedAt)
  return age >= 0 && age <= hours * 60 * minute
}
function due(reminder: Reminder, context: ReminderContext, now: number): boolean {
  if (now < Date.parse(reminder.createdAt)) return false
  if (reminder.snoozedUntil !== null) return now >= Date.parse(reminder.snoozedUntil)
  if (reminder.scheduledAt !== null && now < Date.parse(reminder.scheduledAt) - (reminder.kind === 'metro' ? reminder.leadMinutes * minute : 0)) return false
  if (reminder.kind === 'weather') return context.temperature !== null && context.temperature < reminder.temperatureBelow! && fresh(context.weatherObservedAt, now, 6)
  if (reminder.kind === 'mood') return context.mood === 'low' && fresh(context.moodObservedAt, now, 2)
  return true
}
/** Atomically claim newly due items across tabs. Returned items are persisted due
 * before resolving; repeated evaluation/reloads do not duplicate delivery. This
 * is local foreground evaluation, not guaranteed OS/background notification.
 */
export async function evaluateReminders(now = new Date()): Promise<Reminder[]> {
  const at = clock(now)
  return db.transaction('rw', db.settings, async () => {
    const state = await readState(), newlyDue: Reminder[] = []
    for (const reminder of state.reminders) {
      if (!reminder.enabled || reminder.status !== 'pending' || (reminder.kind !== 'metro' && quietNow(state.quietHours, at))) continue
      if (!due(reminder, state.context, at.getTime())) continue
      reminder.status = 'due'; reminder.deliveredAt = at.toISOString(); reminder.snoozedUntil = null
      newlyDue.push(reminder)
    }
    if (newlyDue.length) await persist(state)
    return newlyDue
  })
}

/** Fixed, explicit suggestions, never predictions or automatic reminders.
 * No route/station/exit is inferred from free text. Locale only changes wording.
 */
export function proposeNextSteps(activity: string): { title: string; delayMinutes: number; reason: string }[] {
  check(text(activity, 500, true))
  const en = getLocale() === 'en'
  const suggest = (zh: string, english: string, delayMinutes: number, reasonZh: string, reasonEn: string) => ({ title: en ? english : zh, delayMinutes, reason: en ? reasonEn : reasonZh })
  if (/会议|开完会|开会|meeting/iu.test(activity)) return [
    suggest('建议：整理会议要点', 'Suggestion: summarize meeting notes', 10, '可选的会后整理，不推断会议内容。', 'Optional follow-up; no meeting content is inferred.'),
    suggest('建议：确认待办事项', 'Suggestion: confirm action items', 20, '可自行核对负责人和时间，不会自动安排任务。', 'You can verify owners and dates; no tasks are scheduled automatically.'),
  ]
  if (/出门|出行|地铁|旅行|going out|travel|metro|commute/iu.test(activity)) return [
    suggest('建议：核对目的地和路线', 'Suggestion: verify your destination and route', 5, '请自行确认真实路线、车站和出口；这里不会猜测路线。', 'Confirm the actual route, station and exit yourself; no route is guessed here.'),
    suggest('建议：检查随身物品', 'Suggestion: check your belongings', 10, '通用出门清单建议，不推测行程或到达时间。', 'A general departure checklist, not an inferred itinerary or arrival time.'),
  ]
  if (/吃(?:完)?饭|用餐|午餐|晚餐|早餐|meal|lunch|dinner|breakfast/iu.test(activity)) return [
    suggest('建议：用餐后散步', 'Suggestion: take a walk after your meal', 20, '可选的餐后活动，不是对你下一步的预测。', 'An optional post-meal activity, not a prediction of what you will do.'),
    suggest('建议：留一点休息时间', 'Suggestion: leave some time to rest', 30, '按自己的节奏选择，不会自动安排。', 'Choose at your own pace; nothing is scheduled automatically.'),
  ]
  if (/运动|跑步|健身|exercise|workout|running/iu.test(activity)) return [suggest('建议：休息并补水', 'Suggestion: rest and drink water', 10, '运动后可选择休息，是否安排由你决定。', 'You can choose to rest after exercise; scheduling is up to you.')]
  if (/工作|学习|阅读|work|study|read/iu.test(activity)) return [
    suggest('建议：短暂休息', 'Suggestion: take a short break', 45, '固定的休息建议，不推断你的任务或状态。', 'A fixed break suggestion, without inferring your tasks or state.'),
    suggest('建议：整理下一项任务', 'Suggestion: organize your next task', 50, '可选的整理步骤，任务内容和顺序由你决定。', 'An optional organizing step; task content and order are up to you.'),
  ]
  return [suggest('建议：留一点休息时间', 'Suggestion: leave some time to rest', 30, '通用可选建议；不会自动创建提醒或推测行程。', 'An optional general suggestion; no reminders or travel plans are created automatically.')]
}
