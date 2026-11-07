import type { LedgerEntry } from './LedgerApp'

export type LedgerDay = { date: string; entries: LedgerEntry[]; income: bigint; expense: bigint }
export type LedgerChartRange = 'week' | 'month' | 'year'
export type LedgerChartPoint = { key: string; label: string; cents: bigint }
export type LedgerCategoryTotal = { category: string; cents: bigint; count: number; percent: number }
export type LedgerChartData = {
  points: LedgerChartPoint[]
  categories: LedgerCategoryTotal[]
  total: bigint
  average: bigint
  start: string
  end: string
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0')
const daysInMonth = (year: number, month: number) => month === 2
  ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
  : ([4, 6, 9, 11].includes(month) ? 30 : 31)

function validateMonth(value: unknown, field = 'month'): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value) || Number(value.slice(5)) < 1 || Number(value.slice(5)) > 12) {
    throw new RangeError(`${field} must be a valid YYYY-MM month`)
  }
}

function validateDate(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`${field} must be a valid YYYY-MM-DD calendar date`)
  }
  validateMonth(value.slice(0, 7), field)
  const day = Number(value.slice(8))
  if (day < 1 || day > daysInMonth(Number(value.slice(0, 4)), Number(value.slice(5, 7)))) {
    throw new RangeError(`${field} must be a valid YYYY-MM-DD calendar date`)
  }
}

function validateEntries(entries: LedgerEntry[]) {
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array of LedgerEntry records')
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    const field = `entries[${index}]`
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || typeof entry.note !== 'string') {
      throw new TypeError(`${field} must be a LedgerEntry with string id and note`)
    }
    if (entry.kind !== 'income' && entry.kind !== 'expense') throw new TypeError(`${field}.kind must be income or expense`)
    if (!Number.isSafeInteger(entry.cents) || entry.cents <= 0) throw new RangeError(`${field}.cents must be a positive safe integer`)
    if (entry.category !== undefined && typeof entry.category !== 'string') throw new TypeError(`${field}.category must be a string when provided`)
    validateDate(entry.date, `${field}.date`)
  }
}

// Only the default anchor consults the local clock. All ISO date arithmetic below
// uses calendar components, never elapsed milliseconds or local midnight dates.
function localToday() {
  const now = new Date()
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function previousDay(date: string) {
  let year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7)), day = Number(date.slice(8))
  if (--day === 0) {
    if (--month === 0) { year--; month = 12 }
    if (year < 0) throw new RangeError('week starts before the supported YYYY-MM-DD calendar range')
    day = daysInMonth(year, month)
  }
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

export function groupLedgerDays(entries: LedgerEntry[]): LedgerDay[] {
  validateEntries(entries)
  const days = new Map<string, LedgerDay>()
  for (const entry of entries) {
    let day = days.get(entry.date)
    if (!day) {
      day = { date: entry.date, entries: [], income: 0n, expense: 0n }
      days.set(entry.date, day)
    }
    day.entries.push(entry)
    day[entry.kind] += BigInt(entry.cents)
  }
  return [...days.values()].sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0)
}

/** Bounded SVG height ratio; only a scaled, safe 0..10000 integer becomes Number. */
export function chartRatio(part: bigint, max: bigint): number {
  if (typeof part !== 'bigint' || typeof max !== 'bigint') throw new TypeError('chartRatio requires bigint part and max')
  if (part <= 0n || max <= 0n) return 0
  if (part >= max) return 1
  return Number(part * 10000n / max) / 10000
}

export function buildLedgerChart(
  entries: LedgerEntry[],
  range: LedgerChartRange,
  month: string,
  kind: 'income' | 'expense' = 'expense',
  today?: string,
): LedgerChartData {
  validateEntries(entries)
  validateMonth(month)
  if (range !== 'week' && range !== 'month' && range !== 'year') throw new TypeError('range must be week, month, or year')
  if (kind !== 'income' && kind !== 'expense') throw new TypeError('kind must be income or expense')
  const anchor = today === undefined ? localToday() : today
  validateDate(anchor, 'today')
  const year = Number(month.slice(0, 4)), selectedMonth = Number(month.slice(5))
  const monthDays = daysInMonth(year, selectedMonth)
  let start: string, end: string, calendarDays: number
  let points: LedgerChartPoint[]
  if (range === 'week') {
    end = anchor.slice(0, 7) === month ? anchor : `${month}-${pad(monthDays)}`
    const dates = [end]
    for (let index = 1; index < 7; index++) dates.unshift(previousDay(dates[0]))
    start = dates[0]
    calendarDays = 7
    points = dates.map(key => ({ key, label: `${Number(key.slice(5, 7))}/${Number(key.slice(8))}`, cents: 0n }))
  } else if (range === 'month') {
    start = `${month}-01`
    end = `${month}-${pad(monthDays)}`
    calendarDays = monthDays
    points = Array.from({ length: monthDays }, (_, index) => ({ key: `${month}-${pad(index + 1)}`, label: String(index + 1), cents: 0n }))
  } else {
    const selectedYear = month.slice(0, 4)
    start = `${selectedYear}-01-01`
    end = `${selectedYear}-12-31`
    calendarDays = daysInMonth(year, 2) === 29 ? 366 : 365
    points = Array.from({ length: 12 }, (_, index) => ({ key: `${selectedYear}-${pad(index + 1)}`, label: String(index + 1), cents: 0n }))
  }
  const pointByKey = new Map(points.map(point => [point.key, point]))
  const categoryById = new Map<string, LedgerCategoryTotal>()
  let total = 0n
  for (const entry of entries) {
    if (entry.kind !== kind || entry.date < start || entry.date > end) continue
    const cents = BigInt(entry.cents)
    total += cents
    const key = range === 'year' ? entry.date.slice(0, 7) : entry.date
    pointByKey.get(key)!.cents += cents
    const category = entry.category ?? ''
    let categoryTotal = categoryById.get(category)
    if (!categoryTotal) {
      categoryTotal = { category, cents: 0n, count: 0, percent: 0 }
      categoryById.set(category, categoryTotal)
    }
    categoryTotal.cents += cents
    categoryTotal.count++
  }
  const categories = [...categoryById.values()].sort((a, b) => a.cents > b.cents ? -1 : a.cents < b.cents ? 1 : a.category < b.category ? -1 : a.category > b.category ? 1 : 0)
  for (const category of categories) {
    // Round to tenths of a percent without converting either monetary amount.
    category.percent = total === 0n ? 0 : Number((category.cents * 1000n + total / 2n) / total) / 10
  }
  return { points, categories, total, average: total / BigInt(calendarDays), start, end }
}
