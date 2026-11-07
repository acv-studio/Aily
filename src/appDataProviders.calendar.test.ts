import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { builtinAppDataProviders } from './appDataProviders'
import { mediaDb, type LibraryMedia } from './mediaLibrary'
import type { AppDataQuery } from './appDataTypes'

const getProvider = (id: string) => builtinAppDataProviders.find(p => p.manifest.id === id)!
const read = (id: string, scope: string, query: Partial<AppDataQuery> = {}) => getProvider(id).read(scope, { text: '', limit: 20, ...query }, new AbortController().signal)
const upcoming: Partial<AppDataQuery> = { operation: 'upcoming', today: '2026-11-07' }
const putDates = (dates: unknown) => localStorage.setItem('aily.ext.anniversary', JSON.stringify(dates))
const savedDate = (id: string, date: string, yearly = true, name = id) => ({ id, date, yearly, name, privateExtra: 'NEVER_OUTPUT' })
const media = (id: string, kind: 'album' | 'music', addedAt = '2026-11-07T12:00:00Z'): LibraryMedia => ({ id, kind, name: '旅行', mime: kind === 'album' ? 'image/jpeg' : 'audio/wav', addedAt, favorite: true, collection: '导入', blob: new Blob(['bytes'], { type: kind === 'album' ? 'image/jpeg' : 'audio/wav' }) })

beforeEach(async () => {
  vi.stubGlobal('Blob', NodeBlob)
  localStorage.clear()
  await mediaDb.items.clear()
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('calendar and operation provider integration', () => {
  it('computes the actual closest persisted annual date across ALL source rows before limiting', async () => {
    const source = Array.from({ length: 25 }, (_, i) => savedDate(`later-${i}`, '2025-12-31'))
    source.push(savedDate('closest-in-source-tail', '1990-11-08'))
    putDates(source)
    const value = await read('anniversary', 'dates', { ...upcoming, limit: 1 })
    expect(value.status).toBe('ok')
    expect(value.summary.count).toBe(26)
    expect(value.truncated).toBe(true)
    expect(value.records).toEqual([{ id: 'closest-in-source-tail', fields: { name: 'closest-in-source-tail', date: '1990-11-08', yearly: true, nextDate: '2026-11-08', daysUntil: 1 } }])
    expect(localStorage.getItem('aily.ext.anniversary')).toBe(JSON.stringify(source))
  })
  it('filters upcoming [from,to) on nextDate, not original date, and includes today zero', async () => {
    putDates([savedDate('old-annual-today', '1990-11-07'), savedDate('old-annual-tomorrow', '1990-11-08'), savedDate('one-time-past', '2026-11-06', false), savedDate('one-time-future', '2026-11-09', false)])
    const today = await read('anniversary', 'dates', { ...upcoming, from: '2026-11-07', to: '2026-11-08' })
    expect(today.records.map(r => [r.id, r.fields.nextDate, r.fields.daysUntil])).toEqual([['old-annual-today', '2026-11-07', 0]])
    const all = await read('anniversary', 'dates', upcoming)
    expect(all.records.map(r => r.id)).toEqual(['old-annual-today', 'old-annual-tomorrow', 'one-time-future'])
    expect(all.summary.count).toBe(3)
    const filtered = await read('anniversary', 'dates', { ...upcoming, search: 'tomorrow', from: '2026-11-08', to: '2026-11-09' })
    expect(filtered.records.map(r => r.id)).toEqual(['old-annual-tomorrow'])
  })
  it('projects Feb 29 and year boundaries through the provider', async () => {
    putDates([savedDate('leap', '2000-02-29'), savedDate('jan', '2000-01-01')])
    const value = await read('anniversary', 'dates', { operation: 'upcoming', today: '2026-12-31' })
    expect(value.records.map(r => [r.id, r.fields.nextDate])).toEqual([['jan', '2027-01-01'], ['leap', '2028-02-29']])
  })
  it('reports invalid-data for corrupt persisted dates, malformed today and missing today', async () => {
    putDates([savedDate('bad', '2026-02-29')])
    expect((await read('anniversary', 'dates', upcoming)).status).toBe('invalid-data')
    putDates([savedDate('valid', '2000-11-07')])
    for (const today of ['2026-02-30', '2026-11-07T00:00:00Z', undefined]) {
      const value = await read('anniversary', 'dates', { operation: 'upcoming', today })
      expect(value.status).toBe('invalid-data')
      expect(value.records).toEqual([])
    }
    putDates([])
    expect((await read('anniversary', 'dates', { operation: 'upcoming', today: '2026-02-30' })).status).toBe('invalid-data')
  })
  it('keeps whitelist strict for computed fields, summaries, and operations', async () => {
    putDates([savedDate('actual', '1990-11-08')])
    const scope = getProvider('anniversary').manifest.scopes[0]
    expect(scope.calendar).toEqual({ dateField: 'date', yearlyField: 'yearly' })
    expect(scope.countLabel).toEqual({ zh: '已保存纪念日', en: 'saved anniversaries' })
    for (const query of [upcoming, { operation: 'count' } as Partial<AppDataQuery>, { operation: 'list' } as Partial<AppDataQuery>]) {
      const value = await read('anniversary', 'dates', query)
      for (const fields of [...value.records.map(r => r.fields), value.summary]) for (const key of Object.keys(fields)) expect(scope.fields).toContain(key)
      expect(JSON.stringify(value)).not.toContain('NEVER_OUTPUT')
      expect(JSON.stringify(value)).not.toContain('privateExtra')
    }
  })
  it('counts the complete matched range without records or fake pagination even beyond 200', async () => {
    putDates(Array.from({ length: 225 }, (_, i) => savedDate(String(i), i === 224 ? '2026-11-08' : '2026-11-07', false, i < 210 ? '匹配' : '不选')))
    const value = await read('anniversary', 'dates', { operation: 'count', search: '匹配', from: '2026-11-07', to: '2026-11-08', limit: 1 })
    expect(value.status).toBe('ok')
    expect(value.summary.count).toBe(210)
    expect(value.records).toEqual([])
    expect(value.truncated).toBe(false)
    const empty = await read('anniversary', 'dates', { operation: 'count', search: '不存在' })
    expect(empty.status).toBe('empty')
    expect(empty.summary.count).toBe(0)
    expect(empty.records).toEqual([])
    expect(empty.truncated).toBe(false)
  })
  it('preserves ordinary recent log sorting and list behavior', async () => {
    localStorage.setItem('aily-desktop-diary', JSON.stringify([{ id: 'older', date: '2026-11-06', mood: 'good', text: '正文' }, { id: 'newest', date: '2026-11-07', mood: 'good', text: '正文' }]))
    const value = await read('diary', 'index', { operation: 'recent', limit: 1 })
    expect(value.records).toEqual([{ id: 'newest', fields: { date: '2026-11-07', mood: 'good' } }])
    expect(value.summary.count).toBe(2)
    expect(value.truncated).toBe(true)
    putDates([savedDate('old-year', '1990-11-08'), savedDate('new-year', '2025-12-31')])
    expect((await read('anniversary', 'dates', { operation: 'list' })).records.map(r => r.id)).toEqual(['new-year', 'old-year'])
  })
  it('retains complete-source revisions independent of operation and undisplayed date tails', async () => {
    const source = [savedDate('closest', '1990-11-08'), savedDate('tail', '1990-12-31')]
    putDates(source)
    const initial = await read('anniversary', 'dates', { ...upcoming, limit: 1 })
    expect((await read('anniversary', 'dates', { operation: 'count' })).revision).toBe(initial.revision)
    source[1].privateExtra = 'changed-hidden-tail'
    putDates(source)
    const changed = await read('anniversary', 'dates', { ...upcoming, limit: 1 })
    expect(changed.records).toEqual(initial.records)
    expect(changed.revision).not.toBe(initial.revision)
  })
})

describe('media count labels and honest data boundaries', () => {
  it('counts only Aily imported records in the complete matching range, without native/model/byte calls', async () => {
    await mediaDb.items.bulkPut([
      ...Array.from({ length: 25 }, (_, i) => media(`photo-${i}`, 'album')),
      ...Array.from({ length: 23 }, (_, i) => media(`song-${i}`, 'music')),
      media('outside-range', 'album', '2026-11-08T00:00:00Z'),
    ])
    const bytes = vi.spyOn(NodeBlob.prototype, 'arrayBuffer').mockRejectedValue(new Error('forbidden byte reads'))
    const native = vi.fn(() => { throw new Error('forbidden native calls') })
    const fetch = vi.fn(() => { throw new Error('forbidden model/network calls') })
    vi.stubGlobal('listPhotos', native); vi.stubGlobal('getPhoto', native); vi.stubGlobal('fetch', fetch)
    for (const [id, count] of [['album', 25], ['music', 23]] as const) {
      const value = await read(id, 'metadata', { operation: 'count', search: '旅行', from: '2026-11-07', to: '2026-11-08', limit: 1 })
      expect(value.summary).toEqual({ count, totalBytes: count * 5, favoriteCount: count })
      expect(value.records).toEqual([])
      expect(value.truncated).toBe(false)
      const manifest = getProvider(id).manifest
      expect(manifest.scopes[0].countLabel?.zh).toContain('Aily 已导入')
      expect(manifest.scopes[0].countLabel?.en).toContain('imported into Aily')
      expect(manifest.dataBoundary?.zh).toContain(id === 'album' ? '不是系统相册总数' : '不是系统或受保护音乐曲库')
      expect(manifest.dataBoundary?.en).toContain(id === 'album' ? 'not the system photo library' : 'not the system or protected music library')
      for (const key of Object.keys(value.summary)) expect(manifest.scopes[0].fields).toContain(key)
    }
    expect(bytes).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  })
})
