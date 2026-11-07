import { Capacitor, type PermissionState } from '@capacitor/core'
import type { LocalNotificationSchema } from '@capacitor/local-notifications'
import { db } from './db'
import { getLocale } from './i18n'
import { loadReminderState, sameReminderNotificationOccurrence, type ReminderNotificationSnapshot, type ReminderState } from './smartReminders'
import { subscribeReminderChanges } from './reminderEvents'
import { planReminderNotifications } from './localNotificationPlan'
import { listenForNativeReminders, localNotificationsAvailable, notificationApi, type NativeReminderEvent, type NotificationApi } from './nativeLocalNotifications'

export const REMINDER_NOTIFICATION_OWNER = 'aily.reminders.v1'
export const REMINDER_NOTIFICATION_KEY = '__reminderNotifications:v1'
export const REMINDER_NOTIFICATION_ID_START = 1_700_000_000
export const REMINDER_NOTIFICATION_ID_END = 1_799_999_999
export const REMINDER_TEST_NOTIFICATION_ID = REMINDER_NOTIFICATION_ID_END - 1
const ACTION_TYPE = 'aily-reminder-actions-v1', CHANNEL = 'aily-reminders-v1'
export interface NotificationEntry { id: number; reminderId: string; token: string; occurrence: ReminderNotificationSnapshot; fireAt: string; signature: string; requested: boolean; details: boolean }
export interface NotificationConfig { version: 1; enabled: boolean; showDetails: boolean; epoch: string; nextId: number; entries: NotificationEntry[] }
export interface ReminderNotificationStatus { available: boolean; enabled: boolean; showDetails: boolean; permission: PermissionState | 'unavailable'; scheduledCount: number; deferredCount: number; contextOnlyCount: number; busy: boolean; error: string }
export interface ReminderNotificationIntent { reminderId: string; snapshot: ReminderNotificationSnapshot; fireAt: string; action: 'open' | 'complete' | 'snooze'; openApp: boolean }
interface Dependencies {
  api: NotificationApi; available: () => boolean; native: () => boolean; platform: () => string; now: () => Date; locale: () => string; uuid: () => string
  readReminders: () => Promise<ReminderState>; readConfig: () => Promise<unknown>; writeConfig: (value: NotificationConfig) => Promise<void>
  listen: (listener: (event: NativeReminderEvent) => void) => Promise<() => Promise<void>>
  subscribeChanges: (listener: () => void) => () => void
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const idInRange = (id: unknown): id is number => typeof id === 'number' && Number.isInteger(id) && id >= REMINDER_NOTIFICATION_ID_START && id < REMINDER_NOTIFICATION_ID_END
function readValidConfig(raw: unknown, uuid: () => string): NotificationConfig {
  if (raw == null) return { version: 1, enabled: false, showDetails: false, epoch: uuid(), nextId: REMINDER_NOTIFICATION_ID_START, entries: [] }
  if (!record(raw) || raw.version !== 1 || typeof raw.enabled !== 'boolean' || typeof raw.showDetails !== 'boolean' || typeof raw.epoch !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(raw.epoch) || typeof raw.nextId !== 'number' || !Number.isInteger(raw.nextId) || raw.nextId < REMINDER_NOTIFICATION_ID_START || raw.nextId > REMINDER_NOTIFICATION_ID_END || !Array.isArray(raw.entries) || raw.entries.length > 500) throw new Error('本机通知配置读取失败，原配置未覆盖。')
  const entries: NotificationEntry[] = raw.entries.map(value => {
    if (!record(value) || !idInRange(value.id) || typeof value.reminderId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.reminderId) || !record(value.occurrence) || typeof value.occurrence.createdAt !== 'string' || !Number.isFinite(Date.parse(value.occurrence.createdAt)) || ![value.occurrence.scheduledAt, value.occurrence.snoozedUntil].every(at => at === null || (typeof at === 'string' && Number.isFinite(Date.parse(at)))) || typeof value.fireAt !== 'string' || !Number.isFinite(Date.parse(value.fireAt)) || typeof value.token !== 'string' || typeof value.signature !== 'string' || typeof value.requested !== 'boolean' || typeof value.details !== 'boolean') throw new Error('本机通知记录读取失败，原记录未覆盖。')
    const occurrence: ReminderNotificationSnapshot = { createdAt: value.occurrence.createdAt, scheduledAt: value.occurrence.scheduledAt as string | null, snoozedUntil: value.occurrence.snoozedUntil as string | null }
    if (value.token !== JSON.stringify({ reminderId: value.reminderId, occurrence })) throw new Error('本机通知记录校验失败。')
    return { id: value.id, reminderId: value.reminderId, token: value.token, occurrence, fireAt: value.fireAt, signature: value.signature, requested: value.requested, details: value.details }
  })
  if (new Set(entries.map(entry => entry.id)).size !== entries.length || new Set(entries.map(entry => entry.reminderId)).size !== entries.length || entries.some(entry => entry.id >= Number(raw.nextId))) throw new Error('本机通知编号校验失败。')
  return { version: 1, enabled: raw.enabled, showDetails: raw.showDetails, epoch: raw.epoch, nextId: raw.nextId, entries }
}
/** Serialized, persistent occurrence ledger. Queued system notifications survive React unmount/app exit. */
export function createReminderNotificationService(deps: Dependencies) {
  let status: ReminderNotificationStatus = { available: deps.available(), enabled: false, showDetails: false, permission: 'unavailable', scheduledCount: 0, deferredCount: 0, contextOnlyCount: 0, busy: false, error: '' }
  const observers = new Set<() => void>(), clients = new Set<{ onIntent: (intent: ReminderNotificationIntent) => Promise<void> | void; onResume: () => void }>()
  let queue: Promise<unknown> = Promise.resolve(), generation = 0, active = false, resetBlocked = false, setupLocale = ''
  let listenerStart: Promise<void> | null = null, stopNative: (() => Promise<void>) | null = null, stopChanges: (() => void) | null = null
  const buffered: NativeReminderEvent[] = []
  const text = (zh: string, en: string) => deps.locale() === 'en' ? en : zh
  const publish = (patch: Partial<ReminderNotificationStatus>) => { const next = { ...status, ...patch }; if (JSON.stringify(next) !== JSON.stringify(status)) { status = next; for (const listener of observers) listener() } }
  const config = async () => readValidConfig(await deps.readConfig(), deps.uuid)
  const fail = () => { publish({ busy: false, error: text('系统通知操作未完成，旧通知可能仍存在。请重试，或到系统设置关闭通知；提醒记录仍保留。', 'System notification operation incomplete; old notifications may remain. Retry or disable them in system settings. Reminder records are kept.') }) }
  function serial<T>(work: () => Promise<T>): Promise<T> { const task = queue.then(work); queue = task.catch(() => {}); return task }
  const owned = (notification: LocalNotificationSchema) => idInRange(notification.id) && (!record(notification.extra) || notification.extra.owner === undefined || notification.extra.owner === REMINDER_NOTIFICATION_OWNER)
  async function osState() { const [pending, delivered] = await Promise.all([deps.api.getAll({ state: 'SCHEDULED' }), deps.api.getAll({ state: 'TRIGGERED' })]); return { pending: pending.notifications, delivered: delivered.notifications } }
  async function cancelIds(ids: number[]) {
    const unique = [...new Set(ids)]; if (!unique.length) return
    // A stale ledger is not authority over a new producer that reused an integer id.
    const allowedNow = async (targets: number[]) => {
      const current = await osState()
      const foreign = new Set([...current.pending, ...current.delivered].filter(item => record(item.extra) && item.extra.owner !== undefined && item.extra.owner !== REMINDER_NOTIFICATION_OWNER).map(item => item.id))
      return targets.filter(id => !foreign.has(id))
    }
    const pendingTargets = await allowedNow(unique)
    if (pendingTargets.length) await deps.api.cancel({ notifications: pendingTargets.map(id => ({ id })) })
    const deliveredTargets = await allowedNow(pendingTargets)
    if (deliveredTargets.length) await deps.api.removeDeliveredNotificationsById({ ids: deliveredTargets })
  }
  async function prepare() {
    if (setupLocale === deps.locale()) return
    await deps.api.registerActionTypes({ types: [{ id: ACTION_TYPE, iosHiddenPreviewsShowTitle: false, iosHiddenPreviewsBodyPlaceholder: text('你有一条 Aily 提醒', 'You have an Aily reminder'), actions: [{ id: 'complete', title: text('完成', 'Done'), foreground: true, requiresAuthentication: true }, { id: 'snooze', title: text('10 分钟后', 'In 10 minutes'), foreground: true, requiresAuthentication: true }] }] })
    if (deps.platform() === 'android') await deps.api.createChannel({ id: CHANNEL, name: text('Aily 提醒', 'Aily reminders'), description: text('本机定时提醒，不使用远程推送', 'On-device reminders, not remote push'), importance: 4, visibility: 0, vibration: true })
    setupLocale = deps.locale()
  }
  async function syncInside() {
    if (!deps.available()) { publish({ available: false, busy: false, permission: 'unavailable', scheduledCount: 0 }); return }
    const stamp = generation, cfg = await config(), before = JSON.stringify(cfg), state = await deps.readReminders(), now = deps.now()
    const os = await osState(), pendingIds = new Set(os.pending.map(item => item.id)), occupied = new Set([...os.pending, ...os.delivered].map(item => item.id))
    const live = new Map(state.reminders.map(reminder => [reminder.id, reminder]))
    const foreignIds = new Set([...os.pending, ...os.delivered].filter(item => record(item.extra) && item.extra.owner !== undefined && item.extra.owner !== REMINDER_NOTIFICATION_OWNER).map(item => item.id))
    const keep = cfg.entries.filter(entry => { const reminder = live.get(entry.reminderId); return !foreignIds.has(entry.id) && reminder && sameReminderNotificationOccurrence(reminder, entry.occurrence) })
    const removed = cfg.entries.filter(entry => !keep.includes(entry)); cfg.entries = keep
    let permission: PermissionState | 'unavailable' = 'unavailable'
    if (cfg.enabled && active && !resetBlocked) permission = (await deps.api.checkPermissions()).display
    const canSchedule = cfg.enabled && active && !resetBlocked && permission === 'granted'
    const cancelAllOwned = !cfg.enabled || resetBlocked || (active && permission !== 'granted')
    const cancel = new Set(removed.map(entry => entry.id))
    for (const notification of [...os.pending, ...os.delivered]) {
      const test = notification.id === REMINDER_TEST_NOTIFICATION_ID && record(notification.extra) && notification.extra.test === true && notification.extra.epoch === cfg.epoch
      if (owned(notification) && (cancelAllOwned || (!cfg.entries.some(entry => entry.id === notification.id) && !test))) cancel.add(notification.id)
    }
    for (const entry of cfg.entries) {
      const reminder = live.get(entry.reminderId)!
      if (!reminder.enabled || cancelAllOwned) cancel.add(entry.id)
      if (!cfg.showDetails && entry.details) { cancel.add(entry.id); entry.details = false; entry.signature = '' }
    }
    if (cancel.size) await cancelIds([...cancel])
    publish({ available: true, enabled: cfg.enabled, showDetails: cfg.showDetails, permission, scheduledCount: 0, deferredCount: 0, contextOnlyCount: 0, error: '' })
    if (!canSchedule || generation !== stamp) { if (JSON.stringify(cfg) !== before) await deps.writeConfig(cfg); return }
    await prepare()
    const foreign = os.pending.filter(item => !owned(item)).length
    const planned = planReminderNotifications(state, { now, locale: deps.locale(), showDetails: cfg.showDetails, maxCount: Math.max(0, Math.min(60, 64 - foreign - 4)) })
    const additions: LocalNotificationSchema[] = []
    const plannedReminders = new Set(planned.notifications.map(plan => plan.reminderId))
    for (const entry of cfg.entries) if (!plannedReminders.has(entry.reminderId) && pendingIds.has(entry.id)) cancel.add(entry.id)
    for (const plan of planned.notifications) {
      const reminder = live.get(plan.reminderId)!
      let entry = cfg.entries.find(item => item.reminderId === plan.reminderId)
      // Pending->due clears snooze, so retain the last validated ledger token rather than re-alert.
      if (entry?.requested && (reminder.status === 'due' || Date.parse(entry.fireAt) <= now.getTime())) continue
      const signature = JSON.stringify([plan.token, plan.at.toISOString(), plan.title, plan.body, state.quietHours])
      if (entry && entry.signature !== signature) { cancel.add(entry.id); cfg.entries = cfg.entries.filter(item => item !== entry); entry = undefined }
      if (!entry) {
        while (occupied.has(cfg.nextId)) cfg.nextId++
        if (cfg.nextId >= REMINDER_TEST_NOTIFICATION_ID) throw new Error('本机通知编号已耗尽。')
        entry = { id: cfg.nextId++, reminderId: plan.reminderId, token: plan.token, occurrence: plan.occurrence, fireAt: plan.at.toISOString(), signature, requested: false, details: cfg.showDetails }
        cfg.entries.push(entry); occupied.add(entry.id)
      }
      if (pendingIds.has(entry.id) && !cancel.has(entry.id)) continue
      entry.requested = true
      additions.push({ id: entry.id, title: plan.title, body: plan.body, schedule: { at: new Date(entry.fireAt), allowWhileIdle: true }, channelId: CHANNEL, actionTypeId: ACTION_TYPE, foreground: true, isExactNotification: false, isExactMandatory: false, extra: { owner: REMINDER_NOTIFICATION_OWNER, epoch: cfg.epoch, reminderId: entry.reminderId, token: entry.token, fireAt: entry.fireAt } })
    }
    if (cancel.size) await cancelIds([...cancel])
    // Persist identities before SDK scheduling: a fast callback or process exit can still be validated/cancelled.
    if (JSON.stringify(cfg) !== before) await deps.writeConfig(cfg)
    const unclaimUnscheduled = async () => {
      if (!additions.length) return
      for (const entry of cfg.entries) if (additions.some(item => item.id === entry.id)) entry.requested = false
      await deps.writeConfig(cfg)
    }
    if (generation !== stamp || !active || resetBlocked) { await unclaimUnscheduled(); return }
    if (additions.length) {
      // SDK 8.3 can auto-request permission; never call it with a known ungranted permission.
      if ((await deps.api.checkPermissions()).display !== 'granted') { await unclaimUnscheduled(); publish({ permission: 'denied', scheduledCount: 0 }); return }
      if (generation !== stamp || !active || resetBlocked) { await unclaimUnscheduled(); return }
      try {
        const result = await deps.api.schedule({ notifications: additions })
        if (additions.some(item => !result.notifications.some(scheduled => scheduled.id === item.id))) throw new Error('Incomplete scheduling acknowledgement')
      } catch {
        await cancelIds(additions.map(item => item.id))
        for (const entry of cfg.entries) if (additions.some(item => item.id === entry.id)) entry.requested = false
        await deps.writeConfig(cfg)
        throw new Error('系统通知安排失败，请重试。')
      }
      if (generation !== stamp || !active || resetBlocked) { await cancelIds(additions.map(item => item.id)); return }
    }
    const actual = await deps.api.getAll({ state: 'SCHEDULED' })
    publish({ scheduledCount: actual.notifications.filter(item => owned(item) && cfg.entries.some(entry => entry.id === item.id)).length, deferredCount: planned.deferredCount, contextOnlyCount: planned.contextOnlyCount, busy: false, error: '' })
  }
  async function sync() { return serial(async () => { try { await syncInside() } catch (failure) { fail(); throw failure } }) }
  async function resolveEvent(event: Exclude<NativeReminderEvent, { kind: 'resume' }>) {
    if (!active || resetBlocked || !deps.available()) return
    const cfg = await config(), notification = event.notification
    if (!cfg.enabled || !owned(notification) || !record(notification.extra)) return
    const entry = cfg.entries.find(item => item.id === notification.id), extra = notification.extra
    if (!entry || !entry.requested || extra.owner !== REMINDER_NOTIFICATION_OWNER || extra.epoch !== cfg.epoch || extra.reminderId !== entry.reminderId || extra.token !== entry.token || extra.fireAt !== entry.fireAt || deps.now().getTime() < Date.parse(entry.fireAt)) return
    const action = event.kind === 'received' || event.actionId === 'tap' ? 'open' : event.actionId
    if (action !== 'open' && action !== 'complete' && action !== 'snooze') return
    return { reminderId: entry.reminderId, snapshot: entry.occurrence, fireAt: entry.fireAt, action, openApp: event.kind === 'action' } satisfies ReminderNotificationIntent
  }
  function acceptEvent(event: NativeReminderEvent) {
    if (event.kind === 'resume') { for (const client of clients) client.onResume(); if (active && !resetBlocked) void sync().catch(() => {}); return }
    if (!owned(event.notification) || !record(event.notification.extra) || event.notification.extra.owner !== REMINDER_NOTIFICATION_OWNER || resetBlocked) return
    if (!active) { if (buffered.length >= 20) buffered.shift(); buffered.push(event); return }
    void serial(() => resolveEvent(event)).then(intent => { if (intent && active && !resetBlocked) for (const client of clients) void Promise.resolve(client.onIntent(intent)).catch(() => fail()) }).catch(() => fail())
  }
  function attach(client: { onIntent: (intent: ReminderNotificationIntent) => Promise<void> | void; onResume: () => void }) {
    clients.add(client)
    if (!stopChanges) stopChanges = deps.subscribeChanges(() => { generation++; if (active && !resetBlocked && deps.available()) void sync().catch(() => {}) })
    if (deps.available() && !listenerStart) listenerStart = deps.listen(acceptEvent).then(stop => { stopNative = stop; if (!clients.size) { void stop(); stopNative = null; listenerStart = null } }).catch(() => { listenerStart = null; fail() })
    return () => {
      clients.delete(client)
      if (!clients.size) { active = false; generation++; stopChanges?.(); stopChanges = null; if (stopNative) { void stopNative(); stopNative = null; listenerStart = null } }
    }
  }
  function setActive(value: boolean) { active = value; if (value && !resetBlocked) { for (const event of buffered.splice(0)) acceptEvent(event) } }
  async function setEnabled(value: boolean) {
    generation++; publish({ busy: true, error: '' })
    return serial(async () => {
      try {
        if (!deps.available()) throw new Error('请在 iOS/Android 客户端开启系统通知。')
        const cfg = await config()
        if (value) {
          const current = await deps.api.checkPermissions()
          const permission = current.display === 'granted' ? current : await deps.api.requestPermissions()
          publish({ permission: permission.display })
          if (permission.display !== 'granted') { publish({ busy: false, error: text('系统通知未授权，请在系统设置中允许 Aily 通知。', 'Notifications not authorized. Allow Aily notifications in system settings.') }); return false }
          if (!active) { publish({ busy: false }); return false }
          resetBlocked = false
        }
        cfg.enabled = value; await deps.writeConfig(cfg)
        if (!value) {
          // Explicit opt-out must work even when the reminder database cannot be read.
          publish({ enabled: false, scheduledCount: 0, deferredCount: 0 })
          const os = await osState()
          await cancelIds([...os.pending, ...os.delivered].filter(owned).map(item => item.id).concat(cfg.entries.map(entry => entry.id)))
          const after = await osState()
          if ([...after.pending, ...after.delivered].some(owned)) throw new Error('旧系统通知尚未完全取消。')
        } else await syncInside()
        publish({ busy: false }); return true
      } catch (failure) { fail(); throw failure }
    })
  }
  async function setShowDetails(value: boolean) {
    generation++; publish({ busy: true, error: '' })
    return serial(async () => {
      try {
        if (!deps.available()) throw new Error('仅原生客户端支持系统通知。')
        const cfg = await config(); cfg.showDetails = value; await deps.writeConfig(cfg); publish({ showDetails: value })
        if (!value) {
          const os = await osState()
          // Hide already-visible details even if the reminder model later fails to load.
          await cancelIds(cfg.entries.filter(entry => entry.details).map(entry => entry.id).concat(os.delivered.filter(owned).map(item => item.id)))
        }
        await syncInside(); publish({ busy: false })
      } catch (failure) { fail(); throw failure }
    })
  }
  async function sendTest() {
    publish({ busy: true, error: '' })
    return serial(async () => {
      try {
        const stamp = generation, cfg = await config()
        if (!active || resetBlocked || !deps.available() || !cfg.enabled || (await deps.api.checkPermissions()).display !== 'granted') throw new Error('请先开启并授权系统通知。')
        await prepare()
        if (stamp !== generation || resetBlocked || !active) return false
        const result = await deps.api.schedule({ notifications: [{ id: REMINDER_TEST_NOTIFICATION_ID, title: text('Aily 通知测试', 'Aily notification test'), body: text('本地通知已可用，不需要后端。', 'Local notifications are ready. No server needed.'), schedule: { at: new Date(deps.now().getTime() + 3000), allowWhileIdle: true }, foreground: true, isExactNotification: false, channelId: CHANNEL, extra: { owner: REMINDER_NOTIFICATION_OWNER, epoch: cfg.epoch, test: true } }] })
        if (!result.notifications.some(item => item.id === REMINDER_TEST_NOTIFICATION_ID)) throw new Error('测试通知未确认安排。')
        if (stamp !== generation || resetBlocked || !active) { await cancelIds([REMINDER_TEST_NOTIFICATION_ID]); return false }
        return true
      } catch (failure) { fail(); throw failure } finally { publish({ busy: false }) }
    })
  }
  async function reset() {
    resetBlocked = true; generation++; buffered.splice(0)
    return serial(async () => {
      if (!deps.native()) return
      if (!deps.available()) { if (await deps.readConfig()) throw new Error('无法取消系统通知，请更新客户端后重试。'); return }
      const os = await osState(), ids = [...os.pending, ...os.delivered].filter(owned).map(item => item.id)
      let cfg: NotificationConfig
      try { cfg = await config() } catch { cfg = readValidConfig(null, deps.uuid) } // Explicit reset may erase corrupt bookkeeping only after OS cancellation is verified.
      ids.push(...cfg.entries.map(entry => entry.id))
      await cancelIds(ids)
      const remaining = await osState()
      if ([...remaining.pending, ...remaining.delivered].some(owned)) throw new Error('系统通知未完全取消，尚未清除提醒数据。')
      await deps.writeConfig({ ...cfg, enabled: false, entries: [] })
      publish({ enabled: false, scheduledCount: 0, deferredCount: 0, busy: false, error: '' })
    })
  }
  return { getSnapshot: () => status, subscribe: (listener: () => void) => { observers.add(listener); return () => { observers.delete(listener) } }, attach, setActive, sync, setEnabled, setShowDetails, sendTest, reset }
}
export const reminderNotifications = createReminderNotificationService({
  api: notificationApi, available: localNotificationsAvailable, native: () => Capacitor.isNativePlatform(), platform: () => Capacitor.getPlatform(), now: () => new Date(), locale: getLocale, uuid: () => crypto.randomUUID(), readReminders: loadReminderState,
  readConfig: async () => (await db.settings.get(REMINDER_NOTIFICATION_KEY))?.value,
  writeConfig: async value => { await db.settings.put({ key: REMINDER_NOTIFICATION_KEY, value }) }, listen: listenForNativeReminders, subscribeChanges: subscribeReminderChanges,
})
/** Called before any private reminder settings are erased; failure must abort data deletion. */
export async function cancelReminderNotificationsForReset() { await reminderNotifications.reset() }
