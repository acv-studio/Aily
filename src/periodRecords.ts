import { db, saveSetting } from './db'
import { acquireUsageLease } from './privacy'

/** Internal settings are omitted from app state and the existing backup allowlist. */
export const periodRecordsKey = '__periodRecords:v1'
export type PeriodRecord = { startDate: string; endDate?: string; note?: string }
export type PeriodWriteOptions = { temporary?: boolean; canWrite?: () => boolean }
export type PeriodValidationKey = '请选择有效的开始日期。' | '日期不能晚于今天。' | '请选择有效的结束日期。' | '结束日期不能早于开始日期。' | '备注不能超过 200 字。' | '该开始日期已有记录，请勿重复添加。'

export class PeriodRecordError extends Error {
  constructor(public readonly translationKey: string) { super(translationKey) }
}

/** Date-only values use this device's calendar, never UTC truncation or predictions. */
export function periodToday(now = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
export function isPeriodDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function validatePeriodRecord(input: PeriodRecord, records: PeriodRecord[] = [], today = periodToday()): PeriodValidationKey | undefined {
  if (!isPeriodDate(input.startDate)) return '请选择有效的开始日期。'
  if (input.startDate > today) return '日期不能晚于今天。'
  if (input.endDate && !isPeriodDate(input.endDate)) return '请选择有效的结束日期。'
  if (input.endDate && input.endDate > today) return '日期不能晚于今天。'
  if (input.endDate && input.endDate < input.startDate) return '结束日期不能早于开始日期。'
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 200)) return '备注不能超过 200 字。'
  if (records.some(record => record.startDate === input.startDate)) return '该开始日期已有记录，请勿重复添加。'
}
function parseRecords(value: unknown): PeriodRecord[] {
  if (value === undefined) return []
  const fail = () => { throw new PeriodRecordError('无法读取经期记录，请重试；未覆盖已有记录。') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const stored = value as Record<string, unknown>
  if (stored.version !== 1 || !Array.isArray(stored.records) || Object.keys(stored).some(key => !['version', 'records'].includes(key))) return fail()
  const records: PeriodRecord[] = []
  for (const item of stored.records) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return fail()
    const record = item as Record<string, unknown>
    if (Object.keys(record).some(key => !['startDate', 'endDate', 'note'].includes(key)) || !isPeriodDate(record.startDate)
      || (record.endDate !== undefined && (!isPeriodDate(record.endDate) || record.endDate < record.startDate))
      || (record.note !== undefined && (typeof record.note !== 'string' || record.note.length > 200))
      || records.some(existing => existing.startDate === record.startDate)) return fail()
    records.push({ startDate: record.startDate, ...(record.endDate ? { endDate: record.endDate as string } : {}), ...(record.note ? { note: record.note as string } : {}) })
  }
  return records.sort((a, b) => b.startDate.localeCompare(a.startDate))
}
export async function loadPeriodRecords(): Promise<PeriodRecord[]> {
  return parseRecords((await db.settings.get(periodRecordsKey))?.value)
}
function assertWritable(options: PeriodWriteOptions) {
  if (options.temporary || options.canWrite?.() === false) throw new PeriodRecordError('临时会话中仅可查看，不能新增或删除本机经期记录。')
}
/** A write holds a shared lease, so local reset cannot race the transaction. */
async function writeRecords(options: PeriodWriteOptions, work: () => Promise<PeriodRecord[]>): Promise<PeriodRecord[]> {
  assertWritable(options)
  const release = await acquireUsageLease()
  try {
    assertWritable(options)
    return await db.transaction('rw', db.settings, work)
  } finally { await release() }
}
/** Re-read and commit atomically: reopening/stale panels cannot overwrite newer records. */
export async function addPeriodRecord(input: PeriodRecord, options: PeriodWriteOptions = {}): Promise<PeriodRecord[]> {
  assertWritable(options)
  return writeRecords(options, async () => {
    assertWritable(options)
    const records = await loadPeriodRecords()
    assertWritable(options)
    const invalid = validatePeriodRecord(input, records)
    if (invalid) throw new PeriodRecordError(invalid)
    const record: PeriodRecord = { startDate: input.startDate, ...(input.endDate ? { endDate: input.endDate } : {}), ...(input.note?.trim() ? { note: input.note.trim() } : {}) }
    const updated = [record, ...records].sort((a, b) => b.startDate.localeCompare(a.startDate))
    await saveSetting(periodRecordsKey, { version: 1, records: updated })
    return updated
  })
}
export async function deletePeriodRecord(startDate: string, options: PeriodWriteOptions = {}): Promise<PeriodRecord[]> {
  assertWritable(options)
  return writeRecords(options, async () => {
    assertWritable(options)
    const records = await loadPeriodRecords()
    assertWritable(options)
    const updated = records.filter(record => record.startDate !== startDate)
    await saveSetting(periodRecordsKey, { version: 1, records: updated })
    return updated
  })
}
