import { StrictMode, type ReactNode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useSmartReminders from './useSmartReminders'
import { addReminder, evaluateReminders, loadReminderState, saveReminderContext, saveReminderQuietHours, updateReminder } from './smartReminders'
import type { Reminder, ReminderState } from './smartReminders'

vi.mock('./smartReminders', () => ({
  addReminder: vi.fn(), evaluateReminders: vi.fn(), loadReminderState: vi.fn(),
  saveReminderContext: vi.fn(), saveReminderQuietHours: vi.fn(), updateReminder: vi.fn(),
}))
const load = vi.mocked(loadReminderState), evaluate = vi.mocked(evaluateReminders)
const add = vi.mocked(addReminder), update = vi.mocked(updateReminder)
const saveContext = vi.mocked(saveReminderContext), saveQuiet = vi.mocked(saveReminderQuietHours)
const initial = (): ReminderState => ({ reminders: [], context: { temperature: null, weatherObservedAt: null, mood: 'unknown', moodObservedAt: null }, quietHours: { enabled: true, start: 1320, end: 480 } })
const input = { title: '喝水', kind: 'water' as const, enabled: true, scheduledAt: '2025-02-01T12:10:00.000Z', repeatMinutes: null, temperatureBelow: null, station: '', exit: '', leadMinutes: 0 }
const reminder: Reminder = { ...input, id: 'test-reminder', status: 'pending', deliveredAt: null, snoozedUntil: null, createdAt: '2025-02-01T12:00:00.000Z' }
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (failure: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function visible(value: 'visible' | 'hidden') {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(value)
}
async function settle() {
  await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })
}
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); visible('visible')
  load.mockResolvedValue(initial()); evaluate.mockResolvedValue([])
  add.mockResolvedValue(reminder); update.mockResolvedValue(undefined)
  saveContext.mockResolvedValue(undefined); saveQuiet.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('reminder hook lifecycle and local scheduler', () => {
  it('does not load, evaluate or mutate while disabled, even after explicit actions/events', async () => {
    const hook = renderHook(() => useSmartReminders(false))
    await act(async () => {
      expect(await hook.result.current.add(input)).toBe(false)
      expect(await hook.result.current.act(reminder.id, 'delete')).toBe(false)
      expect(await hook.result.current.context(initial().context)).toBe(false)
      expect(await hook.result.current.quiet(initial().quietHours)).toBe(false)
      await hook.result.current.refresh()
      window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(load).not.toHaveBeenCalled(); expect(evaluate).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled()
    expect(saveContext).not.toHaveBeenCalled(); expect(saveQuiet).not.toHaveBeenCalled()
    expect(hook.result.current).toMatchObject({ state: null, busy: false, error: '', due: [] })
    hook.unmount(); expect(vi.getTimerCount()).toBe(0)
  })
  it('loads immediately when enabled and polls every15seconds without marking refresh busy', async () => {
    const hook = renderHook(() => useSmartReminders(true)); await settle()
    expect(evaluate).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledTimes(1)
    expect(hook.result.current.state).toEqual(initial()); expect(hook.result.current.busy).toBe(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(14_999) })
    expect(evaluate).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(evaluate).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(evaluate).toHaveBeenCalledTimes(4)
    hook.unmount(); expect(vi.getTimerCount()).toBe(0)
  })
  it('skips hidden polling/events and refreshes on visible focus/visibility changes', async () => {
    visible('hidden')
    const hook = renderHook(() => useSmartReminders(true)); await settle()
    expect(evaluate).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000)
      window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
      await hook.result.current.refresh()
    })
    expect(evaluate).not.toHaveBeenCalled()
    visible('visible')
    act(() => { document.dispatchEvent(new Event('visibilitychange')) }); await settle()
    expect(evaluate).toHaveBeenCalledTimes(1)
    act(() => { window.dispatchEvent(new Event('focus')) }); await settle()
    expect(evaluate).toHaveBeenCalledTimes(2)
    hook.unmount()
    act(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
    await settle(); expect(evaluate).toHaveBeenCalledTimes(2)
  })
  it('coalesces slow polling/focus while evaluation is in flight and retries after it finishes', async () => {
    const gate = deferred<Reminder[]>()
    evaluate.mockReturnValueOnce(gate.promise)
    const hook = renderHook(() => useSmartReminders(true)); await settle()
    await act(async () => {
      window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(evaluate).toHaveBeenCalledTimes(1); expect(load).not.toHaveBeenCalled()
    await act(async () => { gate.resolve([]); await gate.promise }); await settle()
    expect(load).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(evaluate).toHaveBeenCalledTimes(2)
    expect(hook.result.current.busy).toBe(false)
  })
  it('preserves the last state and reports failed persistence/evaluation, then recovers on retry', async () => {
    const hook = renderHook(() => useSmartReminders(true)); await settle()
    const before = hook.result.current.state
    add.mockRejectedValueOnce(new Error('quota exceeded'))
    await act(async () => { expect(await hook.result.current.add(input)).toBe(false) })
    expect(hook.result.current.error).toBe('quota exceeded')
    expect(hook.result.current.state).toBe(before); expect(hook.result.current.busy).toBe(false)
    expect(evaluate).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledTimes(1)
    evaluate.mockRejectedValueOnce(new Error('delivery write failed'))
    await act(() => hook.result.current.refresh())
    expect(hook.result.current.error).toBe('delivery write failed'); expect(hook.result.current.state).toBe(before)
    const next = { ...initial(), reminders: [{ ...reminder, status: 'due' as const, deliveredAt: '2025-02-01T12:10:00.000Z' }, { ...reminder, id: 'disabled', enabled: false, status: 'due' as const }] }
    load.mockResolvedValue(next)
    await act(() => hook.result.current.refresh())
    expect(hook.result.current.error).toBe(''); expect(hook.result.current.state).toEqual(next)
    expect(hook.result.current.due.map(item => item.id)).toEqual([reminder.id])
  })
  it('tracks concurrent mutation busy state until every write settles', async () => {
    const hook = renderHook(() => useSmartReminders(true)); await settle()
    const first = deferred<Reminder>(), second = deferred<void>()
    add.mockReturnValueOnce(first.promise); update.mockReturnValueOnce(second.promise)
    let adding!: Promise<boolean>, updating!: Promise<boolean>
    act(() => { adding = hook.result.current.add(input); updating = hook.result.current.act(reminder.id, 'toggle') })
    expect(hook.result.current.busy).toBe(true)
    await act(async () => { first.resolve(reminder); await adding })
    expect(hook.result.current.busy).toBe(true)
    await act(async () => { second.resolve(undefined); await updating })
    expect(hook.result.current.busy).toBe(false)
    expect(evaluate).toHaveBeenCalledTimes(3)
  })
  it('pauseAndDrain prevents new operations immediately and waits for a pending mutation without scheduler writes', async () => {
    const hook = renderHook(() => useSmartReminders(true)); await settle()
    const gate = deferred<Reminder>(); add.mockReturnValueOnce(gate.promise)
    let adding!: Promise<boolean>, draining!: Promise<void>, drained = false
    act(() => { adding = hook.result.current.add(input) })
    act(() => { draining = hook.result.current.pauseAndDrain().then(() => { drained = true }) })
    await settle(); expect(drained).toBe(false)
    await act(async () => {
      expect(await hook.result.current.add(input)).toBe(false)
      expect(await hook.result.current.act(reminder.id, 'complete')).toBe(false)
      expect(await hook.result.current.context(initial().context)).toBe(false)
      expect(await hook.result.current.quiet(initial().quietHours)).toBe(false)
      await hook.result.current.refresh()
      window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(45_000)
    })
    expect(add).toHaveBeenCalledTimes(1); expect(update).not.toHaveBeenCalled()
    expect(saveContext).not.toHaveBeenCalled(); expect(saveQuiet).not.toHaveBeenCalled()
    expect(evaluate).toHaveBeenCalledTimes(1)
    await act(async () => { gate.resolve(reminder); await adding; await draining })
    expect(drained).toBe(true); expect(hook.result.current.busy).toBe(false)
    expect(evaluate).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(evaluate).toHaveBeenCalledTimes(1)
  })
  it('drains an already-started evaluation and its rejected write before deletion can proceed', async () => {
    const gate = deferred<Reminder[]>()
    evaluate.mockReturnValueOnce(gate.promise)
    const hook = renderHook(() => useSmartReminders(true)); await settle()
    let draining!: Promise<void>, drained = false
    act(() => { draining = hook.result.current.pauseAndDrain().then(() => { drained = true }) })
    await settle(); expect(drained).toBe(false)
    await act(async () => { gate.reject(new Error('pending write failure')); await draining })
    expect(drained).toBe(true); expect(evaluate).toHaveBeenCalledTimes(1)
    expect(load).not.toHaveBeenCalled(); expect(hook.result.current.error).toBe('')
  })
  it('cleans up on disable/unmount and StrictMode replay leaves a single scheduler', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>
    const hook = renderHook(({ enabled }) => useSmartReminders(enabled), { initialProps: { enabled: true }, wrapper })
    await settle(); expect(vi.getTimerCount()).toBe(1)
    expect(evaluate).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(evaluate).toHaveBeenCalledTimes(2)
    hook.rerender({ enabled: false }); await settle()
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(45_000) })
    expect(evaluate).toHaveBeenCalledTimes(2)
    await act(async () => { expect(await hook.result.current.add(input)).toBe(false) })
    hook.rerender({ enabled: true }); await settle()
    expect(vi.getTimerCount()).toBe(1); expect(evaluate).toHaveBeenCalledTimes(3)
    hook.unmount(); expect(vi.getTimerCount()).toBe(0)
  })
})
