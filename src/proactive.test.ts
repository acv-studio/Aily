import { describe, expect, it } from 'vitest'
import {
  claimReminder, createLocalReminder, DEFAULT_PROACTIVE_CONFIG, GENERIC_NOTIFICATION_BODY,
  isReminderDue, isWithinDnd, localClockTime, localDateKey, parseProactiveConfig,
  reminderLedgerKey, validateProactiveConfig,
} from './proactive'

const enabled = { ...DEFAULT_PROACTIVE_CONFIG, enabled: true }
const at = (hour: number, minute = 0, day = 3) => new Date(2026, 10, day, hour, minute)

describe('local proactive scheduling', () => {
  it('defaults off and fails closed for corrupt or invalid persisted config', () => {
    for (const raw of [null, '{broken', '{}', '[]', 'true']) {
      expect(parseProactiveConfig(raw)).toEqual(DEFAULT_PROACTIVE_CONFIG)
    }
    for (const patch of [{ schedule: '24:00' }, { schedule: '9:00' }, { dndStart: '22:60' },
      { enabled: 'true' }, { frequency: 'hourly' }, { kind: 'AI' }, { notifications: 1 }]) {
      expect(validateProactiveConfig({ ...enabled, ...patch }).enabled).toBe(false)
    }
    expect(validateProactiveConfig({ ...enabled, apiKey: 'secret' })).toEqual(enabled)
  })

  it('uses local calendar values and only the scheduled minute, with no catch-up', () => {
    expect(localDateKey(at(9))).toBe('2026-11-03')
    expect(localClockTime(at(9))).toBe('09:00')
    expect(isReminderDue(enabled, at(9), false)).toBe(true)
    expect(isReminderDue(enabled, new Date(2026, 10, 3, 9, 0, 59), false)).toBe(true)
    for (const time of [at(8, 59), at(9, 1), at(21)]) expect(isReminderDue(enabled, time, false)).toBe(false)
    expect(isReminderDue(enabled, at(9), true)).toBe(false)
    expect(isReminderDue(enabled, at(9), false, true)).toBe(false)
    expect(isReminderDue(DEFAULT_PROACTIVE_CONFIG, at(9), false)).toBe(false)
    expect(isReminderDue(enabled, new Date(NaN), false)).toBe(false)
  })

  it('handles midnight DND, boundaries, daytime intervals and all-day DND', () => {
    for (const time of ['22:00', '23:59', '00:00', '07:59']) expect(isWithinDnd(time, '22:00', '08:00')).toBe(true)
    for (const time of ['08:00', '21:59']) expect(isWithinDnd(time, '22:00', '08:00')).toBe(false)
    expect(isWithinDnd('12:00', '11:00', '13:00')).toBe(true)
    expect(isWithinDnd('13:00', '11:00', '13:00')).toBe(false)
    expect(isWithinDnd('12:00', '08:00', '08:00')).toBe(true)
    expect(isWithinDnd('invalid', '08:00', '08:00')).toBe(true)
    expect(isReminderDue({ ...enabled, schedule: '23:00' }, at(23), false)).toBe(false)
    expect(isReminderDue({ ...enabled, schedule: '23:00', dndEnabled: false }, at(23), false)).toBe(true)
  })

  it('claims at most once per local date and character across shared storage', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    expect(claimReminder(storage, at(9), 'lu', 'tab1')).toBe(true)
    expect(claimReminder(storage, at(9), 'lu', 'tab2')).toBe(false)
    expect(claimReminder(storage, at(9), 'chen', 'tab2')).toBe(true)
    expect(claimReminder(storage, at(9, 0, 4), 'lu', 'tab1')).toBe(true)
    expect(reminderLedgerKey(at(9), 'lu')).toContain('2026-11-03:lu')
    expect(claimReminder({ getItem: () => { throw new Error('blocked') }, setItem: () => {} }, at(9), 'gu', 'tab3')).toBe(false)
  })

  it('labels fixed templates as local, non-AI and never quotes sensitive topics', () => {
    const secret = 'My medical diagnosis and password are secret'
    for (const text of [createLocalReminder('greeting', secret), createLocalReminder('followup', secret), createLocalReminder('followup')]) {
      expect(text).toContain('本地定时')
      expect(text).toContain('非 AI 生成')
      expect(text).not.toContain(secret)
    }
    expect(createLocalReminder('followup', secret)).toContain('之前的话题')
    expect(createLocalReminder('followup', '  ')).toContain('有没有想聊的话题')
    expect(GENERIC_NOTIFICATION_BODY).toBe('有一条本地提醒，请在应用内查看。')
  })
})
