import { describe, expect, it } from 'vitest'
import { applyCalendarQuery, InvalidCalendarData } from './appDataCalendar'
import type { AppDataQuery, AppDataResult, AppDataScope } from './appDataTypes'

type Row = AppDataResult['records'][number]
const calendar = { dateField: 'date', yearlyField: 'yearly' }
const row = (id: string, date: string, yearly = false): Row => ({ id, fields: { name: id, date, yearly } })
const query = (today: string): AppDataQuery => ({ text: '最近的纪念日', limit: 20, operation: 'upcoming', today })

describe('generic date-only calendar projection', () => {
  it('finds the actual closest annual date, not the newest original year, retaining source fields', () => {
    const source = [row('newer-but-later', '2025-12-31', true), row('old-but-closest', '1990-11-08', true), row('already-passed', '2026-11-06')]
    const original = structuredClone(source)
    expect(applyCalendarQuery(source, calendar, query('2026-11-07'))).toEqual([
      { id: 'old-but-closest', fields: { name: 'old-but-closest', date: '1990-11-08', yearly: true, nextDate: '2026-11-08', daysUntil: 1 } },
      { id: 'newer-but-later', fields: { name: 'newer-but-later', date: '2025-12-31', yearly: true, nextDate: '2026-12-31', daysUntil: 54 } },
    ])
    expect(source).toEqual(original)
  })
  it('excludes past one-time dates, retains future dates, and counts today as zero with id ties', () => {
    const selected = applyCalendarQuery([row('past', '2026-11-06'), row('future', '2026-11-09'), row('z', '1980-11-07', true), row('a', '2026-11-07')], calendar, query('2026-11-07'))
    expect(selected.map(r => [r.id, r.fields.daysUntil])).toEqual([['a', 0], ['z', 0], ['future', 2]])
  })
  it('moves passed yearly month/day into the next year at year boundaries', () => {
    const selected = applyCalendarQuery([row('jan', '2000-01-01', true), row('dec', '2000-12-31', true)], calendar, query('2026-12-31'))
    expect(selected.map(r => [r.id, r.fields.nextDate, r.fields.daysUntil])).toEqual([['dec', '2026-12-31', 0], ['jan', '2027-01-01', 1]])
  })
  it.each([
    ['2026-02-28', '2028-02-29'],
    ['2028-02-29', '2028-02-29'],
    ['2028-03-01', '2032-02-29'],
    ['2096-03-01', '2104-02-29'],
  ])('Feb 29 from %s recurs on the next legal leap date %s, never Feb 28 or Mar 1', (today, nextDate) => {
    const [selected] = applyCalendarQuery([row('leap', '2000-02-29', true)], calendar, query(today))
    expect(selected.fields.nextDate).toBe(nextDate)
    expect(selected.fields.daysUntil).toBe((Date.parse(`${nextDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  })
  it.each(['2026-03-08', '2026-11-01'])('uses integer UTC days across DST transition %s', today => {
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    expect(applyCalendarQuery([row('next', tomorrow)], calendar, query(today))[0].fields.daysUntil).toBe(1)
  })
  it.each(['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-01', '2026-11-00', '26-11-07', '2026-11-07T00:00:00Z', 'not-a-date'])('rejects invalid persisted dates and today: %s', invalid => {
    expect(() => applyCalendarQuery([row('bad', invalid, true)], calendar, query('2026-11-07'))).toThrow(InvalidCalendarData)
    expect(() => applyCalendarQuery([], calendar, query(invalid))).toThrow(InvalidCalendarData)
  })
  it('rejects missing today, missing date and malformed recurrence flags', () => {
    expect(() => applyCalendarQuery([], calendar, { text: '', limit: 20 })).toThrow(InvalidCalendarData)
    expect(() => applyCalendarQuery([{ id: 'bad', fields: { yearly: false } }], calendar, query('2026-11-07'))).toThrow(InvalidCalendarData)
    expect(() => applyCalendarQuery([{ id: 'bad', fields: { date: '2026-11-07', yearly: 'true' } }], calendar, query('2026-11-07'))).toThrow(InvalidCalendarData)
  })
  it('reuses a future synthetic calendar declaration without app-specific fields or names', () => {
    const futureScope: AppDataScope = { id: 'renewals', name: '续期', english: 'Renewals', fields: ['dueOn', 'annual', 'nextDate', 'daysUntil'], sensitive: false, calendar: { dateField: 'dueOn', yearlyField: 'annual' } }
    const source = [{ id: 'renewal', fields: { dueOn: '2001-01-02', annual: true } }]
    expect(applyCalendarQuery(source, futureScope.calendar!, query('2026-12-31'))).toEqual([{ id: 'renewal', fields: { dueOn: '2001-01-02', annual: true, nextDate: '2027-01-02', daysUntil: 2 } }])
    expect(applyCalendarQuery([{ id: 'appointment', fields: { startsOn: '2027-01-02' } }], { dateField: 'startsOn' }, query('2026-12-31'))[0].fields.daysUntil).toBe(2)
  })
})
