import { describe, expect, it, vi } from 'vitest'
import { characters } from './data'
import { getDailyEvent, localDateKey } from './dailyEvents'
import type { Locale } from './i18n'

const at = (year: number, month: number, day: number, hour = 12, minute = 0) => new Date(year, month - 1, day, hour, minute)
const daily = (date: Date) => getDailyEvent(date, 'lu', 'zh-CN')
const locales: Locale[] = ['zh-CN', 'en']

describe('daily curated events', () => {
  it('rotates through seven themes then repeats without progress or visits', () => {
    const week = Array.from({ length: 7 }, (_, i) => daily(at(2026, 3, 2 + i)))
    expect(new Set(week.map(event => event.id)).size).toBe(7)
    expect(week.every(event => event.kind === 'daily')).toBe(true)
    expect(daily(at(2026, 3, 9)).id).toBe(week[0].id)
    expect(daily(at(2026, 3, 23)).id).toBe(week[0].id)
    // Visiting another date first does not affect the result.
    daily(at(2030, 8, 19))
    expect(daily(at(2026, 3, 2))).toEqual(week[0])
  })

  it('is stable all day, does not mutate the date, and returns detached choices/drafts', () => {
    const date = at(2026, 3, 2, 0)
    const originalTime = date.getTime()
    const event = daily(date)
    expect(daily(at(2026, 3, 2, 23, 59))).toEqual(event)
    expect(date.getTime()).toBe(originalTime)
    const original = daily(date)
    event.choices[0] = 'edited label'
    event.prompts[0] = 'editable user draft'
    expect(daily(date)).toEqual(original)
  })

  it('changes at local midnight, including month/year boundaries, never via ISO UTC dates', () => {
    const late = at(2026, 3, 31, 23, 59)
    const iso = vi.spyOn(late, 'toISOString').mockImplementation(() => { throw new Error('UTC date must not be read') })
    expect(localDateKey(late)).toBe('2026-03-31')
    expect(daily(late).dateKey).toBe('2026-03-31')
    expect(daily(at(2026, 4, 1, 0)).dateKey).toBe('2026-04-01')
    expect(daily(late).id).not.toBe(daily(at(2026, 4, 1, 0)).id)
    expect(localDateKey(at(2026, 12, 31, 23, 59))).toBe('2026-12-31')
    expect(localDateKey(at(2027, 1, 1, 0))).toBe('2027-01-01')
    expect(iso).not.toHaveBeenCalled()
    iso.mockRestore()
  })

  it('uses local fields even when the instant has a different UTC calendar date', () => {
    // With a non-UTC TZ this chooses the edge where local and UTC days differ.
    const offset = at(2026, 3, 2).getTimezoneOffset()
    const edge = at(2026, 3, 2, offset > 0 ? 23 : 0, offset > 0 ? 59 : 0)
    expect(daily(edge)).toEqual(daily(at(2026, 3, 2)))
    expect(localDateKey(edge)).toBe('2026-03-02')
    if (offset !== 0) expect(edge.toISOString().slice(0, 10)).not.toBe(localDateKey(edge))
  })

  it('counts calendar days across DST changes, not elapsed 24-hour periods', () => {
    // US spring and fall transitions; also valid under other device time zones.
    for (const [month, day] of [[3, 8], [11, 1]]) {
      const events = Array.from({ length: 7 }, (_, i) => daily(at(2026, month, day + i)))
      expect(new Set(events.map(event => event.id)).size).toBe(7)
      expect(daily(at(2026, month, day + 7)).id).toBe(events[0].id)
    }
  })

  it('includes leap day as an ordinary rotation day, including Gregorian century rules', () => {
    const dates = [at(2024, 2, 28), at(2024, 2, 29), at(2024, 3, 1)]
    expect(dates.map(localDateKey)).toEqual(['2024-02-28', '2024-02-29', '2024-03-01'])
    expect(new Set(dates.map(date => daily(date).id)).size).toBe(3)
    expect(daily(at(2024, 3, 6)).id).toBe(daily(at(2024, 2, 28)).id)
    expect(localDateKey(at(2000, 2, 29))).toBe('2000-02-29')
    expect(localDateKey(at(2100, 2, 29))).toBe('2100-03-01')
  })

  it.each([
    [1, 1, 'new-year'],
    [2, 14, 'valentine'],
    [10, 31, 'halloween'],
    [12, 25, 'christmas'],
  ] as const)('prioritizes the fixed Gregorian holiday %i/%i across years, roles, and locales', (month, day, id) => {
    for (const year of [2024, 2026, 2027]) {
      for (const character of characters) {
        for (const locale of locales) {
          const event = getDailyEvent(at(year, month, day), character.id, locale)
          expect(event).toMatchObject({ id, kind: 'holiday', dateKey: localDateKey(at(year, month, day)) })
          expect(getDailyEvent(at(year, month, day, 23, 59), character.id, locale)).toEqual(event)
        }
      }
      expect(daily(at(year, month, day - 1)).kind).toBe('daily')
      expect(daily(at(year, month, day + 1)).kind).toBe('daily')
      expect(daily(at(year, month, day + 1)).id).toBe(daily(at(year, month, day + 8)).id)
    }
  })

  it('does not invent lunar holidays or seasonal/weather events', () => {
    // No Spring Festival / Mid-Autumn mapping: these remain ordinary daily themes.
    expect(daily(at(2026, 2, 17)).kind).toBe('daily')
    expect(daily(at(2026, 9, 25)).kind).toBe('daily')
  })

  it('curates complete bilingual copy and distinct personality invitations for every topic', () => {
    const dates = [
      ...Array.from({ length: 7 }, (_, i) => at(2026, 3, 2 + i)),
      at(2026, 1, 1), at(2026, 2, 14), at(2026, 10, 31), at(2026, 12, 25),
    ]
    for (const date of dates) {
      const zh = daily(date)
      const en = getDailyEvent(date, 'lu', 'en')
      expect(en.id).toBe(zh.id)
      expect(en.dateKey).toBe(zh.dateKey)
      expect(en.title).not.toBe(zh.title)
      for (const locale of locales) {
        const events = characters.map(character => getDailyEvent(date, character.id, locale))
        expect(new Set(events.map(event => event.invitation)).size).toBe(characters.length)
        for (const event of events) {
          expect(event.choices).toHaveLength(2)
          expect(event.prompts).toHaveLength(2)
          for (const text of [event.title, event.invitation, ...event.choices, ...event.prompts]) {
            expect(text.trim().length).toBeGreaterThan(0)
            if (locale === 'en') expect(text).not.toMatch(/[\u3400-\u9fff]/u)
            else expect(text).toMatch(/[\u3400-\u9fff]/u)
          }
          expect(event.prompts[0]).not.toBe(event.prompts[1])
          expect(event.id).toBe(zh.id)
        }
      }
    }
  })

  it('handles pre-epoch dates and low years without negative indexes or the year-1900 shortcut', () => {
    expect(daily(at(1969, 3, 2)).title).not.toBe('')
    const early = at(2026, 3, 2)
    early.setFullYear(5)
    expect(localDateKey(early)).toBe('0005-03-02')
    expect(daily(early).kind).toBe('daily')
  })

  it('fails explicitly for Invalid Date and years outside the supported calendar', () => {
    const invalid = new Date(NaN)
    expect(() => localDateKey(invalid)).toThrow(RangeError)
    expect(() => daily(invalid)).toThrow('Invalid Date')
    for (const year of [0, 10000]) {
      const date = at(2026, 3, 2)
      date.setFullYear(year)
      expect(() => daily(date)).toThrow(RangeError)
    }
  })
})
