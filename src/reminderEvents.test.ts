import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db'
import { notifyReminderChanges, subscribeReminderChanges } from './reminderEvents'
import { actOnReminderNotification, addReminder, evaluateReminders, loadReminderState, sameReminderNotificationOccurrence, saveReminderContext, saveReminderQuietHours, updateReminder } from './smartReminders'
import type { Reminder, ReminderNotificationSnapshot } from './smartReminders'

const now = new Date('2025-02-01T12:00:00.000Z')
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000)
const input = (patch: Partial<Parameters<typeof addReminder>[0]> = {}): Parameters<typeof addReminder>[0] => ({ title: 'Drink water', kind: 'water', enabled: true, scheduledAt: at(10).toISOString(), repeatMinutes: null, temperatureBelow: null, station: '', exit: '', leadMinutes: 0, ...patch })
const snapshot = (reminder: Reminder): ReminderNotificationSnapshot => ({ createdAt: reminder.createdAt, scheduledAt: reminder.scheduledAt, snoozedUntil: reminder.snoozedUntil })
const current = async () => (await loadReminderState()).reminders[0]
const unquiet = () => saveReminderQuietHours({ enabled: false, start: 1320, end: 480 })
const disposers: (() => void)[] = []
function listen(listener: () => void) { const dispose = subscribeReminderChanges(listener); disposers.push(dispose); return dispose }
beforeEach(async () => { vi.restoreAllMocks(); await db.delete(); await db.open() })
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); vi.restoreAllMocks() })

describe('native reminder occurrence actions', () => {
  it('opens a valid delivered signal without completing, keeps strict schema, and deduplicates open', async () => {
    const reminder = await addReminder(input(), now)
    const listener = vi.fn(); listen(listener)
    expect(await actOnReminderNotification(reminder.id, snapshot(reminder), at(10).toISOString(), 'open', at(12))).toBe(true)
    expect(await current()).toEqual({ ...reminder, status: 'due', deliveredAt: at(12).toISOString() })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(await actOnReminderNotification(reminder.id, snapshot(reminder), at(10).toISOString(), 'open', at(13))).toBe(true)
    expect((await current()).deliveredAt).toBe(at(12).toISOString())
    expect(listener).toHaveBeenCalledTimes(1)
    expect(sameReminderNotificationOccurrence(await current(), snapshot(reminder))).toBe(true)
  })
  it('completes once under concurrent native actions and does not advance a newer repeat', async () => {
    const reminder = await addReminder(input({ repeatMinutes: 10 }), now)
    const occurrence = snapshot(reminder)
    const results = await Promise.all(Array.from({ length: 12 }, () => actOnReminderNotification(reminder.id, occurrence, at(10).toISOString(), 'complete', at(45))))
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await current()).toMatchObject({ status: 'pending', scheduledAt: at(50).toISOString(), deliveredAt: null })
    expect(sameReminderNotificationOccurrence(await current(), occurrence)).toBe(false)
    await unquiet(); await evaluateReminders(at(50))
    expect(await actOnReminderNotification(reminder.id, occurrence, at(10).toISOString(), 'complete', at(55))).toBe(false)
    expect((await current()).scheduledAt).toBe(at(50).toISOString())
  })
  it('serializes native and foreground completion without double advancing', async () => {
    await unquiet()
    const reminder = await addReminder(input({ repeatMinutes: 10 }), now)
    await evaluateReminders(at(10))
    await Promise.all([
      actOnReminderNotification(reminder.id, snapshot(reminder), at(10).toISOString(), 'complete', at(45)),
      updateReminder(reminder.id, 'complete', at(45)),
    ])
    expect(await current()).toMatchObject({ status: 'pending', scheduledAt: at(50).toISOString() })
  })
  it('rolls back a successful nested native action when the outer transaction aborts', async () => {
    const reminder = await addReminder(input({ repeatMinutes: 10 }), now)
    const listener = vi.fn(); listen(listener)
    await expect(db.transaction('rw', db.settings, async () => {
      expect(await actOnReminderNotification(reminder.id, snapshot(reminder), at(10).toISOString(), 'complete', at(45))).toBe(true)
      expect(listener).not.toHaveBeenCalled()
      throw new Error('native outer rollback')
    })).rejects.toThrow('native outer rollback')
    expect(await current()).toEqual(reminder)
    expect(listener).not.toHaveBeenCalled()
  })
  it('shares completion semantics for metro lead slots and unscheduled contextual repeats', async () => {
    const metro = await addReminder(input({ kind: 'metro', station: 'User station', exit: 'User exit', leadMinutes: 5, repeatMinutes: 10 }), now)
    expect(await actOnReminderNotification(metro.id, snapshot(metro), at(5).toISOString(), 'complete', at(45))).toBe(true)
    expect((await current()).scheduledAt).toBe(at(60).toISOString())
    const mood = await addReminder(input({ kind: 'mood', scheduledAt: null, repeatMinutes: 30 }), now)
    expect(await actOnReminderNotification(mood.id, snapshot(mood), now.toISOString(), 'complete', at(45))).toBe(true)
    expect((await loadReminderState()).reminders[1]).toMatchObject({ status: 'pending', scheduledAt: at(75).toISOString() })
  })
  it('rejects future signals, forged early fire times, stale identity, disabled, completed and deleted records', async () => {
    const reminder = await addReminder(input(), now), occurrence = snapshot(reminder)
    const listener = vi.fn(); listen(listener)
    expect(await actOnReminderNotification(reminder.id, occurrence, at(10).toISOString(), 'complete', at(9))).toBe(false)
    expect(await actOnReminderNotification(reminder.id, occurrence, at(9).toISOString(), 'complete', at(10))).toBe(false)
    for (const stale of [{ ...occurrence, createdAt: at(-1).toISOString() }, { ...occurrence, scheduledAt: at(11).toISOString() }, { ...occurrence, snoozedUntil: at(10).toISOString() }]) {
      expect(sameReminderNotificationOccurrence(reminder, stale)).toBe(false)
      expect(await actOnReminderNotification(reminder.id, stale, at(10).toISOString(), 'complete', at(10))).toBe(false)
    }
    expect(listener).not.toHaveBeenCalled()
    await updateReminder(reminder.id, 'toggle', now)
    expect(sameReminderNotificationOccurrence(await current(), occurrence)).toBe(true)
    expect(await actOnReminderNotification(reminder.id, occurrence, at(10).toISOString(), 'open', at(10))).toBe(false)
    await updateReminder(reminder.id, 'toggle', now)
    expect(await actOnReminderNotification(reminder.id, occurrence, at(10).toISOString(), 'complete', at(10))).toBe(true)
    expect(sameReminderNotificationOccurrence(await current(), occurrence)).toBe(false)
    expect(await actOnReminderNotification(reminder.id, occurrence, at(10).toISOString(), 'snooze', at(11))).toBe(false)
    await updateReminder(reminder.id, 'delete', at(11))
    expect(await actOnReminderNotification(reminder.id, occurrence, at(10).toISOString(), 'complete', at(12))).toBe(false)
  })
  it('snoozes exactly ten minutes despite changed context, while planner/evaluator retains quiet handling', async () => {
    await unquiet()
    const reminder = await addReminder(input({ kind: 'mood', scheduledAt: null }), now)
    const occurrence = snapshot(reminder)
    expect(await actOnReminderNotification(reminder.id, occurrence, now.toISOString(), 'snooze', now)).toBe(true)
    const snoozed = await current(), snoozeOccurrence = snapshot(snoozed)
    expect(snoozed).toMatchObject({ status: 'pending', deliveredAt: null, snoozedUntil: at(10).toISOString() })
    expect(sameReminderNotificationOccurrence(snoozed, occurrence)).toBe(false)
    expect(await actOnReminderNotification(reminder.id, occurrence, now.toISOString(), 'complete', at(1))).toBe(false)
    expect(await actOnReminderNotification(reminder.id, snoozeOccurrence, at(10).toISOString(), 'open', at(9))).toBe(false)
    await saveReminderContext({ temperature: null, weatherObservedAt: null, mood: 'okay', moodObservedAt: now.toISOString() })
    await saveReminderQuietHours({ enabled: true, start: 0, end: 0 })
    expect(await evaluateReminders(at(10))).toEqual([])
    await unquiet(); expect(await evaluateReminders(at(10))).toHaveLength(1)
    const delivered = await current()
    expect(sameReminderNotificationOccurrence(delivered, snoozeOccurrence)).toBe(true)
    expect(sameReminderNotificationOccurrence({ ...delivered, enabled: false }, snoozeOccurrence)).toBe(true)
    expect(sameReminderNotificationOccurrence({ ...delivered, deliveredAt: at(9).toISOString() }, snoozeOccurrence)).toBe(false)
    expect(await actOnReminderNotification(reminder.id, snoozeOccurrence, at(10).toISOString(), 'complete', at(11))).toBe(true)
  })
  it('rejects stale snooze and duplicate snooze actions atomically', async () => {
    const reminder = await addReminder(input(), now)
    const results = await Promise.all([10, 11].map(time => actOnReminderNotification(reminder.id, snapshot(reminder), at(10).toISOString(), 'snooze', at(time))))
    expect(results).toEqual([true, false])
    const firstSnooze = snapshot(await current())
    expect(await actOnReminderNotification(reminder.id, firstSnooze, at(20).toISOString(), 'snooze', at(20))).toBe(true)
    expect((await current()).snoozedUntil).toBe(at(30).toISOString())
    expect(await actOnReminderNotification(reminder.id, firstSnooze, at(20).toISOString(), 'complete', at(21))).toBe(false)
  })
  it('validates runtime ids, exact snapshots, timestamps, actions and clocks without writing', async () => {
    const reminder = await addReminder(input(), now), occurrence = snapshot(reminder)
    const listener = vi.fn(); listen(listener)
    for (const value of [null, {}, { ...occurrence, extra: true }, { ...occurrence, createdAt: 'yesterday' }, { ...occurrence, scheduledAt: '2025-02-30T12:00:00Z' }, { ...occurrence, snoozedUntil: at(-1).toISOString() }]) {
      expect(sameReminderNotificationOccurrence(reminder, value as never)).toBe(false)
      await expect(actOnReminderNotification(reminder.id, value as never, at(10).toISOString(), 'open', at(10))).rejects.toThrow()
    }
    for (const id of ['', '../id', 'x'.repeat(101)]) await expect(actOnReminderNotification(id, occurrence, at(10).toISOString(), 'open', at(10))).rejects.toThrow()
    for (const fire of ['tomorrow', '2025-02-30T12:00:00Z', '2025-02-01T12:10:00']) await expect(actOnReminderNotification(reminder.id, occurrence, fire, 'open', at(10))).rejects.toThrow()
    await expect(actOnReminderNotification(reminder.id, occurrence, at(10).toISOString(), 'other' as never, at(10))).rejects.toThrow()
    await expect(actOnReminderNotification(reminder.id, occurrence, at(10).toISOString(), 'open', new Date('bad'))).rejects.toThrow()
    expect(listener).not.toHaveBeenCalled(); expect(await current()).toEqual(reminder)
    const offset = { ...occurrence, createdAt: '2025-02-01T20:00:00+08:00', scheduledAt: '2025-02-01T20:10:00+08:00' }
    expect(sameReminderNotificationOccurrence(reminder, offset)).toBe(true)
  })
  it('rolls back failed native writes and overflow completion/snooze without emission, then allows retry', async () => {
    const reminder = await addReminder(input({ repeatMinutes: 10 }), now)
    const listener = vi.fn(); listen(listener)
    vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('quota'))
    await expect(actOnReminderNotification(reminder.id, snapshot(reminder), at(10).toISOString(), 'complete', at(10))).rejects.toThrow('quota')
    expect(await current()).toEqual(reminder); expect(listener).not.toHaveBeenCalled()
    for (const action of ['complete', 'snooze'] as const) await expect(actOnReminderNotification(reminder.id, snapshot(reminder), at(10).toISOString(), action, new Date('9999-12-31T23:59:59.999Z'))).rejects.toThrow()
    expect(await current()).toEqual(reminder); expect(listener).not.toHaveBeenCalled()
    expect(await actOnReminderNotification(reminder.id, snapshot(reminder), at(10).toISOString(), 'complete', at(10))).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('reminder domain change events', () => {
  it('supports disposal and isolates subscriber exceptions', () => {
    const bad = vi.fn(() => { throw new Error('subscriber failure') }), good = vi.fn()
    listen(bad); const dispose = listen(good)
    expect(() => notifyReminderChanges()).not.toThrow()
    expect(good).toHaveBeenCalledTimes(1)
    dispose(); dispose(); notifyReminderChanges()
    expect(good).toHaveBeenCalledTimes(1); expect(bad).toHaveBeenCalledTimes(2)
  })
  it('emits for changed add/update/context/quiet/evaluation only, not reads or no-ops', async () => {
    const listener = vi.fn(); listen(listener)
    await loadReminderState(); await evaluateReminders(now)
    await saveReminderContext({ temperature: null, weatherObservedAt: null, mood: 'unknown', moodObservedAt: null })
    await saveReminderQuietHours({ enabled: true, start: 1320, end: 480 })
    expect(listener).not.toHaveBeenCalled()
    const reminder = await addReminder(input({ repeatMinutes: 10 }), now)
    expect(listener).toHaveBeenCalledTimes(1)
    await updateReminder('missing-id', 'delete', now); await updateReminder(reminder.id, 'complete', now)
    expect(listener).toHaveBeenCalledTimes(1)
    const context = { temperature: 5, weatherObservedAt: now.toISOString(), mood: 'low' as const, moodObservedAt: now.toISOString() }
    await saveReminderContext(context); await saveReminderContext(context)
    await unquiet(); await unquiet()
    expect(listener).toHaveBeenCalledTimes(3)
    await evaluateReminders(at(10)); await evaluateReminders(at(11))
    expect(listener).toHaveBeenCalledTimes(4)
    await updateReminder(reminder.id, 'snooze', at(11)); await updateReminder(reminder.id, 'snooze', at(11))
    expect(listener).toHaveBeenCalledTimes(5)
    await updateReminder(reminder.id, 'toggle', at(11)); await updateReminder(reminder.id, 'delete', at(11))
    expect(listener).toHaveBeenCalledTimes(7)
  })
  it('coalesces nested changes and emits only after the successful outer transaction commit', async () => {
    const reads: Promise<unknown>[] = []
    const listener = vi.fn(() => { reads.push(loadReminderState()) }); listen(listener)
    await db.transaction('rw', db.settings, async () => {
      const reminder = await addReminder(input(), now)
      await unquiet(); await updateReminder(reminder.id, 'toggle', now)
      expect(listener).not.toHaveBeenCalled()
    })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(await reads[0]).toMatchObject({ reminders: [{ enabled: false }], quietHours: { enabled: false } })
  })
  it('does not emit on outer rollback even when nested domain writes succeeded', async () => {
    const listener = vi.fn(); listen(listener)
    await expect(db.transaction('rw', db.settings, async () => {
      await addReminder(input(), now); await unquiet()
      expect(listener).not.toHaveBeenCalled()
      throw new Error('outer rollback')
    })).rejects.toThrow('outer rollback')
    expect(listener).not.toHaveBeenCalled(); expect(await db.settings.get('__smartReminders:v1')).toBeUndefined()
    await addReminder(input(), now); expect(listener).toHaveBeenCalledTimes(1)
  })
  it('never emits on failed add/context/quiet/evaluate/update writes', async () => {
    const listener = vi.fn(); listen(listener)
    vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('add'))
    await expect(addReminder(input(), now)).rejects.toThrow('add')
    expect(listener).not.toHaveBeenCalled()
    const reminder = await addReminder(input(), now); await unquiet(); listener.mockClear()
    const before = await loadReminderState()
    const operations = [
      () => saveReminderContext({ temperature: 5, weatherObservedAt: now.toISOString(), mood: 'low', moodObservedAt: now.toISOString() }),
      () => saveReminderQuietHours({ enabled: true, start: 0, end: 0 }),
      () => evaluateReminders(at(10)),
      () => updateReminder(reminder.id, 'delete', now),
    ]
    for (const operation of operations) {
      vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('write failure'))
      await expect(operation()).rejects.toThrow('write failure')
      expect(listener).not.toHaveBeenCalled(); expect(await loadReminderState()).toEqual(before)
    }
  })
})
