import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { builtinAppDataProviders, initializeAppDataProviders } from './appDataProviders'
import { listAppDataManifests } from './appDataGateway'
import { mediaDb, type LibraryMedia } from './mediaLibrary'
import { laughterDb } from './laughterStorage'
import type { AppDataQuery, AppDataResult } from './appDataTypes'

const supported = builtinAppDataProviders.filter(p => p.manifest.scopes.length)
const unavailableIds = ['app-store', 'divination', 'focus-timer', 'gomoku']
const keys: Record<string, string> = { ledger: 'aily-desktop-ledger', contacts: 'aily-desktop-contacts', diary: 'aily-desktop-diary', 'meal-planner': 'aily.ext.meal.v1', 'skincare-diary': 'aily.ext.skincare', wardrobe: 'aily.ext.wardrobe', anniversary: 'aily.ext.anniversary', 'game-2048': 'aily.ext.2048.score' }
const day = '2026-11-04', instant = `${day}T12:00:00.000Z`
const entry = { id: 'entry', kind: 'expense', cents: 1230, date: day, note: '私人午餐', category: 'food' }
const member = { id: 'm', name: '小林', portion: 1, likes: '鸡蛋', avoids: '辣椒', allergies: '花生' }
const meal = { settings: { members: [member], budget: 40, dishCount: 3, vegetarian: false, pantry: [{ ingredientId: 'rice', quantity: 500, expiresOn: '2026-11-06' }, { ingredientId: 'egg', quantity: 6 }], prices: { rice: 0.02 } }, history: [{ id: 'wash', date: day, memberId: 'm', cookId: 'gone' }] }
const fixtures: Record<string, unknown> = {
  ledger: [entry], contacts: [{ id: 'c', name: '小林', phone: '13800000000', email: 'me@example.invalid', group: '朋友', favorite: true, secret: 'NEVER_OUTPUT', object: { raw: 'NEVER_OUTPUT' } }],
  diary: [{ id: 'd', date: day, text: '正文秘密', mood: 'good' }], 'meal-planner': meal,
  'skincare-diary': [{ id: 's', date: day, period: '晚', products: '精华', condition: '稳定', notes: '保湿' }],
  wardrobe: [{ id: 'w', name: '衬衫', category: '上装', color: '白', season: '四季' }], anniversary: [{ id: 'a', name: '出发', date: day, yearly: true }], 'game-2048': 0,
}
const put = (id: string, data: unknown) => localStorage.setItem(keys[id], JSON.stringify(data))
const getProvider = (id: string) => builtinAppDataProviders.find(p => p.manifest.id === id)!
const read = (id: string, scope?: string, query: Partial<AppDataQuery> = {}, signal = new AbortController().signal) => {
  const provider = getProvider(id)
  return provider.read(scope ?? provider.manifest.scopes[0]?.id ?? 'anything', { text: '', limit: 20, ...query }, signal)
}
const media = (id: string, kind: 'album' | 'music' = 'album'): LibraryMedia => ({ id, kind, name: kind === 'album' ? '旅行照' : '温柔歌', mime: kind === 'album' ? 'image/jpeg' : 'audio/wav', addedAt: instant, favorite: true, collection: '家人', blob: new Blob(['bytes'], { type: kind === 'album' ? 'image/jpeg' : 'audio/wav' }) })
async function seed() {
  for (const [id, data] of Object.entries(fixtures)) put(id, data)
  await mediaDb.items.bulkPut([media('photo'), media('song', 'music')])
  await mediaDb.photoDecisions.bulkPut([{ id: 'library:photo', status: 'pending', updatedAt: instant }, { id: 'native:private-native-id', status: 'keep', updatedAt: instant }])
  await laughterDb.recordings.put({ id: 'laugh', person: '妈妈', name: '晚饭时', createdAt: instant, duration: 12.5, blob: new Blob(['audio'], { type: 'audio/wav' }) })
}
function scalarOnly(result: AppDataResult) {
  for (const row of result.records) for (const field of Object.values(row.fields)) expect(field === null || ['string', 'number', 'boolean'].includes(typeof field)).toBe(true)
  const serialized = JSON.stringify(result)
  for (const forbidden of ['NEVER_OUTPUT', '"blob"', '"sourceId"', '"transcript"', '"raw"']) expect(serialized).not.toContain(forbidden)
}
beforeEach(async () => {
  vi.stubGlobal('Blob', NodeBlob)
  localStorage.clear()
  await mediaDb.items.clear(); await mediaDb.photoDecisions.clear(); await laughterDb.recordings.clear()
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('provider catalog and complete field whitelist', () => {
  it('covers every existing app, separates installation availability, and initializes once', () => {
    expect(builtinAppDataProviders.map(p => p.manifest.id).sort()).toEqual(['ledger', 'contacts', 'diary', 'album', 'music', 'app-store', 'divination', 'meal-planner', 'skincare-diary', 'wardrobe', 'anniversary', 'game-2048', 'laughter-collector', 'photo-organizer', 'focus-timer', 'gomoku'].sort())
    initializeAppDataProviders(); initializeAppDataProviders()
    expect(listAppDataManifests().map(m => m.id).sort()).toEqual(['ledger', 'contacts', 'diary', 'album', 'music', 'app-store', 'divination'].sort())
    for (const id of unavailableIds) expect(getProvider(id).manifest.scopes).toEqual([])
    for (const id of ['album', 'music', 'contacts', 'diary', 'wardrobe', 'anniversary', 'laughter-collector', 'photo-organizer']) for (const scope of getProvider(id).manifest.scopes) expect(scope.sensitive).toBe(true)
  })
  it('whitelists ALL projected record and summary fields for every scope', async () => {
    await seed()
    for (const provider of supported) for (const scope of provider.manifest.scopes) {
      const value = await read(provider.manifest.id, scope.id)
      expect(value.status, `${provider.manifest.id}/${scope.id}`).toBe('ok')
      for (const fields of [...value.records.map(r => r.fields), value.summary]) for (const key of Object.keys(fields)) expect(scope.fields, `${provider.manifest.id}/${scope.id}/${key}`).toContain(key)
      scalarOnly(value)
    }
  })
})
describe('status and read-only handling', () => {
  it.each(supported.map(p => p.manifest.id))('%s missing source returns empty without fabricated defaults', async id => {
    const value = await read(id)
    expect(value.status).toBe('empty'); expect(value.records).toEqual([])
    if (keys[id]) { expect(value.summary).toEqual({}); expect(localStorage.getItem(keys[id])).toBeNull() }
  })
  it.each(builtinAppDataProviders.map(p => p.manifest.id))('%s rejects unsupported scopes without reading storage', async id => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect((await read(id, 'does-not-exist')).status).toBe('unsupported'); expect(spy).not.toHaveBeenCalled()
  })
  it.each(Object.keys(keys))('%s corrupt JSON and wrong structures remain invalid, never repaired', async id => {
    for (const raw of ['{invalid', 'null', '{}', '"not-data"']) {
      localStorage.setItem(keys[id], raw)
      const value = await read(id)
      expect(value.status).toBe('invalid-data'); expect(value.records).toEqual([]); expect(value.summary).toEqual({})
      expect(localStorage.getItem(keys[id])).toBe(raw)
    }
  })
  it.each(Object.keys(keys))('%s reports storage errors unavailable', async id => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    expect((await read(id)).status).toBe('unavailable')
  })
  it.each(supported.map(p => p.manifest.id))('%s supports cancellation without touching sources', async id => {
    const controller = new AbortController(); controller.abort()
    expect((await read(id, undefined, {}, controller.signal)).status).toBe('unavailable')
  })
  it('reports IndexedDB failures unavailable without writes', async () => {
    vi.spyOn(mediaDb.items, 'toArray').mockRejectedValue(new Error('unavailable'))
    vi.spyOn(laughterDb.recordings, 'toArray').mockRejectedValue(new Error('unavailable'))
    for (const id of ['album', 'music', 'laughter-collector', 'photo-organizer']) expect((await read(id)).status).toBe('unavailable')
  })
  it('rejects malformed metadata rather than outputting plausible defaults', async () => {
    await mediaDb.items.put({ ...media('damaged'), favorite: 'yes' as unknown as boolean })
    expect((await read('album')).status).toBe('invalid-data')
    await laughterDb.recordings.put({ id: 'bad', person: 'x', name: 'x', createdAt: instant, duration: -1, blob: new Blob(['x']) })
    expect((await read('laughter-collector')).status).toBe('invalid-data')
    await mediaDb.items.clear()
    await mediaDb.photoDecisions.put({ id: 'library:no-photo', status: 'deleted' as 'pending', updatedAt: instant })
    expect((await read('photo-organizer')).status).toBe('invalid-data')
  })
})
describe('privacy scopes and no historical fiction', () => {
  it('keeps notes, contact details and diary body out of their narrower scopes and search', async () => {
    await seed()
    const ledger = await read('ledger', 'entries'); expect(ledger.records[0].fields).not.toHaveProperty('note')
    expect((await read('ledger', 'totals')).records).toEqual([])
    expect((await read('ledger', 'entries', { search: '私人' })).status).toBe('empty')
    expect((await read('ledger', 'notes', { search: '私人' })).summary.count).toBe(1)
    const contact = await read('contacts', 'directory'); expect(contact.records[0].fields).not.toHaveProperty('phone'); expect(contact.records[0].fields).not.toHaveProperty('email')
    expect((await read('contacts', 'directory', { search: '138000' })).status).toBe('empty')
    expect((await read('contacts', 'details')).records[0].fields.phone).toBe('13800000000')
    expect((await read('diary', 'index')).records[0].fields).not.toHaveProperty('text')
    expect((await read('diary', 'index', { search: '秘密' })).status).toBe('empty')
    expect((await read('diary', 'entries')).records[0].fields.text).toBe('正文秘密')
  })
  it('reads only persisted meal settings, joined pantry and dishwashing, no generated menus', async () => {
    put('meal-planner', meal)
    const pantry = await read('meal-planner', 'pantry')
    expect(pantry.records.find(r => r.fields.ingredientId === 'rice')?.fields).toMatchObject({ name: '大米', quantity: 500, unit: 'g', pricePerUnit: 0.02 })
    expect(pantry.records.find(r => r.fields.ingredientId === 'egg')?.fields).not.toHaveProperty('pricePerUnit')
    expect((await read('meal-planner', 'budget')).records[0].fields).toEqual({ budgetRmb: 40, dishCount: 3, currency: 'CNY' })
    expect((await read('meal-planner', 'members')).records[0].fields).toEqual({ name: '小林', portion: 1 })
    const health = await read('meal-planner', 'member-health'); expect(health.records[0].fields.allergies).toBe('花生'); expect(health.summary.vegetarian).toBe(false)
    expect((await read('meal-planner', 'wash-history')).records[0].fields).toMatchObject({ memberName: '小林', cookName: null })
    expect((await read('meal-planner', 'menus')).status).toBe('unsupported')
    expect(localStorage.getItem(keys['meal-planner'])).toBe(JSON.stringify(meal))
  })
  it('returns score independently from grid and never claims completed games or max tile', async () => {
    localStorage.setItem('aily.ext.2048.grid', '{corrupt-grid')
    expect((await read('game-2048')).status).toBe('empty')
    put('game-2048', 0)
    const value = await read('game-2048'); expect(value.records).toEqual([{ id: 'current', fields: { score: 0 } }]); expect(value.summary).toEqual({ count: 1, snapshotCurrent: true })
    expect((await read('game-2048', 'grid')).status).toBe('unsupported')
  })
  it('photo decisions preserve pending meaning and never fetch native photos', async () => {
    await seed()
    const native = vi.fn(() => { throw new Error('must not invoke') })
    vi.stubGlobal('listPhotos', native); vi.stubGlobal('getPhoto', native); vi.stubGlobal('getUserMedia', native)
    const value = await read('photo-organizer')
    expect(value.summary).toEqual({ count: 2, pendingCount: 1, keepCount: 1 })
    expect(value.records.find(r => r.id === 'library:photo')?.fields).toMatchObject({ name: '旅行照', status: 'pending', source: 'library', size: 5 })
    expect(value.records.find(r => r.id.startsWith('native:'))?.fields).toEqual({ status: 'keep', updatedAt: instant, source: 'native' })
    expect(JSON.stringify(value)).not.toContain('deleted'); expect(native).not.toHaveBeenCalled()
  })
  it('does not read or decode media/audio bytes', async () => {
    await seed()
    const bytes = vi.spyOn(NodeBlob.prototype, 'arrayBuffer').mockRejectedValue(new Error('no binary reads'))
    for (const id of ['album', 'music', 'laughter-collector', 'photo-organizer']) { const value = await read(id); expect(value.status).toBe('ok'); scalarOnly(value) }
    expect(bytes).not.toHaveBeenCalled()
  })
})
describe('strict structures, exact money and complete-range filtering', () => {
  it('rejects impossible dates, invalid optional values, duplicate ids and unsafe cents', async () => {
    const bad: [string, unknown][] = [
      ['ledger', [{ ...entry, cents: Number.MAX_SAFE_INTEGER + 1 }]], ['ledger', [{ ...entry, date: '2026-02-30' }]], ['ledger', [entry, entry]],
      ['contacts', [{ ...(fixtures.contacts as object[])[0], favorite: 'true' }]], ['diary', [{ id: 'd', date: day, text: 'x', mood: 'fabricated' }]],
      ['anniversary', [{ id: 'a', date: '2026-02-30', name: 'x', yearly: true }]], ['game-2048', -1], ['game-2048', 1.5],
      ['meal-planner', { ...meal, settings: { ...meal.settings, pantry: [{ ingredientId: 'unknown', quantity: 1 }] } }],
      ['meal-planner', { ...meal, settings: { ...meal.settings, pantry: [{ ingredientId: 'egg', quantity: 1.5 }] } }],
      ['meal-planner', { ...meal, settings: { ...meal.settings, members: [{ ...member, allergies: null }] } }],
    ]
    for (const [id, data] of bad) { put(id, data); expect((await read(id)).status, id).toBe('invalid-data'); expect(localStorage.getItem(keys[id])).toBe(JSON.stringify(data)) }
  })
  it('uses bigint for exact cent totals, all rows in [from,to), never the default 20', async () => {
    const max = Number.MAX_SAFE_INTEGER
    put('ledger', Array.from({ length: 25 }, (_, i) => ({ ...entry, id: String(i), kind: i === 24 ? 'expense' : 'income', cents: max, date: i === 24 ? '2026-11-05' : day })))
    const value = await read('ledger', 'notes', { from: day, to: '2026-11-05' })
    expect(value.records).toHaveLength(20); expect(value.truncated).toBe(true); expect(value.summary.count).toBe(24)
    expect(value.summary.incomeCents).toBe((BigInt(max) * 24n).toString()); expect(value.summary.expenseCents).toBe('0')
    expect((await read('ledger', 'totals', { from: day, to: '2026-11-06' })).summary.balanceCents).toBe((BigInt(max) * 23n).toString())
    const invalid = await read('ledger', 'totals', { from: '2026-02-30' }); expect(invalid.status).toBe('invalid-data')
  })
  it('does not use natural-language question text as an implicit data filter', async () => {
    await seed()
    const question = '帮我整理本月收支、日记和冰箱库存'
    for (const provider of supported) for (const scope of provider.manifest.scopes) {
      const initial = await read(provider.manifest.id, scope.id)
      const asked = await read(provider.manifest.id, scope.id, { text: question })
      expect(asked.records).toEqual(initial.records); expect(asked.summary).toEqual(initial.summary); expect(asked.status).toBe('ok')
    }
    expect((await read('ledger', 'notes', { text: question, search: '不存在的关键词' })).status).toBe('empty')
  })
  it('marks nondated sources as current snapshots and ignores historical bounds, including pantry expiration', async () => {
    await seed()
    const query = { from: '2020-01-01', to: '2020-02-01' }
    for (const [id, scopes] of [['contacts', ['directory', 'details']], ['wardrobe', ['items']], ['game-2048', ['score']], ['meal-planner', ['pantry', 'budget', 'members', 'member-health']]] as const) {
      for (const scopeId of scopes) {
        const current = await read(id, scopeId)
        const bounded = await read(id, scopeId, query)
        expect(bounded.status).toBe('ok'); expect(bounded.records).toEqual(current.records)
        expect(bounded.summary.snapshotCurrent).toBe(true)
        expect(getProvider(id).manifest.scopes.find(s => s.id === scopeId)?.fields).toContain('snapshotCurrent')
      }
    }
    const pantry = await read('meal-planner', 'pantry', query)
    expect(pantry.records).toHaveLength(2)
    expect(pantry.records.find(r => r.fields.ingredientId === 'rice')?.fields.expiresOn).toBe('2026-11-06')
    expect((await read('meal-planner', 'wash-history', query)).status).toBe('empty')
    expect((await read('anniversary', 'dates', query)).status).toBe('empty')
  })
  it('supports keyword and explicit calendar-date bounds with full summary before truncation', async () => {
    await mediaDb.items.bulkPut(Array.from({ length: 25 }, (_, i) => ({ ...media(String(i)), name: `旅行 ${i}`, addedAt: i === 24 ? '2026-11-05T00:00:00.000Z' : instant })))
    const value = await read('album', 'metadata', { search: '旅行', from: day, to: '2026-11-05', limit: 2 })
    expect(value.records).toHaveLength(2); expect(value.summary).toEqual({ count: 24, totalBytes: 120, favoriteCount: 24 }); expect(value.truncated).toBe(true)
    expect((await read('album', 'metadata', { search: 'missing' })).status).toBe('empty')
  })
})
describe('whole-source revisions', () => {
  it('uses deterministic SHA-256 when available and deterministic full-input fallback without crypto', async () => {
    put('ledger', [entry])
    vi.stubGlobal('crypto', webcrypto)
    const sha = await read('ledger'); expect(sha.revision).toMatch(/^sha256:[a-f0-9]{64}$/); expect((await read('ledger')).revision).toBe(sha.revision)
    vi.stubGlobal('crypto', undefined)
    const fallback = await read('ledger'); expect(fallback.revision).toMatch(/^full:/); expect((await read('ledger')).revision).toBe(fallback.revision)
    put('ledger', [{ ...entry, note: `${'x'.repeat(50000)}A` }]); const a = await read('ledger')
    put('ledger', [{ ...entry, note: `${'x'.repeat(50000)}B` }]); expect((await read('ledger')).revision).not.toBe(a.revision)
  })
  it('detects undisplayed tail changes, hidden fields, deletions and damaged raw changes', async () => {
    const data = Array.from({ length: 30 }, (_, i) => ({ ...entry, id: String(i), note: `note ${i}` }))
    put('ledger', data); const initial = await read('ledger', 'entries', { limit: 1 })
    data[29].note = 'hidden note changed'; put('ledger', data); const hidden = await read('ledger', 'entries', { limit: 1 })
    expect(hidden.records).toEqual(initial.records); expect(hidden.revision).not.toBe(initial.revision)
    data.pop(); put('ledger', data); expect((await read('ledger')).revision).not.toBe(hidden.revision)
    localStorage.setItem(keys.ledger, '{broken-a'); const bad = await read('ledger')
    localStorage.setItem(keys.ledger, '{broken-b'); expect((await read('ledger')).revision).not.toBe(bad.revision)
  })
  it('fingerprints unknown persisted metadata in full without passing it through', async () => {
    put('contacts', [{ ...(fixtures.contacts as object[])[0], extra: { size: 3, type: 'not-a-blob', tail: 'a' } }])
    const initial = await read('contacts', 'directory')
    put('contacts', [{ ...(fixtures.contacts as object[])[0], extra: { size: 3, type: 'not-a-blob', tail: 'b' } }])
    const changed = await read('contacts', 'directory')
    expect(changed.records).toEqual(initial.records); expect(changed.revision).not.toBe(initial.revision)
    localStorage.removeItem(keys.contacts)
    const removed = await read('contacts', 'directory'); expect(removed.status).toBe('empty'); expect(removed.revision).not.toBe(changed.revision)
  })
  it('invalidates every meal scope when any persisted health/history source changes', async () => {
    put('meal-planner', meal); const initial = await read('meal-planner', 'budget')
    put('meal-planner', { ...meal, settings: { ...meal.settings, members: [{ ...member, allergies: '牛奶' }] } })
    const changed = await read('meal-planner', 'budget'); expect(changed.records).toEqual(initial.records); expect(changed.revision).not.toBe(initial.revision)
  })
  it('uses all media/decision metadata, not just returned rows or selected kind', async () => {
    await seed(); const album = await read('album'); const organizer = await read('photo-organizer'); const laugh = await read('laughter-collector')
    await mediaDb.items.update('song', { collection: '改了分组' }); expect((await read('album')).revision).not.toBe(album.revision)
    await mediaDb.items.update('photo', { name: '新照片名' }); expect((await read('photo-organizer')).revision).not.toBe(organizer.revision)
    await laughterDb.recordings.delete('laugh'); const deleted = await read('laughter-collector'); expect(deleted.status).toBe('empty'); expect(deleted.revision).not.toBe(laugh.revision)
  })
})
