import { describe, expect, it } from 'vitest'
import { parseReminder } from './App'

describe('chat reminder parsing', () => {
  const now = new Date('2026-11-06T14:00:00+08:00')

  it.each([
    ['提醒我2h后喝水', 120, '喝水'],
    ['提醒一下 2 小时后伸展', 120, '伸展'],
    ['设个提醒 15分钟后开会', 15, '开会'],
  ])('creates a relative reminder for %s', (text, minutes, title) => {
    const reminder = parseReminder(text, now)
    expect(reminder).toMatchObject({ title })
    expect(reminder?.at.getTime()).toBe(now.getTime() + minutes * 60_000)
  })

  it('continues to support a clock time', () => {
    expect(parseReminder('提醒我16:30喝水', now)?.at.toISOString()).toBe('2026-11-06T08:30:00.000Z')
  })
})
