import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LedgerEntry } from './LedgerApp'
import { buildLedgerChart, chartRatio, groupLedgerDays } from './ledgerAnalytics'

// Loading analytics must never execute the React app or its storage/UI imports.
vi.mock('./LedgerApp', () => { throw new Error('LedgerApp must remain a type-only import') })

const entry = (id: string, date: string, cents = 100, kind: LedgerEntry['kind'] = 'expense', category?: string): LedgerEntry => ({ id, date, cents, kind, note: id, ...(category === undefined ? {} : { category }) })
const sumPoints = (data: ReturnType<typeof buildLedgerChart>) => data.points.reduce((sum, point) => sum + point.cents, 0n)

afterEach(() => { vi.useRealTimers() })

describe('groupLedgerDays', () => {
  it('sorts dates descending, keeps same-day input order and separates income/expense', () => {
    const entries = [entry('a', '2024-02-02', 123), entry('b', '2024-02-01', 30), entry('c', '2024-02-02', 456, 'income'), entry('d', '2024-02-02', 77)]
    const original = [...entries]
    const days = groupLedgerDays(entries)
    expect(days.map(day => day.date)).toEqual(['2024-02-02', '2024-02-01'])
    expect(days[0]).toEqual({ date: '2024-02-02', entries: [entries[0], entries[2], entries[3]], income: 456n, expense: 200n })
    expect(days[1].income).toBe(0n)
    expect(days[1].expense).toBe(30n)
    expect(days[0].entries[0]).toBe(entries[0])
    expect(entries).toEqual(original)
  })

  it('returns no fabricated records for an empty ledger', () => {
    expect(groupLedgerDays([])).toEqual([])
  })

  it('preserves same-day totals above the maximum safe number', () => {
    const max = Number.MAX_SAFE_INTEGER
    const days = groupLedgerDays([entry('a', '2024-01-01', max), entry('b', '2024-01-01', max), entry('c', '2024-01-01', max, 'income')])
    expect(days[0].expense).toBe(BigInt(max) * 2n)
    expect(days[0].income).toBe(BigInt(max))
  })
})

describe('buildLedgerChart calendar ranges', () => {
  it('fills every leap-February day and restricts values to the selected kind and range', () => {
    const data = buildLedgerChart([
      entry('outside-before', '2024-01-31', 999), entry('first', '2024-02-01', 123),
      entry('last', '2024-02-29', 177), entry('income', '2024-02-01', 700, 'income'), entry('outside-after', '2024-03-01', 999),
    ], 'month', '2024-02', 'expense', '2024-02-12')
    expect(data.start).toBe('2024-02-01')
    expect(data.end).toBe('2024-02-29')
    expect(data.points).toHaveLength(29)
    expect(data.points[0]).toEqual({ key: '2024-02-01', label: '1', cents: 123n })
    expect(data.points[1].cents).toBe(0n)
    expect(data.points[28].cents).toBe(177n)
    expect(data.total).toBe(300n)
    expect(data.average).toBe(10n)
    expect(sumPoints(data)).toBe(data.total)
    const income = buildLedgerChart([entry('income', '2024-02-01', 700, 'income'), entry('expense', '2024-02-01', 100)], 'month', '2024-02', 'income', '2024-02-12')
    expect(income.total).toBe(700n)
  })

  it.each([['2023-02', 28], ['1900-02', 28], ['2000-02', 29], ['2024-04', 30], ['2024-01', 31]])('uses valid calendar day counts for %s', (month, count) => {
    expect(buildLedgerChart([], 'month', month, 'expense', '2024-03-01').points).toHaveLength(count)
  })

  it('ends a current-month week today and includes dates from the previous month', () => {
    const data = buildLedgerChart([
      entry('too-old', '2024-02-25', 999), entry('start', '2024-02-26', 200, 'expense', 'custom'),
      entry('leap', '2024-02-29', 150), entry('today', '2024-03-03', 50), entry('future', '2024-03-04', 999),
    ], 'week', '2024-03', 'expense', '2024-03-03')
    expect(data.start).toBe('2024-02-26')
    expect(data.end).toBe('2024-03-03')
    expect(data.points.map(point => point.key)).toEqual(['2024-02-26', '2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02', '2024-03-03'])
    expect(data.points[0].label).toBe('2/26')
    expect(data.total).toBe(400n)
    expect(data.average).toBe(57n)
    expect(data.categories.find(category => category.category === 'custom')?.cents).toBe(200n)
  })

  it.each(['2024-02', '2024-12'])('ends a non-current selected month %s on its final date, not today', month => {
    const data = buildLedgerChart([], 'week', month, 'expense', '2024-03-03')
    expect(data.end).toBe(month === '2024-02' ? '2024-02-29' : '2024-12-31')
    expect(data.points).toHaveLength(7)
  })

  it('crosses year boundaries with seven actual calendar days', () => {
    const data = buildLedgerChart([entry('last-year', '2023-12-31', 100)], 'week', '2024-01', 'expense', '2024-01-02')
    expect(data.start).toBe('2023-12-27')
    expect(data.end).toBe('2024-01-02')
    expect(data.total).toBe(100n)
  })

  it.each(['2024-03-12', '2024-11-05'])('is local-timezone independent across DST near %s', today => {
    const previous = process.env.TZ
    try {
      const results = ['UTC', 'America/New_York', 'Asia/Shanghai', 'Pacific/Auckland'].map(zone => {
        process.env.TZ = zone
        return buildLedgerChart([entry('same-date', today, 100)], 'week', today.slice(0, 7), 'expense', today)
      })
      for (const result of results) {
        expect(result).toEqual(results[0])
        expect(result.points).toHaveLength(7)
        expect(result.end).toBe(today)
      }
      expect(results[0].start).toBe(today === '2024-03-12' ? '2024-03-06' : '2024-10-30')
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  })

  it('defaults today to the local calendar date rather than UTC date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2024, 2, 3, 0, 15))
    expect(buildLedgerChart([], 'week', '2024-03').end).toBe('2024-03-03')
  })

  it('uses twelve month points and the entire selected year even for a mid-year month', () => {
    const data = buildLedgerChart([
      entry('outside', '2023-12-31', 999), entry('jan', '2024-01-01', 100), entry('feb', '2024-02-29', 166),
      entry('dec', '2024-12-31', 100), entry('next', '2025-01-01', 999), entry('income', '2024-06-01', 999, 'income'),
    ], 'year', '2024-06', 'expense', '2024-06-02')
    expect(data.start).toBe('2024-01-01')
    expect(data.end).toBe('2024-12-31')
    expect(data.points).toHaveLength(12)
    expect(data.points[0]).toEqual({ key: '2024-01', label: '1', cents: 100n })
    expect(data.points[1].cents).toBe(166n)
    expect(data.points[5].cents).toBe(0n)
    expect(data.points[11].cents).toBe(100n)
    expect(data.total).toBe(366n)
    expect(data.average).toBe(1n)
    expect(buildLedgerChart([entry('year', '2023-12-31', 365)], 'year', '2023-06', 'expense', '2024-01-01').average).toBe(1n)
  })
})

describe('chart categories and exact money', () => {
  it('retains custom IDs and empty categories, sorts ties by raw ID, and counts only matching entries', () => {
    const data = buildLedgerChart([
      entry('z', '2024-02-01', 100, 'expense', 'z-custom'), entry('a', '2024-02-02', 100, 'expense', 'a-custom'),
      entry('missing', '2024-02-03', 50), entry('empty', '2024-02-04', 50, 'expense', ''),
      entry('custom', '2024-02-05', 300, 'expense', '我的分类'), entry('income', '2024-02-01', 999, 'income', 'salary'),
      entry('outside', '2024-01-31', 999, 'expense', 'outside'),
    ], 'month', '2024-02', 'expense', '2024-02-12')
    expect(data.categories).toEqual([
      { category: '我的分类', cents: 300n, count: 1, percent: 50 },
      { category: '', cents: 100n, count: 2, percent: 16.7 },
      { category: 'a-custom', cents: 100n, count: 1, percent: 16.7 },
      { category: 'z-custom', cents: 100n, count: 1, percent: 16.7 },
    ])
    expect(data.categories.reduce((sum, category) => sum + category.cents, 0n)).toBe(data.total)
  })

  it('adds safe entry values without any loss above MAX_SAFE_INTEGER', () => {
    const max = Number.MAX_SAFE_INTEGER
    const data = buildLedgerChart([entry('a', '2024-01-01', max, 'expense', 'a'), entry('b', '2024-01-01', max, 'expense', 'a'), entry('c', '2024-01-02', max, 'expense', 'b')], 'month', '2024-01', 'expense', '2024-01-02')
    expect(data.total).toBe(BigInt(max) * 3n)
    expect(data.points[0].cents).toBe(BigInt(max) * 2n)
    expect(data.average).toBe(BigInt(max) * 3n / 31n)
    expect(data.categories.map(category => category.percent)).toEqual([66.7, 33.3])
    expect(sumPoints(data)).toBe(data.total)
  })

  it.each(['week', 'month', 'year'] as const)('returns normalized zero-filled empty %s charts and no seeded categories', range => {
    const data = buildLedgerChart([], range, '2024-02', 'expense', '2024-02-10')
    expect(data.total).toBe(0n)
    expect(data.average).toBe(0n)
    expect(data.categories).toEqual([])
    expect(data.points.every(point => point.cents === 0n && chartRatio(point.cents, data.total) === 0)).toBe(true)
  })
})

describe('chartRatio', () => {
  it('scales in bigint before conversion even for arbitrarily large values', () => {
    const enormous = 10n ** 500n
    expect(chartRatio(enormous, enormous * 3n)).toBe(0.3333)
    expect(chartRatio(enormous * 2n, enormous)).toBe(1)
    expect(chartRatio(enormous, enormous)).toBe(1)
    expect(chartRatio(1n, enormous)).toBe(0)
    expect(chartRatio(0n, 0n)).toBe(0)
    expect(chartRatio(1n, 0n)).toBe(0)
    expect(chartRatio(-1n, 100n)).toBe(0)
    expect(chartRatio(1n, -100n)).toBe(0)
  })

  it('rejects runtime number operands', () => {
    expect(() => chartRatio(1 as unknown as bigint, 2n)).toThrow(/bigint/)
  })
})

describe('helpful input validation', () => {
  it.each(['2024-2', '2024-00', '2024-13', '', '24-02'])('rejects invalid month %j', month => {
    expect(() => buildLedgerChart([], 'month', month)).toThrow(/month.*YYYY-MM/)
  })

  it.each(['2023-02-29', '2024-02-30', '2024-04-31', '2024-00-01', '2024-12-00', '2024-1-01', '2024-01-01T00:00:00Z'])('rejects invalid entry and today dates %j', date => {
    expect(() => groupLedgerDays([entry('bad-date', date)])).toThrow(/entries\[0\].date/)
    expect(() => buildLedgerChart([], 'month', '2024-01', 'expense', date)).toThrow(/today/)
  })

  it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])('rejects non-positive or unsafe cents %s even outside selected range', cents => {
    const entries = [entry('bad', '2023-01-01', cents)]
    expect(() => groupLedgerDays(entries)).toThrow(/cents.*positive safe integer/)
    expect(() => buildLedgerChart(entries, 'month', '2024-01')).toThrow(/cents.*positive safe integer/)
  })

  it('rejects invalid record shape, categories, range and kind', () => {
    expect(() => groupLedgerDays(null as unknown as LedgerEntry[])).toThrow(/entries.*array/)
    expect(() => groupLedgerDays([null as unknown as LedgerEntry])).toThrow(/entries\[0\]/)
    expect(() => groupLedgerDays([{ ...entry('bad', '2024-01-01'), note: 2 } as unknown as LedgerEntry])).toThrow(/string id and note/)
    expect(() => groupLedgerDays([{ ...entry('bad', '2024-01-01'), kind: 'other' } as unknown as LedgerEntry])).toThrow(/kind/)
    expect(() => groupLedgerDays([{ ...entry('bad', '2024-01-01'), category: null } as unknown as LedgerEntry])).toThrow(/category.*string/)
    expect(() => buildLedgerChart([], 'day' as 'week', '2024-01')).toThrow(/range/)
    expect(() => buildLedgerChart([], 'month', '2024-01', 'all' as 'income')).toThrow(/kind/)
    expect(() => buildLedgerChart([], 'week', '0000-01', 'expense', '0000-01-01')).toThrow(/week starts before/)
  })
})
