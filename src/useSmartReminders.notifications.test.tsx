import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReminderNotificationIntent } from './reminderNotifications'
import type { ReminderState } from './smartReminders'
type Client = { onIntent: (intent: ReminderNotificationIntent) => Promise<void>; onResume: () => void }
const native = vi.hoisted(() => {
  const status = { available: true, enabled: true, showDetails: false, permission: 'granted', scheduledCount: 0, deferredCount: 0, contextOnlyCount: 0, busy: false, error: '' }
  return { client: null as Client | null, service: { getSnapshot: () => status, subscribe: () => () => {}, setActive: vi.fn(), attach: vi.fn((_client: Client) => () => {}), sync: vi.fn(async () => {}), reset: vi.fn(async () => {}), setEnabled: vi.fn(async () => true), setShowDetails: vi.fn(async () => {}), sendTest: vi.fn(async () => true) } }
})
vi.mock('./reminderNotifications', () => ({ reminderNotifications: native.service }))
vi.mock('./smartReminders', () => ({ addReminder: vi.fn(), evaluateReminders: vi.fn(), loadReminderState: vi.fn(), saveReminderContext: vi.fn(), saveReminderQuietHours: vi.fn(), updateReminder: vi.fn(), actOnReminderNotification: vi.fn() }))
import useSmartReminders from './useSmartReminders'
import { actOnReminderNotification, addReminder, evaluateReminders, loadReminderState } from './smartReminders'
const state = (): ReminderState => ({ reminders: [], context: { temperature: null, weatherObservedAt: null, mood: 'unknown', moodObservedAt: null }, quietHours: { enabled: false, start: 0, end: 0 } })
const intent: ReminderNotificationIntent = { reminderId: 'reminder-1', snapshot: { createdAt: '2026-11-07T10:00:00.000Z', scheduledAt: '2026-11-07T10:30:00.000Z', snoozedUntil: null }, fireAt: '2026-11-07T10:30:00.000Z', action: 'complete', openApp: true }
const settle = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }) }
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.mocked(loadReminderState).mockResolvedValue(state()); vi.mocked(evaluateReminders).mockResolvedValue([]); vi.mocked(actOnReminderNotification).mockResolvedValue(true)
  native.service.sync.mockResolvedValue(undefined); native.service.reset.mockResolvedValue(undefined)
  native.service.attach.mockImplementation(client => { native.client = client; return () => { native.client = null } })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })
describe('notification intents through the reminder controller', () => {
  it('routes a validated accepted action, but not a stale action', async () => {
    const open = vi.fn(); const hook = renderHook(() => useSmartReminders(true, open)); await settle()
    await act(async () => { await native.client!.onIntent(intent) })
    expect(actOnReminderNotification).toHaveBeenCalledExactlyOnceWith(intent.reminderId, intent.snapshot, intent.fireAt, 'complete')
    expect(open).toHaveBeenCalledOnce(); expect(hook.result.current.openedNotificationId).toBe(intent.reminderId)
    vi.mocked(actOnReminderNotification).mockResolvedValue(false)
    await act(async () => { await native.client!.onIntent(intent) })
    expect(open).toHaveBeenCalledOnce()
  })
  it('does not navigate on foreground receipt or process a late action after unmount', async () => {
    const open = vi.fn(); const hook = renderHook(() => useSmartReminders(true, open)); await settle()
    const client = native.client!
    await act(async () => { await client.onIntent({ ...intent, action: 'open', openApp: false }) })
    expect(open).not.toHaveBeenCalled(); hook.unmount()
    await act(async () => { await client.onIntent(intent) })
    expect(actOnReminderNotification).toHaveBeenCalledTimes(1)
  })
  it('does not report a persisted reminder as unsaved when OS synchronization fails', async () => {
    const hook = renderHook(() => useSmartReminders(true)); await settle()
    native.service.sync.mockRejectedValue(new Error('OS failure'))
    vi.mocked(addReminder).mockResolvedValue({ id: 'saved', title: 'Water', kind: 'water', enabled: true, scheduledAt: intent.fireAt, repeatMinutes: null, temperatureBelow: null, station: '', exit: '', leadMinutes: 0, status: 'pending', deliveredAt: null, snoozedUntil: null, createdAt: intent.snapshot.createdAt })
    await act(async () => { expect(await hook.result.current.add({ title: 'Water', kind: 'water', enabled: true, scheduledAt: intent.fireAt, repeatMinutes: null, temperatureBelow: null, station: '', exit: '', leadMinutes: 0 })).toBe(true) })
    expect(addReminder).toHaveBeenCalledOnce(); expect(hook.result.current.error).toBe('')
  })
})
