export type SkinRecord = {
  id: string
  date: string
  period: '早' | '晚'
  products: string
  condition: string
  notes: string
  photoIds?: string[]
  [key: string]: unknown
}

export type SkinRoutine = {
  id: 'morning' | 'evening'
  period: '早' | '晚'
  name: string
  steps: { id: string; name: string; product: string }[]
}

export const SKIN_RECORD_KEY = 'aily.ext.skincare'
export const SKIN_PLAN_KEY = 'aily.ext.skincare-plans.v1'

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function realISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Photo references are opaque local keys, never paths, URLs, or data URLs. */
function safePhotoId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
}

/** Legacy text records and extension fields are accepted unchanged. */
export function isSkinRecord(value: unknown): value is SkinRecord {
  if (!object(value)) return false
  return typeof value.id === 'string'
    && realISODate(value.date)
    && (value.period === '早' || value.period === '晚')
    && ['products', 'condition', 'notes'].every(key => typeof value[key] === 'string')
    && (value.photoIds === undefined || (Array.isArray(value.photoIds)
      && value.photoIds.length <= 3 && Array.from(value.photoIds).every(safePhotoId)))
}

export function isSkinRoutine(value: unknown): value is SkinRoutine {
  if (!object(value) || typeof value.name !== 'string' || !value.name.trim()) return false
  if (!((value.id === 'morning' && value.period === '早')
    || (value.id === 'evening' && value.period === '晚'))) return false
  if (!Array.isArray(value.steps) || value.steps.length > 20) return false
  const ids = new Set<string>()
  return Array.from(value.steps).every(step => {
    if (!object(step) || typeof step.id !== 'string' || !step.id.trim()
      || ids.has(step.id) || typeof step.name !== 'string' || !step.name.trim()
      || typeof step.product !== 'string') return false
    ids.add(step.id)
    return true
  })
}

/** Editable examples, not a claim that the user owns any products. */
export const defaultSkinRoutines: SkinRoutine[] = [
  { id: 'morning', period: '早', name: '晨间护肤', steps: [
    { id: 'morning-cleanse', name: '清洁', product: '' },
    { id: 'morning-moisturize', name: '保湿', product: '' },
    { id: 'morning-sunscreen', name: '防晒', product: '' },
  ] },
  { id: 'evening', period: '晚', name: '晚间护肤', steps: [
    { id: 'evening-cleanse', name: '清洁', product: '' },
    { id: 'evening-moisturize', name: '保湿', product: '' },
  ] },
]

export function productCount(routine: SkinRoutine): number {
  return routine.steps.filter(step => typeof step.product === 'string' && step.product.trim().length > 0).length
}

export function hasSkinRoutineRecord(records: readonly SkinRecord[], date: string, period: '早' | '晚'): boolean {
  return records.some(record => record.date === date && record.period === period)
}

export function skinMonth(records: readonly SkinRecord[], month: string): {
  cells: { date: string; inMonth: boolean; morning: boolean; evening: boolean; records: SkinRecord[] }[]
  morningCount: number
  eveningCount: number
  recordDays: number
} {
  if (!/^\d{4}-\d{2}$/.test(month) || !realISODate(`${month}-01`)) {
    throw new RangeError('Expected a real ISO month (YYYY-MM).')
  }
  const first = new Date(`${month}-01T00:00:00.000Z`)
  const next = new Date(first.getTime())
  next.setUTCMonth(next.getUTCMonth() + 1)
  const dayMs = 24 * 60 * 60 * 1000
  const daysInMonth = Math.round((next.getTime() - first.getTime()) / dayMs)
  const mondayOffset = (first.getUTCDay() + 6) % 7
  const cellCount = Math.ceil((mondayOffset + daysInMonth) / 7) * 7
  const start = first.getTime() - mondayOffset * dayMs
  const byDate = new Map<string, SkinRecord[]>()
  for (const record of records) {
    const dayRecords = byDate.get(record.date)
    if (dayRecords) dayRecords.push(record)
    else byDate.set(record.date, [record])
  }
  let morningCount = 0
  let eveningCount = 0
  let recordDays = 0
  const cells = Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(start + index * dayMs).toISOString().split('T')[0]
    const inMonth = date.startsWith(`${month}-`)
    const dayRecords = byDate.get(date) ?? []
    const morning = dayRecords.some(record => record.period === '早')
    const evening = dayRecords.some(record => record.period === '晚')
    if (inMonth) {
      if (morning) morningCount++
      if (evening) eveningCount++
      if (dayRecords.length) recordDays++
    }
    return { date, inMonth, morning, evening, records: dayRecords }
  })
  return { cells, morningCount, eveningCount, recordDays }
}
