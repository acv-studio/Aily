import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PermissionState } from '@capacitor/core'
import type { LocalNotificationSchema } from '@capacitor/local-notifications'
import type { NativeReminderEvent, NotificationApi } from './nativeLocalNotifications'
import type { Reminder, ReminderState } from './smartReminders'
import {
  createReminderNotificationService, REMINDER_NOTIFICATION_ID_START,
  REMINDER_NOTIFICATION_OWNER, type NotificationConfig, type ReminderNotificationIntent,
} from './reminderNotifications'

// The default singleton is never exercised. Guard all native entry points even
// if a future service refactor accidentally reaches past its injected adapter.
vi.mock('./nativeLocalNotifications', () => ({
  notificationApi: new Proxy({}, { get: () => { throw new Error('Real notification SDK forbidden in service tests') } }),
  localNotificationsAvailable: () => false,
  listenForNativeReminders: () => { throw new Error('Real native listeners forbidden in service tests') },
}))

const minute = 60_000
const initialNow = new Date('2025-02-01T12:00:00.000Z')
const at = (minutes: number) => new Date(initialNow.getTime() + minutes * minute).toISOString()
const copy = <T,>(value: T): T => structuredClone(value)
function reminder(patch: Partial<Reminder> = {}): Reminder {
  return { id: 'r', title: 'Private medical appointment', kind: 'water', enabled: true,
    scheduledAt: at(10), repeatMinutes: null, temperatureBelow: null, station: '', exit: '',
    leadMinutes: 0, status: 'pending', deliveredAt: null, snoozedUntil: null,
    createdAt: at(-60), ...patch }
}
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

/** SDK-shaped, entirely in-memory adapter: no global SDK, real permission,
 * database, clock, listener, or notification delivery is used. */
function harness(options: { reminders?: Reminder[]; available?: boolean; native?: boolean; platform?: string; config?: NotificationConfig } = {}) {
  let now = new Date(initialNow), config: NotificationConfig | undefined = copy(options.config)
  let permission: PermissionState = 'prompt', permissionResult: PermissionState = 'granted'
  let cancelFailure = false, removeFailure = false, ignoreCancellation = false
  let scheduleGate: ReturnType<typeof deferred<void>> | undefined
  let incompleteAcknowledgement = false
  const pending = new Map<number, LocalNotificationSchema>(), delivered = new Map<number, LocalNotificationSchema>()
  const state: ReminderState = { reminders: copy(options.reminders ?? [reminder()]),
    context: { temperature: 5, weatherObservedAt: at(0), mood: 'low', moodObservedAt: at(0) },
    quietHours: { enabled: false, start: 1320, end: 480 } }
  const scheduleEntered = deferred<void>()
  const api = {
    checkPermissions: vi.fn<NotificationApi['checkPermissions']>(async () => ({ display: permission })),
    requestPermissions: vi.fn<NotificationApi['requestPermissions']>(async () => { permission = permissionResult; return { display: permission } }),
    schedule: vi.fn<NotificationApi['schedule']>(async ({ notifications }) => {
      // Failing this guard catches SDK 8.3's implicit permission-request hazard.
      if (permission !== 'granted') throw new Error('Scheduling without granted notification permission')
      scheduleEntered.resolve()
      if (scheduleGate) await scheduleGate.promise
      for (const notification of notifications) pending.set(notification.id, copy(notification))
      return { notifications: incompleteAcknowledgement ? [] : notifications.map(({ id }) => ({ id })) }
    }),
    getAll: vi.fn<NotificationApi['getAll']>(async options => ({ notifications: copy(options?.state === 'SCHEDULED'
      ? [...pending.values()] : options?.state === 'TRIGGERED' ? [...delivered.values()] : [...pending.values(), ...delivered.values()]) })),
    cancel: vi.fn<NotificationApi['cancel']>(async ({ notifications }) => {
      if (cancelFailure) throw new Error('Cancellation failed')
      if (!ignoreCancellation) for (const { id } of notifications) pending.delete(id)
    }),
    removeDeliveredNotificationsById: vi.fn<NotificationApi['removeDeliveredNotificationsById']>(async ({ ids }) => {
      if (removeFailure) throw new Error('Delivered removal failed')
      if (!ignoreCancellation) for (const id of ids) delivered.delete(id)
    }),
    registerActionTypes: vi.fn<NotificationApi['registerActionTypes']>(async () => {}),
    createChannel: vi.fn<NotificationApi['createChannel']>(async () => {}),
  } satisfies NotificationApi
  let listener: ((event: NativeReminderEvent) => void) | undefined
  let changeListener: (() => void) | undefined
  const stopNative = vi.fn(async () => { listener = undefined })
  const stopChanges = vi.fn(() => { changeListener = undefined })
  const listen = vi.fn(async (callback: (event: NativeReminderEvent) => void) => { listener = callback; return stopNative })
  const subscribeChanges = vi.fn((callback: () => void) => { changeListener = callback; return stopChanges })
  const writeConfig = vi.fn(async (value: NotificationConfig) => { config = copy(value) })
  let sequence = 0
  const service = createReminderNotificationService({ api, available: () => options.available ?? true,
    native: () => options.native ?? true, platform: () => options.platform ?? 'ios',
    now: () => new Date(now), locale: () => 'en', uuid: () => `epoch-${++sequence}`,
    readReminders: async () => copy(state), readConfig: async () => copy(config), writeConfig, listen, subscribeChanges })
  const intents: ReminderNotificationIntent[] = []
  const onIntent = vi.fn((intent: ReminderNotificationIntent) => { intents.push(copy(intent)) })
  const onResume = vi.fn()
  const detach = service.attach({ onIntent, onResume })
  service.setActive(true)
  cleanups.push(detach)
  return { service, api, state, pending, delivered, intents, onIntent, onResume, detach,
    stopNative, stopChanges, listen, writeConfig, scheduleEntered,
    config: () => copy(config), setNow: (value: string) => { now = new Date(value) },
    setPermission: (value: PermissionState) => { permission = value },
    grantOnRequest: (value: PermissionState) => { permissionResult = value },
    failCancellation: () => { cancelFailure = true }, failDeliveredRemoval: () => { removeFailure = true },
    ignoreCancellation: () => { ignoreCancellation = true },
    holdSchedule: () => { scheduleGate = deferred<void>(); return scheduleGate },
    incompleteAcknowledgement: () => { incompleteAcknowledgement = true },
    emit: (event: NativeReminderEvent) => { if (!listener) throw new Error('Fake listener not attached'); listener(copy(event)) },
    changed: () => changeListener?.(),
    deliver: (id: number) => { const notification = pending.get(id); if (!notification) throw new Error('No pending notification'); pending.delete(id); delivered.set(id, notification); return copy(notification) },
    first: () => { const notification = [...pending.values()][0]; if (!notification) throw new Error('No pending notification'); return copy(notification) },
  }
}
const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })
async function enabled(options: Parameters<typeof harness>[0] = {}) {
  const h = harness(options)
  expect(await h.service.setEnabled(true)).toBe(true)
  return h
}
async function flush(h: ReturnType<typeof harness>) {
  // sync joins the service's serial event queue; the extra microtask allows the
  // intent observer attached to its result to run, without wall-clock sleeps.
  await h.service.sync()
  await Promise.resolve()
}
function foreign(id: number): LocalNotificationSchema {
  return { id, title: 'Other plugin', body: 'Not ours', extra: { owner: 'foreign.namespace' } }
}

describe('notification consent, privacy, and SDK safety', () => {
  it('startup defaults off and never requests permission, schedules, or registers actions', async () => {
    const h = harness()
    await h.service.sync()
    expect(h.service.getSnapshot()).toMatchObject({ available: true, enabled: false, showDetails: false, scheduledCount: 0 })
    expect(h.api.requestPermissions).not.toHaveBeenCalled()
    expect(h.api.checkPermissions).not.toHaveBeenCalled()
    expect(h.api.schedule).not.toHaveBeenCalled()
    expect(h.api.registerActionTypes).not.toHaveBeenCalled()
    expect(h.api.createChannel).not.toHaveBeenCalled()
    expect(h.state.reminders[0].status).toBe('pending')
  })
  it('explicit enable requests consent once and schedules only after grant', async () => {
    const h = await enabled()
    expect(h.api.requestPermissions).toHaveBeenCalledTimes(1)
    expect(h.service.getSnapshot()).toMatchObject({ enabled: true, permission: 'granted', scheduledCount: 1 })
    await h.service.setEnabled(true)
    expect(h.api.requestPermissions).toHaveBeenCalledTimes(1)
    expect(h.api.schedule).toHaveBeenCalledTimes(1)
    expect(h.config()).toMatchObject({ enabled: true, showDetails: false })
  })
  it.each(['denied', 'prompt'] as const)('does not enable or schedule when explicit request returns %s', async permission => {
    const h = harness()
    h.grantOnRequest(permission)
    expect(await h.service.setEnabled(true)).toBe(false)
    expect(h.api.requestPermissions).toHaveBeenCalledTimes(1)
    expect(h.api.schedule).not.toHaveBeenCalled()
    expect(h.writeConfig).not.toHaveBeenCalled()
    expect(h.service.getSnapshot().enabled).toBe(false)
    expect(h.service.getSnapshot().error).not.toBe('')
  })
  it('private defaults leak no title, station, exit, mood or weather details in any scheduled payload', async () => {
    const h = await enabled({ reminders: [
      reminder({ id: 'metro', kind: 'metro', station: 'Secret station', exit: 'Secret exit' }),
      reminder({ id: 'mood', kind: 'mood', title: 'Confidential low mood', status: 'due', deliveredAt: at(0), scheduledAt: null }),
      reminder({ id: 'weather', kind: 'weather', title: 'Private cold weather', temperatureBelow: 10, status: 'due', deliveredAt: at(0), scheduledAt: null }),
    ] })
    expect(h.pending.size).toBe(3)
    for (const notification of h.pending.values()) {
      expect(notification.title).toBe('Aily reminder')
      expect(notification.body).toBe('You have a reminder. Open Aily to review it.')
      const payload = JSON.stringify(notification)
      for (const detail of ['Private medical', 'Secret station', 'Secret exit', 'Confidential', 'low mood', 'Private cold', 'temperature', 'weatherObservedAt', 'moodObservedAt']) expect(payload).not.toContain(detail)
      expect(Object.keys(notification.extra).sort()).toEqual(['epoch', 'fireAt', 'owner', 'reminderId', 'token'])
    }
    expect(h.api.registerActionTypes.mock.calls[0][0].types[0]).toMatchObject({ iosHiddenPreviewsShowTitle: false,
      actions: [{ id: 'complete', foreground: true, requiresAuthentication: true }, { id: 'snooze', foreground: true, requiresAuthentication: true }] })
  })
  it('details are explicit opt-in; opting back out replaces and removes detailed notifications', async () => {
    const h = await enabled({ reminders: [reminder({ kind: 'metro', station: 'Secret station', exit: 'Secret exit' })] })
    const privateId = h.first().id
    await h.service.setShowDetails(true)
    const detailed = h.first()
    expect(detailed.id).not.toBe(privateId)
    expect(detailed.title).toBe('Private medical appointment')
    expect(detailed.body).toContain('Secret station')
    h.deliver(detailed.id)
    await h.service.setShowDetails(false)
    expect(h.delivered.has(detailed.id)).toBe(false)
    expect(h.first().title).toBe('Aily reminder')
    expect(JSON.stringify(h.first())).not.toContain('Secret station')
  })
  it('web/unavailable startup performs no native work and refuses enable', async () => {
    const h = harness({ available: false, native: false, platform: 'web' })
    await h.service.sync()
    await h.service.reset()
    expect(h.listen).not.toHaveBeenCalled()
    await expect(h.service.setEnabled(true)).rejects.toThrow()
    for (const method of Object.values(h.api)) expect(method).not.toHaveBeenCalled()
    expect(h.service.getSnapshot()).toMatchObject({ available: false, permission: 'unavailable', enabled: false })
  })
  it('native plugin unavailability blocks reset when notification bookkeeping exists', async () => {
    const first = await enabled()
    const h = harness({ available: false, native: true, config: first.config() })
    const before = h.config()
    await expect(h.service.reset()).rejects.toThrow()
    expect(h.config()).toEqual(before)
    expect(h.writeConfig).not.toHaveBeenCalled()
    for (const method of Object.values(h.api)) expect(method).not.toHaveBeenCalled()
  })
  it('Android opts out of exact alarms and registers private visibility channel', async () => {
    const h = await enabled({ platform: 'android' })
    expect(h.first()).toMatchObject({ isExactNotification: false, isExactMandatory: false })
    expect(h.first().schedule).toMatchObject({ at: new Date(at(10)), allowWhileIdle: true })
    expect(h.first().schedule).not.toHaveProperty('every')
    expect(h.first().schedule).not.toHaveProperty('repeats')
    expect(h.api.createChannel).toHaveBeenCalledWith(expect.objectContaining({ visibility: 0 }))
    expect(h.api.getAll.mock.calls.every(([options]) => options?.state === 'SCHEDULED' || options?.state === 'TRIGGERED')).toBe(true)
  })
  it('permission loss at the final pre-schedule check does not permanently claim an unscheduled occurrence', async () => {
    const h = harness()
    h.setPermission('granted')
    h.api.checkPermissions
      .mockResolvedValueOnce({ display: 'granted' }) // explicit enable
      .mockResolvedValueOnce({ display: 'granted' }) // planning
      .mockResolvedValueOnce({ display: 'denied' }) // SDK 8.3 safety recheck
    await h.service.setEnabled(true)
    expect(h.api.schedule).not.toHaveBeenCalled()
    expect(h.api.requestPermissions).not.toHaveBeenCalled()
    expect(h.service.getSnapshot()).toMatchObject({ permission: 'denied', scheduledCount: 0 })
    // After the timestamp passes, restoring consent must still allow this
    // genuinely unscheduled occurrence; it is not a delivered duplicate.
    h.setNow(at(20))
    h.state.reminders[0] = { ...h.state.reminders[0], status: 'due', deliveredAt: at(10) }
    await h.service.sync()
    expect(h.api.schedule).toHaveBeenCalledTimes(1)
    expect(h.pending.size).toBe(1)
    expect(h.api.requestPermissions).not.toHaveBeenCalled()
  })
  it('permission revocation cancels owned notifications without automatically requesting again', async () => {
    const h = await enabled()
    const notification = h.first()
    h.delivered.set(notification.id, copy(notification))
    h.setPermission('denied')
    await h.service.sync()
    expect(h.pending.size).toBe(0)
    expect(h.delivered.size).toBe(0)
    expect(h.api.requestPermissions).toHaveBeenCalledTimes(1)
    expect(h.api.schedule).toHaveBeenCalledTimes(1)
    expect(h.service.getSnapshot()).toMatchObject({ enabled: true, permission: 'denied', scheduledCount: 0 })
  })
})

describe('persistent one-per-occurrence ledger and event validation', () => {
  it('repeated sync and service restart reuse the same pending notification identity', async () => {
    const h = await enabled()
    const notification = h.first(), stored = h.config()!
    await h.service.sync(); h.changed(); await flush(h)
    expect(h.pending.size).toBe(1)
    expect(h.first().id).toBe(notification.id)
    expect(h.api.schedule).toHaveBeenCalledTimes(1)
    const restarted = harness({ config: stored })
    restarted.setPermission('granted')
    restarted.pending.set(notification.id, copy(notification))
    await restarted.service.sync()
    expect(restarted.api.requestPermissions).not.toHaveBeenCalled()
    expect(restarted.api.schedule).not.toHaveBeenCalled()
    expect(restarted.config()!.entries[0].id).toBe(notification.id)
  })
  it('does not re-alert delivered repeats or manufacture future repeats before completion', async () => {
    const h = await enabled({ reminders: [reminder({ repeatMinutes: 10 })] })
    const old = h.deliver(h.first().id)
    h.setNow(at(100))
    h.state.reminders[0] = { ...h.state.reminders[0], status: 'due', deliveredAt: at(10) }
    await h.service.sync(); await h.service.sync()
    expect(h.api.schedule).toHaveBeenCalledTimes(1)
    expect(h.pending.size).toBe(0)
    // The domain's completion mutation (not the scheduler) creates the next slot.
    h.state.reminders[0] = { ...h.state.reminders[0], status: 'pending', deliveredAt: null, scheduledAt: at(110) }
    await h.service.sync()
    expect(h.first().id).not.toBe(old.id)
    expect(h.pending.size).toBe(1)
    expect(h.first().schedule?.at).toEqual(new Date(at(110)))
    expect(h.api.schedule).toHaveBeenCalledTimes(2)
  })
  it('snooze receives a fresh ID/token and rejects old native events even after the snoozed occurrence becomes due', async () => {
    const h = await enabled()
    const old = h.deliver(h.first().id)
    h.setNow(at(10))
    h.state.reminders[0] = { ...h.state.reminders[0], status: 'pending', snoozedUntil: at(20), deliveredAt: null }
    await h.service.sync()
    const snoozed = h.first()
    expect(snoozed.id).not.toBe(old.id)
    expect(snoozed.extra.token).not.toBe(old.extra.token)
    expect(h.delivered.has(old.id)).toBe(false)
    h.emit({ kind: 'action', notification: old, actionId: 'snooze' })
    await flush(h)
    expect(h.intents).toEqual([])
    h.setNow(at(20))
    h.deliver(snoozed.id)
    h.state.reminders[0] = { ...h.state.reminders[0], status: 'due', snoozedUntil: null, deliveredAt: at(20) }
    await h.service.sync()
    h.emit({ kind: 'action', notification: old, actionId: 'complete' })
    h.emit({ kind: 'action', notification: { ...snoozed, extra: { ...snoozed.extra, token: old.extra.token } }, actionId: 'complete' })
    await flush(h)
    expect(h.intents).toEqual([])
    h.emit({ kind: 'action', notification: snoozed, actionId: 'complete' })
    await flush(h)
    expect(h.intents).toEqual([expect.objectContaining({ action: 'complete', snapshot: expect.objectContaining({ snoozedUntil: at(20) }) })])
    expect(h.api.schedule).toHaveBeenCalledTimes(2)
  })
  it.each([
    { kind: 'received' as const, actionId: undefined, action: 'open', openApp: false },
    { kind: 'action' as const, actionId: 'tap', action: 'open', openApp: true },
    { kind: 'action' as const, actionId: 'complete', action: 'complete', openApp: true },
    { kind: 'action' as const, actionId: 'snooze', action: 'snooze', openApp: true },
  ])('routes $kind/$actionId only at or after its fire time', async event => {
    const h = await enabled()
    const notification = h.first()
    h.setNow(new Date(Date.parse(notification.extra.fireAt) - 1).toISOString())
    h.emit({ kind: event.kind, notification, actionId: event.actionId })
    await flush(h)
    expect(h.intents).toEqual([])
    h.setNow(notification.extra.fireAt)
    h.emit({ kind: event.kind, notification, actionId: event.actionId })
    await flush(h)
    expect(h.intents).toEqual([{ reminderId: 'r', snapshot: h.config()!.entries[0].occurrence,
      fireAt: notification.extra.fireAt, action: event.action, openApp: event.openApp }])
    expect(h.state.reminders[0].status).toBe('pending') // routing itself never mutates domain state
  })
  it('validates namespace, epoch, token, ID, reminder ID and fireAt before forwarding native payloads', async () => {
    const h = await enabled()
    const notification = h.first()
    h.setNow(at(20))
    const invalid = [
      { ...notification, id: notification.id + 1 }, { ...notification, id: 42 },
      { ...notification, extra: null }, { ...notification, extra: {} },
      ...['owner', 'epoch', 'reminderId', 'token', 'fireAt'].map(field => ({ ...notification, extra: { ...notification.extra, [field]: 'forged' } })),
      { ...notification, extra: { ...notification.extra, fireAt: at(-60) } },
    ]
    for (const payload of invalid) h.emit({ kind: 'action', notification: payload, actionId: 'complete' })
    h.emit({ kind: 'action', notification, actionId: 'unknown-action' })
    h.emit({ kind: 'action', notification })
    await flush(h)
    expect(h.intents).toEqual([])
    h.emit({ kind: 'received', notification })
    await flush(h)
    expect(h.intents).toHaveLength(1)
  })
  it('duplicates route the same immutable occurrence, without creating another OS schedule', async () => {
    const h = await enabled()
    const notification = h.deliver(h.first().id)
    h.setNow(at(10))
    h.state.reminders[0] = { ...h.state.reminders[0], status: 'due', deliveredAt: at(10) }
    for (let i = 0; i < 3; i++) h.emit({ kind: 'received', notification })
    await flush(h)
    expect(h.intents).toHaveLength(3)
    expect(h.intents.every(intent => JSON.stringify(intent) === JSON.stringify(h.intents[0]))).toBe(true)
    expect(h.api.schedule).toHaveBeenCalledTimes(1)
    // The domain consumes duplicate intent snapshots atomically; the service
    // must preserve identity rather than manufacture a fresh occurrence.
    expect(h.config()!.entries).toHaveLength(1)
  })
  it('old epoch cannot act on a newly enabled configuration even if ID and occurrence match', async () => {
    const first = await enabled()
    const old = first.first(), stored = first.config()!
    const next = harness({ config: { ...stored, epoch: 'different-epoch' } })
    next.setPermission('granted')
    next.pending.set(old.id, copy(old))
    await next.service.sync()
    next.setNow(at(10))
    next.emit({ kind: 'action', notification: old, actionId: 'complete' })
    await flush(next)
    expect(next.intents).toEqual([])
    next.emit({ kind: 'action', notification: { ...old, extra: { ...old.extra, epoch: 'different-epoch' } }, actionId: 'complete' })
    await flush(next)
    expect(next.intents).toHaveLength(1)
  })
  it('does not accept a valid-looking callback for an unrequested ledger entry', async () => {
    const first = await enabled()
    const notification = first.first(), stored = first.config()!
    const next = harness({ config: { ...stored, entries: stored.entries.map(entry => ({ ...entry, requested: false })) } })
    next.setPermission('denied')
    next.setNow(at(10))
    next.emit({ kind: 'action', notification, actionId: 'complete' })
    await flush(next)
    expect(next.intents).toEqual([])
    expect(next.api.requestPermissions).not.toHaveBeenCalled()
  })
  it('completed or deleted occurrences invalidate events after reconciliation', async () => {
    const h = await enabled()
    const notification = h.first()
    h.setNow(at(10))
    h.state.reminders[0].status = 'completed'
    await h.service.sync()
    h.emit({ kind: 'action', notification, actionId: 'snooze' })
    await flush(h)
    expect(h.intents).toEqual([])
    expect(h.config()!.entries).toEqual([])
  })
})

describe('ownership, queue limits, cancellation, and lifecycle races', () => {
  it.each(['disable', 'delete', 'reset'] as const)('%s cancels own pending and delivered notifications, never foreign namespace IDs', async operation => {
    const h = await enabled()
    const notification = h.first()
    h.delivered.set(notification.id, copy(notification))
    const foreignIds = [42, REMINDER_NOTIFICATION_ID_START + 50]
    for (const id of foreignIds) { h.pending.set(id, foreign(id)); h.delivered.set(id, foreign(id)) }
    if (operation === 'disable') await h.service.setEnabled(false)
    else if (operation === 'delete') { h.state.reminders = []; await h.service.sync() }
    else await h.service.reset()
    expect(h.pending.has(notification.id)).toBe(false)
    expect(h.delivered.has(notification.id)).toBe(false)
    for (const id of foreignIds) { expect(h.pending.has(id)).toBe(true); expect(h.delivered.has(id)).toBe(true) }
    const canceled = h.api.cancel.mock.calls.flatMap(([options]) => options.notifications.map(item => item.id))
    const removed = h.api.removeDeliveredNotificationsById.mock.calls.flatMap(([options]) => options.ids)
    expect(canceled).not.toEqual(expect.arrayContaining(foreignIds))
    for (const id of foreignIds) { expect(canceled).not.toContain(id); expect(removed).not.toContain(id) }
  })
  it('enabled sync recovers from a foreign ID collision using a fresh Aily ID without altering foreign notifications', async () => {
    const h = await enabled()
    const oldId = h.first().id
    h.pending.set(oldId, foreign(oldId))
    h.delivered.set(oldId, foreign(oldId))
    await h.service.sync()
    const ours = [...h.pending.values()].filter(notification => notification.extra?.owner === REMINDER_NOTIFICATION_OWNER)
    expect(ours).toHaveLength(1)
    expect(ours[0].id).not.toBe(oldId)
    expect(h.pending.get(oldId)).toEqual(foreign(oldId))
    expect(h.delivered.get(oldId)).toEqual(foreign(oldId))
    expect(h.config()!.entries).toEqual([expect.objectContaining({ id: ours[0].id, reminderId: 'r' })])
    expect(h.service.getSnapshot().scheduledCount).toBe(1)
    await h.service.sync()
    expect(h.api.schedule).toHaveBeenCalledTimes(2)
    expect(h.pending.size).toBe(2)
  })
  it.each(['disable', 'delete', 'reset'] as const)('%s preserves an explicitly foreign notification even when its ID collides with an old ledger entry', async operation => {
    const h = await enabled()
    const id = h.first().id
    // Another client of the SDK can overwrite an integer ID. The explicit
    // namespace on current OS state must take precedence over stale bookkeeping.
    h.pending.set(id, foreign(id))
    h.delivered.set(id, foreign(id))
    if (operation === 'disable') await h.service.setEnabled(false)
    else if (operation === 'delete') { h.state.reminders = []; await h.service.sync() }
    else await h.service.reset()
    expect(h.pending.get(id)).toEqual(foreign(id))
    expect(h.delivered.get(id)).toEqual(foreign(id))
    const canceled = h.api.cancel.mock.calls.flatMap(([options]) => options.notifications.map(item => item.id))
    const removed = h.api.removeDeliveredNotificationsById.mock.calls.flatMap(([options]) => options.ids)
    expect(canceled).not.toContain(id)
    expect(removed).not.toContain(id)
  })
  it('reminder toggle off removes delivery but re-enable does not re-alert the already due occurrence', async () => {
    const h = await enabled()
    h.deliver(h.first().id)
    h.setNow(at(10))
    h.state.reminders[0] = { ...h.state.reminders[0], status: 'due', deliveredAt: at(10), enabled: false }
    await h.service.sync()
    expect(h.delivered.size).toBe(0)
    h.state.reminders[0].enabled = true
    await h.service.sync()
    expect(h.api.schedule).toHaveBeenCalledTimes(1)
  })
  it.each(['cancel', 'delivered', 'still-present'] as const)('reset aborts private erase when %s fails and preserves persisted config', async failure => {
    const h = await enabled()
    const notification = h.first(), before = h.config()
    h.delivered.set(notification.id, copy(notification))
    if (failure === 'cancel') h.failCancellation()
    else if (failure === 'delivered') h.failDeliveredRemoval()
    else h.ignoreCancellation()
    const erasePrivateData = vi.fn(() => { h.state.reminders = [] })
    const erase = async () => { await h.service.reset(); erasePrivateData() }
    await expect(erase()).rejects.toThrow()
    expect(erasePrivateData).not.toHaveBeenCalled()
    expect(h.config()).toEqual(before)
    expect(h.state.reminders).toHaveLength(1)
  })
  it.each([0, 10, 60, 64])('caps own queue at 60 while reserving iOS capacity for %i foreign pending notifications', async foreignCount => {
    const h = harness({ reminders: Array.from({ length: 80 }, (_, index) => reminder({ id: `r-${String(index).padStart(3, '0')}` })) })
    for (let index = 0; index < foreignCount; index++) h.pending.set(index + 1, foreign(index + 1))
    await h.service.setEnabled(true)
    const count = Math.max(0, Math.min(60, 64 - foreignCount - 4))
    expect(h.service.getSnapshot()).toMatchObject({ scheduledCount: count, deferredCount: 80 - count })
    expect(h.pending.size).toBe(foreignCount + count)
    expect(h.config()!.entries).toHaveLength(count)
    await h.service.sync()
    expect(h.pending.size).toBe(foreignCount + count)
  })
  it.each(['disable', 'reset'] as const)('late in-flight schedule after %s is canceled and cannot resurrect notifications', async operation => {
    const h = harness()
    const gate = h.holdSchedule()
    const enabling = h.service.setEnabled(true)
    await h.scheduleEntered.promise
    expect(h.config()!.entries[0].requested).toBe(true) // identity persisted before SDK call
    const stopping = operation === 'disable' ? h.service.setEnabled(false) : h.service.reset()
    gate.resolve()
    await enabling; await stopping
    expect(h.pending.size).toBe(0)
    expect(h.service.getSnapshot()).toMatchObject({ enabled: false, scheduledCount: 0 })
    const scheduledId = h.api.schedule.mock.calls[0][0].notifications[0].id
    expect(h.api.cancel.mock.calls.flatMap(([options]) => options.notifications.map(item => item.id))).toContain(scheduledId)
    await h.service.sync()
    expect(h.pending.size).toBe(0)
    expect(h.api.schedule).toHaveBeenCalledTimes(1)
  })
  it('partial schedule acknowledgement cancels the batch and leaves retryable identities', async () => {
    const h = harness()
    h.incompleteAcknowledgement()
    await expect(h.service.setEnabled(true)).rejects.toThrow()
    expect(h.pending.size).toBe(0)
    expect(h.config()!.entries[0].requested).toBe(false)
    expect(h.service.getSnapshot().error).not.toBe('')
  })
  it('unmount removes only listener handles and retains already scheduled OS notifications', async () => {
    const h = await enabled()
    const notification = h.first()
    h.detach()
    await Promise.resolve()
    expect(h.stopNative).toHaveBeenCalledTimes(1)
    expect(h.stopChanges).toHaveBeenCalledTimes(1)
    expect(h.pending.get(notification.id)).toEqual(notification)
    expect(h.api.cancel).not.toHaveBeenCalled()
    expect(h.api.removeDeliveredNotificationsById).not.toHaveBeenCalled()
    expect(h.config()!.enabled).toBe(true)
  })
  it('in-flight schedule completing after unmount is canceled', async () => {
    const h = harness(), gate = h.holdSchedule()
    const enabling = h.service.setEnabled(true)
    await h.scheduleEntered.promise
    h.detach()
    gate.resolve()
    await enabling
    expect(h.pending.size).toBe(0)
    expect(h.stopNative).toHaveBeenCalledTimes(1)
  })
  it('resume notifies attached client and reconciles without requesting consent', async () => {
    const h = await enabled()
    h.emit({ kind: 'resume' })
    await flush(h)
    expect(h.onResume).toHaveBeenCalledTimes(1)
    expect(h.api.requestPermissions).toHaveBeenCalledTimes(1)
    expect(h.api.schedule).toHaveBeenCalledTimes(1)
  })
})
