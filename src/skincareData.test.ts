import { describe, expect, it } from 'vitest'
import { defaultSkinRoutines, hasSkinRoutineRecord, isSkinRecord, isSkinRoutine, productCount, SKIN_PLAN_KEY, SKIN_RECORD_KEY, skinMonth, type SkinRecord } from './skincareData'

const record = (date = '2024-02-29', period: '早' | '晚' = '早', id = 'legacy'): SkinRecord => ({
  id, date, period, products: '', condition: '正常', notes: '',
})

describe('skincare legacy metadata and routines', () => {
  it('keeps storage keys, original text format and arbitrary extra fields unchanged', () => {
    expect(SKIN_RECORD_KEY).toBe('aily.ext.skincare')
    expect(SKIN_PLAN_KEY).toBe('aily.ext.skincare-plans.v1')
    const legacy = { ...record(), products: '洁面、面霜', custom: { tags: ['敏感'] }, extra: null }
    const serialized = JSON.stringify(legacy)
    const parsed: unknown = JSON.parse(serialized)
    expect(isSkinRecord(parsed)).toBe(true)
    expect(JSON.stringify(parsed)).toBe(serialized)
    expect(isSkinRecord({ ...record(), id: '', products: '', condition: '', notes: '' })).toBe(true)
    expect(isSkinRecord({ ...record(), photoIds: ['local_1', 'photo-2', 'abc3'] })).toBe(true)
  })

  it.each(['2023-02-29', '1900-02-29', '2024-02-30', '2024-04-31', '2024-13-01', '2024-00-01', '2024-01-00', '2024-1-01', '2024-02-29T00:00:00Z', 'not-a-date'])('rejects non-real ISO dates: %s', date => {
    expect(isSkinRecord({ ...record(), date })).toBe(false)
  })

  it.each(['2000-02-29', '2024-02-29', '2026-12-31'])('accepts real ISO dates: %s', date => {
    expect(isSkinRecord({ ...record(), date })).toBe(true)
  })

  it.each([null, [], {}, { ...record(), id: 1 }, { ...record(), period: 'morning' }, { ...record(), period: 0 }, { ...record(), products: [] }, { ...record(), condition: null }, { ...record(), notes: false }, { ...record(), photoIds: null }, { ...record(), photoIds: 'photo' }, { ...record(), photoIds: ['a', 'b', 'c', 'd'] }, { ...record(), photoIds: ['../photo'] }, { ...record(), photoIds: ['https://example.test/a.jpg'] }, { ...record(), photoIds: ['data:image/png;base64,AA'] }, { ...record(), photoIds: [''] }, { ...record(), photoIds: new Array(1) }])('rejects malformed records: %j', value => {
    expect(isSkinRecord(value)).toBe(false)
  })

  it('provides two editable example plans with real steps but zero claimed owned products', () => {
    expect(defaultSkinRoutines.map(plan => [plan.id, plan.period])).toEqual([['morning', '早'], ['evening', '晚']])
    expect(defaultSkinRoutines.map(plan => plan.steps.map(step => step.name))).toEqual([['清洁', '保湿', '防晒'], ['清洁', '保湿']])
    expect(defaultSkinRoutines.every(isSkinRoutine)).toBe(true)
    expect(defaultSkinRoutines.map(productCount)).toEqual([0, 0])
    const plan = { ...defaultSkinRoutines[0], steps: defaultSkinRoutines[0].steps.map((step, index) => ({ ...step, product: ['', '  ', '我的防晒'][index] })) }
    expect(plan.steps).toHaveLength(3)
    expect(productCount(plan)).toBe(1)
    expect(defaultSkinRoutines[0].steps.every(step => step.product === '')).toBe(true)
  })

  it('requires matched known routines, unique step IDs and nonempty names, allowing blank products', () => {
    const base = defaultSkinRoutines[0]
    expect(isSkinRoutine({ ...base, steps: [] })).toBe(true)
    expect(isSkinRoutine({ ...base, custom: true })).toBe(true)
    const steps = Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: '步骤', product: '' }))
    expect(isSkinRoutine({ ...base, steps })).toBe(true)
    for (const invalid of [null, [], { ...base, id: 'custom' }, { ...base, period: '晚' }, { ...base, name: ' ' }, { ...base, steps: 'cleanse' }, { ...base, steps: [...steps, { id: '21', name: '步骤', product: '' }] }, { ...base, steps: [base.steps[0], base.steps[0]] }, { ...base, steps: [{ id: '', name: '清洁', product: '' }] }, { ...base, steps: [{ id: 'a', name: ' ', product: '' }] }, { ...base, steps: [{ id: 'a', name: '清洁' }] }, { ...base, steps: [{ id: 'a', name: '清洁', product: null }] }, { ...base, steps: new Array(1) }]) {
      expect(isSkinRoutine(invalid)).toBe(false)
    }
  })
})

describe('pure Monday-first UTC skincare calendar', () => {
  it.each([
    ['2024-02', '2024-01-29', '2024-03-03', 35, 29],
    ['2021-02', '2021-02-01', '2021-02-28', 28, 28],
    ['2026-03', '2026-02-23', '2026-04-05', 42, 31],
    ['2026-12', '2026-11-30', '2027-01-03', 35, 31],
    ['2027-01', '2026-12-28', '2027-01-31', 35, 31],
  ])('builds complete weeks for %s', (month, first, last, length, days) => {
    const result = skinMonth([], month)
    expect(result.cells).toHaveLength(length)
    expect(result.cells[0].date).toBe(first)
    expect(result.cells.at(-1)?.date).toBe(last)
    expect(result.cells.filter(cell => cell.inMonth)).toHaveLength(days)
    expect(new Date(`${first}T00:00:00Z`).getUTCDay()).toBe(1)
    expect(new Date(`${last}T00:00:00Z`).getUTCDay()).toBe(0)
    expect(result).toMatchObject({ morningCount: 0, eveningCount: 0, recordDays: 0 })
  })

  it('counts unique date/period but preserves duplicate rows, extras and adjacent-month records', () => {
    const entries = Object.freeze([
      Object.freeze({ ...record('2024-02-29', '早', 'a'), custom: ['keep'] }),
      Object.freeze(record('2024-02-29', '早', 'a')),
      Object.freeze(record('2024-02-29', '晚', 'b')),
      Object.freeze(record('2024-02-01', '晚', 'c')),
      Object.freeze(record('2024-01-31', '早', 'd')),
      Object.freeze(record('2024-03-01', '晚', 'e')),
    ])
    const before = JSON.stringify(entries)
    const result = skinMonth(entries, '2024-02')
    expect(result).toMatchObject({ morningCount: 1, eveningCount: 2, recordDays: 2 })
    const leap = result.cells.find(cell => cell.date === '2024-02-29')!
    expect(leap).toMatchObject({ inMonth: true, morning: true, evening: true })
    expect(leap.records).toEqual(entries.slice(0, 3))
    expect(leap.records[0]).toBe(entries[0])
    expect(result.cells.find(cell => cell.date === '2024-01-31')).toMatchObject({ inMonth: false, morning: true })
    expect(result.cells.find(cell => cell.date === '2024-03-01')).toMatchObject({ inMonth: false, evening: true })
    leap.records.pop()
    expect(JSON.stringify(entries)).toBe(before)
    expect(skinMonth(entries, '2024-02').cells.find(cell => cell.date === '2024-02-29')?.records).toHaveLength(3)
    expect(hasSkinRoutineRecord(entries, '2024-02-29', '早')).toBe(true)
    expect(hasSkinRoutineRecord(entries, '2024-02-29', '晚')).toBe(true)
    expect(hasSkinRoutineRecord(entries, '2024-02-01', '早')).toBe(false)
    expect(hasSkinRoutineRecord(entries, '2024-03-02', '晚')).toBe(false)
  })

  it.each(['2024-2', '2024-00', '2024-13', '2024-02-01', 'invalid'])('rejects malformed months: %s', month => {
    expect(() => skinMonth([], month)).toThrow(RangeError)
  })
})
