import { describe, expect, it } from 'vitest'
import type { Reminder, ReminderState } from './smartReminders'
import { planReminderNotifications } from './localNotificationPlan'

const minute = 60_000
const now = new Date(2025, 1, 1, 12, 0)
const at = (minutes: number) => new Date(now.getTime() + minutes * minute)
function reminder(patch: Partial<Reminder> = {}): Reminder {
  return { id: 'r', title: 'Private title', kind: 'water', enabled: true,
    scheduledAt: at(10).toISOString(), repeatMinutes: null, temperatureBelow: null,
    station: '', exit: '', leadMinutes: 0, status: 'pending', deliveredAt: null,
    snoozedUntil: null, createdAt: at(-60).toISOString(), ...patch }
}
function state(reminders: Reminder[], patch: Partial<ReminderState> = {}): ReminderState {
  return { reminders, context: { temperature: 5, weatherObservedAt: now.toISOString(), mood: 'low', moodObservedAt: now.toISOString() },
    quietHours: { enabled: false, start: 22 * 60, end: 8 * 60 }, ...patch }
}
function plan(value: ReminderState, patch: Partial<Parameters<typeof planReminderNotifications>[1]> = {}) {
  return planReminderNotifications(value, { now, locale: 'en', showDetails: false, ...patch })
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

describe('pure occurrence notification planner', () => {
  it('schedules each time kind at its current occurrence, without manufacturing repeat slots', () => {
    const input = state(['water', 'meal', 'plan', 'metro'].map(kind => reminder({ id: kind, kind: kind as Reminder['kind'], repeatMinutes: 1, leadMinutes: 5 })))
    const result = plan(input)
    expect(result.notifications.map(item => [item.reminderId, item.at])).toEqual([
      ['metro', at(5)], ['meal', at(10)], ['plan', at(10)], ['water', at(10)],
    ])
    expect(result).toMatchObject({ deferredCount: 0, contextOnlyCount: 0, quietSkippedCount: 0 })
    expect(plan(input, { now: at(100) }).notifications).toHaveLength(4)
    expect(plan(input, { now: at(100) }).notifications.every(item => item.at.getTime() === at(100).getTime() + 1000)).toBe(true)
  })
  it('uses now+1s for overdue/exact timers and current due status, ignoring backlog and future schedules on due timers', () => {
    const result = plan(state([
      reminder({ id: 'old', scheduledAt: at(-30).toISOString(), repeatMinutes: 1 }),
      reminder({ id: 'exact', scheduledAt: now.toISOString() }),
      reminder({ id: 'due', status: 'due', deliveredAt: now.toISOString(), scheduledAt: at(60).toISOString() }),
    ]))
    expect(result.notifications.map(item => item.at.getTime())).toEqual(Array(3).fill(now.getTime() + 1000))
  })
  it('preserves future timestamps less than one second away rather than treating them as overdue', () => {
    const soon = new Date(now.getTime() + 500)
    expect(plan(state([reminder({ scheduledAt: soon.toISOString() })])).notifications[0].at).toEqual(soon)
    expect(plan(state([reminder({ snoozedUntil: soon.toISOString() })])).notifications[0].at).toEqual(soon)
  })
  it('skips completed and disabled occurrences without counting them', () => {
    expect(plan(state([reminder({ status: 'completed' }), reminder({ id: 'disabled', enabled: false }), reminder({ id: 'context', enabled: false, kind: 'mood' })]))).toEqual({ notifications: [], deferredCount: 0, contextOnlyCount: 0, quietSkippedCount: 0 })
  })
  it('never mutates deeply frozen state or the supplied clock and returns detached objects', () => {
    const value = freeze(state([reminder()]))
    const snapshot = JSON.stringify(value), clock = now.getTime()
    const result = plan(value)
    result.notifications[0].occurrence.createdAt = 'changed'
    result.notifications[0].at.setFullYear(2030)
    expect(JSON.stringify(value)).toBe(snapshot)
    expect(now.getTime()).toBe(clock)
    expect(plan(value).notifications[0].at).toEqual(at(10))
  })
  it('token uses only ID and occurrence fields, unchanged by clocks/details/delivery/repeat/quiet inputs', () => {
    const current = reminder()
    const initial = plan(state([current])).notifications[0]
    expect(JSON.parse(initial.token)).toEqual({ reminderId: current.id, occurrence: { createdAt: current.createdAt, scheduledAt: current.scheduledAt, snoozedUntil: null } })
    const changed = plan(state([{ ...current, title: 'New title', repeatMinutes: 5, deliveredAt: now.toISOString(), status: 'due' }], { quietHours: { enabled: true, start: 0, end: 13 * 60 } }), { now: at(20), locale: 'zh-CN', showDetails: true }).notifications[0]
    expect(changed.token).toBe(initial.token)
    for (const patch of [{ id: 'new' }, { createdAt: at(-30).toISOString() }, { scheduledAt: at(20).toISOString() }, { snoozedUntil: at(20).toISOString() }]) {
      expect(plan(state([reminder(patch)])).notifications[0].token).not.toBe(initial.token)
    }
  })
  it('completion-rearmed state has one next occurrence and a new token; planning never advances it itself', () => {
    const due = reminder({ status: 'due', deliveredAt: now.toISOString(), repeatMinutes: 10, scheduledAt: at(-20).toISOString() })
    const old = plan(state([due])).notifications[0]
    const next = { ...due, status: 'pending' as const, deliveredAt: null, scheduledAt: at(10).toISOString() }
    const result = plan(state([next]))
    expect(result.notifications).toHaveLength(1)
    expect(result.notifications[0].at).toEqual(at(10))
    expect(result.notifications[0].token).not.toBe(old.token)
    expect(plan(state([next]))).toEqual(result)
  })
  it('rejects invalid clocks and capacity rather than silently producing invalid OS dates', () => {
    expect(() => plan(state([]), { now: new Date('invalid') })).toThrow()
    for (const maxCount of [-1, 0.5, Infinity, NaN]) expect(() => plan(state([]), { maxCount })).toThrow()
  })
})

describe('quiet hours in local wall clock', () => {
  const quiet = { enabled: true, start: 22 * 60, end: 8 * 60 }
  const date = (day: number, hour: number, minutes = 0) => new Date(2025, 1, day, hour, minutes)
  function timed(fire: Date, current = date(1, 12), override = quiet) {
    return plan(state([reminder({ scheduledAt: fire.toISOString() })], { quietHours: override }), { now: current })
  }
  it('defers overnight start inclusively, early morning on same day, and excludes end', () => {
    expect(timed(date(1, 22)).notifications[0].at).toEqual(date(2, 8))
    expect(timed(date(2, 7, 59)).notifications[0].at).toEqual(date(2, 8))
    expect(timed(date(2, 8)).notifications[0].at).toEqual(date(2, 8))
    expect(timed(date(1, 21, 59)).notifications[0].at).toEqual(date(1, 21, 59))
    expect(timed(date(1, 22)).deferredCount).toBe(0)
  })
  it('supports same-day quiet and evaluates overdue timers at their actual planned fire date', () => {
    expect(timed(date(1, 9), date(1, 8), { enabled: true, start: 9 * 60, end: 17 * 60 }).notifications[0].at).toEqual(date(1, 17))
    expect(timed(date(1, 17), date(1, 8), { enabled: true, start: 9 * 60, end: 17 * 60 }).notifications[0].at).toEqual(date(1, 17))
    expect(timed(date(1, 21), date(1, 23)).notifications[0].at).toEqual(date(2, 8))
    const boundary = new Date(date(1, 22).getTime() - 500)
    expect(timed(date(1, 21), boundary).notifications[0].at).toEqual(date(2, 8))
  })
  it('equal boundaries mean all day; metro bypasses even all-day quiet; disabled quiet does not skip', () => {
    const input = state([reminder(), reminder({ id: 'metro', kind: 'metro', snoozedUntil: at(20).toISOString() })], { quietHours: { enabled: true, start: 123, end: 123 } })
    expect(plan(input)).toMatchObject({ notifications: [{ reminderId: 'metro', at: at(20) }], quietSkippedCount: 1, deferredCount: 0 })
    expect(plan({ ...input, quietHours: { enabled: false, start: 123, end: 123 } }).notifications).toHaveLength(2)
  })
  it.runIf(Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/New_York')('preserves local end across spring-forward and fall-back rather than adding 24h', () => {
    for (const [month, day, hours] of [[2, 8, 9], [10, 1, 11]]) {
      const current = new Date(2025, month, day, 12)
      const fire = new Date(2025, month, day, 22)
      const nextEnd = new Date(2025, month, day + 1, 8)
      const result = plan(state([reminder({ createdAt: current.toISOString(), scheduledAt: fire.toISOString() })], { quietHours: quiet }), { now: current })
      expect(result.notifications[0].at).toEqual(nextEnd)
      expect((nextEnd.getTime() - fire.getTime()) / (60 * minute)).toBe(hours)
    }
  })
  it.runIf(Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/New_York')('does not schedule a past first-fold end while now is in the second fold', () => {
    const current = new Date('2025-11-02T01:15:00-05:00')
    const result = plan(state([reminder({ scheduledAt: '2025-11-01T22:00:00-04:00' })], { quietHours: { enabled: true, start: 22 * 60, end: 90 } }), { now: current })
    expect(result.notifications[0].at).toEqual(new Date('2025-11-02T01:30:00-05:00'))
  })
})

describe('context signals and explicit snooze', () => {
  const contextual = (kind: 'weather' | 'mood', patch: Partial<Reminder> = {}) => reminder({ id: kind, kind, scheduledAt: null, temperatureBelow: kind === 'weather' ? 10 : null, ...patch })
  it('leaves unsnoozed pending contexts in-app-only even if currently fresh/qualifying or future scheduled', () => {
    const result = plan(state([contextual('weather'), contextual('mood', { scheduledAt: at(10).toISOString() })]))
    expect(result).toEqual({ notifications: [], deferredCount: 0, contextOnlyCount: 2, quietSkippedCount: 0 })
  })
  it('allows due contexts only when their current condition and freshness pass', () => {
    const due = { status: 'due' as const, deliveredAt: now.toISOString() }
    const value = state([contextual('weather', due), contextual('mood', due)])
    expect(plan(value).notifications.map(item => item.at.getTime())).toEqual([now.getTime() + 1000, now.getTime() + 1000])
    for (const context of [
      { ...value.context, temperature: 10, mood: 'okay' as const },
      { temperature: null, weatherObservedAt: null, mood: 'unknown' as const, moodObservedAt: null },
      { ...value.context, weatherObservedAt: at(1).toISOString(), moodObservedAt: at(1).toISOString() },
      { ...value.context, weatherObservedAt: new Date(at(-360).getTime() - 1).toISOString(), moodObservedAt: new Date(at(-120).getTime() - 1).toISOString() },
    ]) expect(plan({ ...value, context })).toMatchObject({ notifications: [], contextOnlyCount: 2 })
    expect(plan({ ...value, context: { ...value.context, weatherObservedAt: at(-360).toISOString(), moodObservedAt: at(-120).toISOString() } }).notifications).toHaveLength(2)
    expect(plan(state([contextual('weather', { ...due, scheduledAt: at(10).toISOString() }), contextual('mood', { ...due, createdAt: at(1).toISOString() })]))).toMatchObject({ notifications: [], contextOnlyCount: 2 })
  })
  it('quiet NOW suppresses qualifying due contexts without future deferral or double counting', () => {
    const value = state([contextual('weather', { status: 'due', deliveredAt: now.toISOString() }), contextual('mood')], { quietHours: { enabled: true, start: 11 * 60, end: 13 * 60 } })
    expect(plan(value)).toEqual({ notifications: [], deferredCount: 0, contextOnlyCount: 1, quietSkippedCount: 1 })
    const end = new Date(2025, 1, 1, 13)
    expect(plan(value, { now: end }).notifications).toHaveLength(1)
  })
  it('checks context quiet NOW rather than carrying a fresh context to a future quiet end', () => {
    const boundary = new Date(2025, 1, 1, 21, 59, 59, 500)
    const value = state([contextual('mood', { status: 'due', deliveredAt: boundary.toISOString() })], { context: { temperature: null, weatherObservedAt: null, mood: 'low', moodObservedAt: boundary.toISOString() }, quietHours: { enabled: true, start: 22 * 60, end: 8 * 60 } })
    expect(plan(value, { now: boundary }).notifications[0].at.getTime()).toBe(boundary.getTime() + 1000)
  })
  it('snoozed contexts ignore stale/absent/changed signals and original future schedules, but honor quiet', () => {
    const value = state([contextual('weather', { snoozedUntil: at(10).toISOString(), scheduledAt: at(100).toISOString() }), contextual('mood', { snoozedUntil: at(-10).toISOString() })], { context: { temperature: null, weatherObservedAt: null, mood: 'unknown', moodObservedAt: null } })
    expect(plan(value).notifications.map(item => [item.reminderId, item.at.getTime()])).toEqual([['mood', now.getTime() + 1000], ['weather', at(10).getTime()]])
    expect(plan(value).contextOnlyCount).toBe(0)
    const quiet = plan({ ...value, quietHours: { enabled: true, start: 0, end: 13 * 60 } })
    expect(quiet.notifications.every(item => item.at.getHours() === 13)).toBe(true)
    expect(quiet.deferredCount).toBe(0)
    expect(plan({ ...value, quietHours: { enabled: true, start: 0, end: 0 } }).quietSkippedCount).toBe(2)
  })
  it('snooze is an exact timestamp override for metro and all timer kinds, never minus lead', () => {
    const result = plan(state(['water', 'meal', 'plan', 'metro'].map(kind => reminder({ id: kind, kind: kind as Reminder['kind'], scheduledAt: at(100).toISOString(), leadMinutes: 30, snoozedUntil: at(10).toISOString() }))))
    expect(result.notifications.every(item => item.at.getTime() === at(10).getTime())).toBe(true)
  })
})

describe('privacy, journey wording and capacity', () => {
  it('private English/Chinese defaults do not expose user title, station, exit, mood or temperature', () => {
    const value = state([reminder({ kind: 'metro', title: 'Secret title', station: 'Secret station', exit: 'Secret exit' }), reminder({ id: 'mood', kind: 'mood', snoozedUntil: at(10).toISOString(), title: 'Low mood secret' })])
    for (const [locale, title] of [['en', 'Aily reminder'], ['en-US', 'Aily reminder'], ['zh-CN', 'Aily 提醒']]) {
      const result = plan(value, { locale })
      expect(result.notifications.every(item => item.title === title)).toBe(true)
      expect(result.notifications.map(item => item.title + item.body).join()).not.toMatch(/Secret|Low mood|temperature|5°C|情绪低落/u)
    }
  })
  it('opt-in details use only provided station/exit and require verification, including late arrival disclaimers', () => {
    const value = state([reminder({ kind: 'metro', station: '用户指定车站', exit: '用户指定出口', leadMinutes: 5 })])
    const en = plan(value, { showDetails: true }).notifications[0]
    expect(en.title).toBe('Private title')
    expect(en.body).toContain('用户指定车站')
    expect(en.body).toContain('用户指定出口')
    expect(en.body).toContain('Verify your journey')
    expect(en.body).toContain('does not confirm your actual location')
    expect(en.body).not.toContain('has passed')
    const late = plan(value, { showDetails: true, now: at(20) }).notifications[0]
    expect(late.body).toContain('Estimated arrival time has passed')
    const zh = plan(value, { showDetails: true, locale: 'zh-CN', now: at(20) }).notifications[0]
    expect(zh.body).toContain('预计到达时间已过')
    expect(zh.body).toContain('核对行程')
    expect(zh.body).toContain('不确认你的实际位置')
    expect(zh.body).not.toMatch(/你已到达|你现在位于/u)
  })
  it('defaults to 60, sorts by nearest fire then ID before cap, and counts only cap overflow', () => {
    const items = Array.from({ length: 65 }, (_, index) => reminder({ id: `r${String(index).padStart(3, '0')}`, scheduledAt: at(index < 5 ? 20 : 10).toISOString() })).reverse()
    const result = plan(state(items))
    expect(result.notifications).toHaveLength(60)
    expect(result.notifications[0].reminderId).toBe('r005')
    expect(result.notifications[59].reminderId).toBe('r064')
    expect(result.deferredCount).toBe(5)
    expect(plan(state(items), { maxCount: 2 }).notifications.map(item => item.reminderId)).toEqual(['r005', 'r006'])
    expect(plan(state(items), { maxCount: 0 })).toMatchObject({ notifications: [], deferredCount: 65 })
    expect(plan(state(items), { maxCount: 100 }).deferredCount).toBe(0)
    expect(items[0].id).toBe('r064')
  })
  it('caps after quiet deferral so unshifted nearer metro wins and counters partition omitted occurrences', () => {
    const value = state([reminder({ id: 'timer', scheduledAt: at(1).toISOString() }), reminder({ id: 'metro', kind: 'metro', scheduledAt: at(2).toISOString() }), reminder({ id: 'context', kind: 'mood', scheduledAt: null })], { quietHours: { enabled: true, start: 0, end: 13 * 60 } })
    expect(plan(value, { maxCount: 1 })).toMatchObject({ notifications: [{ reminderId: 'metro' }], deferredCount: 1, contextOnlyCount: 1, quietSkippedCount: 0 })
  })
})
