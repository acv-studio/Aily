import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import type { LocalNotificationSchema } from '@capacitor/local-notifications'
import { db, clearAllData, importData } from './db'
import { addReminder, actOnReminderNotification, loadReminderState, saveReminderQuietHours } from './smartReminders'
import { subscribeReminderChanges } from './reminderEvents'
import { createReminderNotificationService, REMINDER_NOTIFICATION_KEY, cancelReminderNotificationsForReset, type ReminderNotificationIntent } from './reminderNotifications'
import type { NativeReminderEvent, NotificationApi } from './nativeLocalNotifications'

vi.mock('./reminderNotifications', async importOriginal => ({ ...await importOriginal<typeof import('./reminderNotifications')>(), cancelReminderNotificationsForReset: vi.fn(async () => {}) }))
let detach: (() => void) | undefined
beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-07T10:00:00.000Z')); await db.delete(); await db.open(); await saveReminderQuietHours({ enabled: false, start: 0, end: 0 }); vi.mocked(cancelReminderNotificationsForReset).mockReset().mockResolvedValue(undefined) })
afterEach(async () => { detach?.(); detach = undefined; vi.useRealTimers(); vi.restoreAllMocks(); await db.delete() })
function setup() {
  let pending: LocalNotificationSchema[] = [], delivered: LocalNotificationSchema[] = []
  let native: (event: NativeReminderEvent) => void = () => {}
  const api: NotificationApi = {
    checkPermissions: vi.fn(async () => ({ display: 'granted' as const })), requestPermissions: vi.fn(async () => ({ display: 'granted' as const })),
    registerActionTypes: vi.fn(async () => {}), createChannel: vi.fn(async () => {}),
    getAll: vi.fn(async options => ({ notifications: [...(options?.state === 'TRIGGERED' ? delivered : pending)] })),
    schedule: vi.fn(async options => { pending = [...pending.filter(old => !options.notifications.some((item: LocalNotificationSchema) => item.id === old.id)), ...options.notifications]; return { notifications: options.notifications.map((item: LocalNotificationSchema) => ({ id: item.id })) } }),
    cancel: vi.fn(async options => { pending = pending.filter(item => !options.notifications.some((cancel: { id: number }) => cancel.id === item.id)) }),
    removeDeliveredNotificationsById: vi.fn(async options => { delivered = delivered.filter(item => !options.ids.includes(item.id)) }),
  }
  const intents = vi.fn(async (intent: ReminderNotificationIntent) => { await actOnReminderNotification(intent.reminderId, intent.snapshot, intent.fireAt, intent.action) })
  const service = createReminderNotificationService({ api, available: () => true, native: () => true, platform: () => 'ios', now: () => new Date(), locale: () => 'zh-CN', uuid: () => crypto.randomUUID(), readReminders: loadReminderState, readConfig: async () => (await db.settings.get(REMINDER_NOTIFICATION_KEY))?.value, writeConfig: async value => { await db.settings.put({ key: REMINDER_NOTIFICATION_KEY, value }) }, subscribeChanges: subscribeReminderChanges, listen: async listener => { native = listener; return async () => {} } })
  detach = service.attach({ onIntent: intents, onResume: () => {} }); service.setActive(true)
  return { service, api, intents, getPending: () => pending, fire: (notification: LocalNotificationSchema, action = 'complete') => { pending = pending.filter(item => item.id !== notification.id); delivered.push(notification); native({ kind: 'action', actionId: action, notification }) } }
}
const reminderInput = { title: '喝水提醒', kind: 'water' as const, enabled: true, scheduledAt: '2026-11-07T10:30:00.000Z', repeatMinutes: 60, temperatureBelow: null, station: '', exit: '', leadMinutes: 0 }
describe('native notification ledger with real reminder transactions', () => {
  it('schedules direct model writes after commit, consumes actions atomically, and rejects a retired occurrence', async () => {
    const { service, api, intents, getPending, fire } = setup(); await service.setEnabled(true)
    const reminder = await addReminder(reminderInput)
    await waitFor(() => expect(getPending()).toHaveLength(1))
    const first = getPending()[0]
    expect(first.body).not.toContain(reminderInput.title)
    vi.setSystemTime(new Date('2026-11-07T10:31:00.000Z')); fire(first)
    await waitFor(async () => expect((await loadReminderState()).reminders[0].scheduledAt).toBe('2026-11-07T11:30:00.000Z'))
    await service.sync()
    expect(getPending()).toHaveLength(1)
    expect(getPending()[0].id).not.toBe(first.id)
    const calls = intents.mock.calls.length
    fire(first); await service.sync()
    expect(intents).toHaveBeenCalledTimes(calls)
    expect((await loadReminderState()).reminders[0].id).toBe(reminder.id)
    expect(api.requestPermissions).not.toHaveBeenCalled()
  })
  it('does not erase private records when system notification cancellation fails', async () => {
    await db.settings.put({ key: 'private-test', value: 'keep' })
    vi.mocked(cancelReminderNotificationsForReset).mockRejectedValueOnce(new Error('system cancellation denied'))
    await expect(clearAllData()).rejects.toThrow('system cancellation denied')
    expect((await db.settings.get('private-test'))?.value).toBe('keep')
    vi.mocked(cancelReminderNotificationsForReset).mockResolvedValue(undefined)
    await clearAllData(); expect(await db.settings.get('private-test')).toBeUndefined()
  })
  it('validates backups before touching system notifications', async () => {
    await expect(importData('not valid JSON')).rejects.toThrow()
    expect(cancelReminderNotificationsForReset).not.toHaveBeenCalled()
  })
  it('cancels OS notifications before a successful reminder reset and leaves unrelated notifications alone', async () => {
    const { service, getPending } = setup(); await service.setEnabled(true); await addReminder(reminderInput); await service.sync()
    expect(getPending()).toHaveLength(1)
    vi.mocked(cancelReminderNotificationsForReset).mockImplementation(() => service.reset())
    await clearAllData()
    expect(getPending()).toHaveLength(0)
    expect(await db.settings.get(REMINDER_NOTIFICATION_KEY)).toBeUndefined()
    expect((await loadReminderState()).reminders).toHaveLength(0)
  })
})
