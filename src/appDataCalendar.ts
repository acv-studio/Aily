import type { AppDataQuery, AppDataResult, AppDataScope } from './appDataTypes'

type Row = AppDataResult['records'][number]
type Calendar = NonNullable<AppDataScope['calendar']>
const millisecondsPerDay = 86_400_000

/** A malformed calendar input is data corruption, not a missing/upcoming event. */
export class InvalidCalendarData extends Error {}

function dayNumber(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InvalidCalendarData('Expected YYYY-MM-DD')
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== value) throw new InvalidCalendarData('Invalid calendar date')
  return milliseconds / millisecondsPerDay
}

/**
 * Project the next occurrence for any declared calendar scope, before pagination.
 * Dates are UTC integer days (never local midnights), so DST cannot alter daysUntil.
 * Annual Feb 29 repeats only in a valid leap year; the original date is preserved.
 * Callers apply search/range bounds to nextDate, not the persisted historical date.
 */
export function applyCalendarQuery(rows: readonly Row[], calendar: Calendar, query: AppDataQuery): Row[] {
  const today = dayNumber(query.today)
  const todayYear = Number(query.today!.slice(0, 4))
  const upcoming: Row[] = []
  for (const row of rows) {
    const original = row.fields[calendar.dateField]
    let nextDay = dayNumber(original)
    let nextDate = original as string
    const yearly = calendar.yearlyField ? row.fields[calendar.yearlyField] : false
    if (typeof yearly !== 'boolean') throw new InvalidCalendarData('Invalid yearly flag')
    if (yearly) {
      const monthDay = nextDate.slice(5)
      let found = false
      // Even across a non-leap century, the next legal leap day is at most 8 years away.
      for (let year = todayYear; year <= Math.min(todayYear + 8, 9999); year++) {
        const candidate = `${String(year).padStart(4, '0')}-${monthDay}`
        let candidateDay: number
        try { candidateDay = dayNumber(candidate) } catch { continue }
        if (candidateDay >= today) {
          nextDate = candidate
          nextDay = candidateDay
          found = true
          break
        }
      }
      if (!found) throw new InvalidCalendarData('No representable next occurrence')
    }
    if (nextDay < today) continue
    upcoming.push({ id: row.id, fields: { ...row.fields, nextDate, daysUntil: nextDay - today } })
  }
  return upcoming.sort((a, b) => String(a.fields.nextDate).localeCompare(String(b.fields.nextDate)) || a.id.localeCompare(b.id))
}
