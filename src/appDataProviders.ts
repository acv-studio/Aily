import type { AppDataProvider, AppDataQuery, AppDataResult, AppDataScope, AppDataValue } from './appDataTypes'
import { registerAppDataProvider } from './appDataGateway'
import { isLedgerEntry } from './LedgerApp'
import { isDiaryEntry } from './DiaryApp'
import { ingredients } from './mealPlanner'
import { mediaDb } from './mediaLibrary'
import { laughterDb } from './laughterStorage'
import { applyCalendarQuery, InvalidCalendarData } from './appDataCalendar'

type ObjectData = Record<string, unknown>
type Fields = Record<string, AppDataValue>
type Row = AppDataResult['records'][number]
type Snapshot = { source: unknown; data: unknown; missing?: boolean }
type Projection = { rows: Row[]; summary?: (rows: Row[]) => Fields; dateField?: string }
class InvalidData extends Error {}
const object = (v: unknown): v is ObjectData => v !== null && typeof v === 'object' && !Array.isArray(v)
const string = (v: unknown): v is string => typeof v === 'string'
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const date = (v: unknown): v is string => string(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
const timestamp = (v: unknown): v is string => string(v) && /^\d{4}-\d{2}-\d{2}T/.test(v) && date(v.slice(0, 10)) && Number.isFinite(Date.parse(v))
const optional = (v: unknown, validator: (v: unknown) => boolean) => v === undefined || validator(v)
const texts = (v: ObjectData, keys: string[]) => keys.every(key => string(v[key]))
function checkedList(v: unknown, validator: (v: unknown) => boolean): ObjectData[] {
  if (!Array.isArray(v) || !v.every(item => object(item) && string(item.id) && !!item.id && validator(item)) || new Set(v.map(item => item.id)).size !== v.length) throw new InvalidData()
  return v as ObjectData[]
}
function pick(item: ObjectData, keys: string[]): Fields {
  const fields: Fields = {}
  for (const key of keys) {
    const value = item[key]
    if (value === null || string(value) || typeof value === 'boolean' || finite(value)) fields[key] = value
  }
  return fields
}
const rows = (items: ObjectData[], keys: string[]): Row[] => items.map(item => ({ id: item.id as string, fields: pick(item, keys) }))
const scope = (id: string, name: string, english: string, fields: string[], sensitive = false): AppDataScope => ({ id, name, english, fields: [...new Set([...fields, 'count'])], sensitive })
const currentScope = (id: string, name: string, english: string, fields: string[], sensitive = false): AppDataScope => scope(id, name, english, [...fields, 'snapshotCurrent'], sensitive)
const result = (status: AppDataResult['status'], revision: string): AppDataResult => ({ status, revision, records: [], summary: {}, truncated: false })

/** Hash EVERY byte, not a preview/prefix. No crypto availability assumption (e.g. webviews).
 * The fallback uses two independent 32-bit streams over the full input. */
async function digest(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
    return `sha256:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`
  }
  let a = 2166136261, b = 0x9e3779b9
  for (const byte of bytes) { a = Math.imul(a ^ byte, 16777619); b = Math.imul(b ^ byte, 0x85ebca6b); b ^= b >>> 13 }
  return `full:${bytes.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`
}
/** Media repositories currently add/delete immutable files, never replace their bytes.
 * Fingerprint the COMPLETE metadata source, including file size/type, without reading
 * potentially hundreds of MB of audio/images. A future same-id binary replacement API
 * must add a persisted repository revision/content digest. Unknown source metadata also
 * affects revision but is NEVER projected into records. */
async function fingerprint(value: unknown): Promise<unknown> {
  if (value && typeof value === 'object' && 'size' in value && 'type' in value && finite(value.size) && string(value.type) && 'slice' in value && typeof value.slice === 'function') {
    return { blobSize: value.size, blobType: value.type }
  }
  if (Array.isArray(value)) return Promise.all(value.map(fingerprint))
  if (object(value)) {
    const entries = await Promise.all(Object.keys(value).sort().map(async key => [key, await fingerprint(value[key])] as const))
    return Object.fromEntries(entries)
  }
  return value
}
async function revision(source: unknown): Promise<string> {
  const text = JSON.stringify(await fingerprint(source))
  return digest(new TextEncoder().encode(text))
}
function local(key: string): () => Promise<Snapshot> {
  return async () => {
    const source = localStorage.getItem(key)
    if (source === null) return { source, data: null, missing: true }
    // Preserve corrupt raw data in revision; JSON errors are not storage unavailability.
    try { return { source, data: JSON.parse(source) } } catch { return { source, data: undefined } }
  }
}
function queryValid(q: AppDataQuery) {
  return q && string(q.text) && optional(q.search, string) && optional(q.from, date) && optional(q.to, date) && optional(q.today, date) && optional(q.operation, value => ['list', 'count', 'recent', 'upcoming'].includes(value as string)) && (!q.from || !q.to || q.from <= q.to)
}
function filter(all: Row[], query: AppDataQuery, dateField?: string, ascending = false): Row[] {
  // text binds the authorized question; only separately selected search filters data.
  const needle = (query.search ?? '').trim().toLowerCase()
  return all.filter(row => {
    const d = dateField ? row.fields[dateField] : undefined
    // Date-only bounds retain the user's chosen calendar dates, without guessing a zone.
    // Nondated scopes are explicitly current snapshots, not records from that range.
    const day = string(d) ? d.slice(0, 10) : undefined
    return (!dateField || !query.from || !!day && day >= query.from) && (!dateField || !query.to || !!day && day < query.to) &&
      (!needle || Object.values(row.fields).some(value => string(value) && value.toLowerCase().includes(needle)))
  }).sort((a, b) => dateField ? (ascending ? String(a.fields[dateField] ?? '').localeCompare(String(b.fields[dateField] ?? '')) : String(b.fields[dateField] ?? '').localeCompare(String(a.fields[dateField] ?? ''))) || a.id.localeCompare(b.id) : a.id.localeCompare(b.id))
}
function provider(id: string, name: string, english: string, availability: 'builtin' | 'installable', scopes: AppDataScope[], load: () => Promise<Snapshot>, project: (data: unknown, scopeId: string) => Projection): AppDataProvider {
  return {
    manifest: { id, name, english, availability, schemaVersion: 1, scopes },
    async read(scopeId, query, signal) {
      const selectedScope = scopes.find(item => item.id === scopeId)
      if (!selectedScope) return result('unsupported', `${id}:unsupported`)
      let rev = `${id}:unavailable`
      try {
        if (signal.aborted) return result('unavailable', rev)
        const snapshot = await load()
        rev = await revision(snapshot.source)
        if (signal.aborted) return result('unavailable', rev)
        if (!queryValid(query)) throw new InvalidData()
        const upcoming = query.operation === 'upcoming' && !!selectedScope.calendar
        if (upcoming && !date(query.today)) throw new InvalidData()
        if (snapshot.missing) return result('empty', rev)
        const projection = project(snapshot.data, scopeId)
        const all = upcoming ? applyCalendarQuery(projection.rows, selectedScope.calendar!, query) : projection.rows
        const selected = filter(all, query, upcoming ? 'nextDate' : projection.dateField, upcoming)
        const summary = { count: selected.length, ...(!projection.dateField && !upcoming ? { snapshotCurrent: true } : {}), ...projection.summary?.(selected) }
        if (query.operation === 'count') return { status: selected.length ? 'ok' : 'empty', records: [], summary, revision: rev, truncated: false }
        const limit = Number.isSafeInteger(query.limit) && query.limit > 0 ? Math.min(query.limit, 200) : 20
        return { status: selected.length ? 'ok' : 'empty', records: selected.slice(0, limit), summary, revision: rev, truncated: selected.length > limit }
      } catch (error) {
        return result(error instanceof InvalidData || error instanceof InvalidCalendarData ? 'invalid-data' : 'unavailable', rev)
      }
    },
  }
}
const builtin = (id: string, name: string, english: string, scopes: AppDataScope[], load: () => Promise<Snapshot>, project: (data: unknown, scopeId: string) => Projection) => provider(id, name, english, 'builtin', scopes, load, project)
const installed = (id: string, name: string, english: string, scopes: AppDataScope[], load: () => Promise<Snapshot>, project: (data: unknown, scopeId: string) => Projection) => provider(id, name, english, 'installable', scopes, load, project)
const ledgerFields = ['date', 'kind', 'cents', 'category']
const ledgerSummary = ['incomeCents', 'expenseCents', 'balanceCents', 'currency']
function ledgerTotals(items: Row[]): Fields {
  let income = 0n, expense = 0n
  for (const item of items) { if (item.fields.kind === 'income') income += BigInt(item.fields.cents as number); else expense += BigInt(item.fields.cents as number) }
  return { incomeCents: income.toString(), expenseCents: expense.toString(), balanceCents: (income - expense).toString(), currency: 'CNY' }
}
const ledger = builtin('ledger', '记账', 'Ledger', [
  scope('totals', '收支汇总（不含备注）', 'Income and expense totals (no notes)', ledgerSummary),
  scope('entries', '收支明细（不含备注）', 'Ledger entries (no notes)', [...ledgerFields, ...ledgerSummary], true),
  scope('notes', '收支明细与备注', 'Ledger entries with notes', [...ledgerFields, 'note', ...ledgerSummary], true),
], local('aily-desktop-ledger'), (data, id) => {
  const items = checkedList(data, isLedgerEntry)
  const projected = rows(items, id === 'notes' ? [...ledgerFields, 'note'] : ledgerFields)
  // Totals filter against only non-note fields; the internal rows never escape totals scope.
  return { rows: projected, dateField: 'date', summary: ledgerTotals }
})
// Totals have no individual-record capability; aggregate the complete filtered range.
const ledgerRead = ledger.read
ledger.read = async (...args) => {
  const value = await ledgerRead(...args)
  if (args[0] === 'totals') return { ...value, records: [], truncated: false }
  return value
}
const contactDirectory = ['name', 'group', 'favorite']
const contacts = builtin('contacts', '通讯录', 'Contacts', [
  currentScope('directory', '姓名、分组与收藏', 'Names, groups and favorites', contactDirectory, true),
  currentScope('details', '联系详情（含电话与邮箱）', 'Contact details (phone and email)', [...contactDirectory, 'phone', 'email'], true),
], local('aily-desktop-contacts'), (data, id) => ({ rows: rows(checkedList(data, v => object(v) && texts(v, ['name', 'phone', 'email']) && optional(v.group, string) && optional(v.favorite, v => typeof v === 'boolean')), id === 'details' ? [...contactDirectory, 'phone', 'email'] : contactDirectory) }))
const diary = builtin('diary', '日记', 'Diary', [
  scope('index', '日记日期与已记录心情（不含正文）', 'Diary dates and recorded mood (no text)', ['date', 'mood'], true),
  scope('entries', '日记正文与已记录心情', 'Diary text and recorded mood', ['date', 'mood', 'text'], true),
], local('aily-desktop-diary'), (data, id) => ({ rows: rows(checkedList(data, isDiaryEntry), id === 'entries' ? ['date', 'mood', 'text'] : ['date', 'mood']), dateField: 'date' }))

const catalog = new Map(ingredients.map(item => [item.id, item]))
function mealData(data: unknown): { settings: ObjectData; members: ObjectData[]; pantry: ObjectData[]; history: ObjectData[]; prices: Record<string, number> } {
  if (!object(data) || !object(data.settings)) throw new InvalidData()
  const s = data.settings
  const members = checkedList(s.members, m => object(m) && texts(m, ['name', 'likes', 'avoids', 'allergies']) && !!String(m.name).trim() && [0.5, 1, 1.5].includes(m.portion as number) && ['likes', 'avoids', 'allergies'].every(k => String(m[k]).length <= 1000))
  if (!members.length || members.length > 12 || members.some(m => String(m.name).length > 40) || !finite(s.budget) || s.budget < 0 || s.budget > 100000 || !Number.isInteger(s.dishCount) || Number(s.dishCount) < 1 || Number(s.dishCount) > 4 || typeof s.vegetarian !== 'boolean' || !Array.isArray(s.pantry) || s.pantry.length > 1000 || !object(s.prices)) throw new InvalidData()
  for (const p of s.pantry) {
    if (!object(p) || !string(p.ingredientId) || !catalog.has(p.ingredientId) || !finite(p.quantity) || p.quantity < 0 || p.quantity > 1000000 || !optional(p.expiresOn, date) || catalog.get(p.ingredientId)!.unit === '个' && !Number.isInteger(p.quantity)) throw new InvalidData()
  }
  if (!Object.entries(s.prices).every(([id, value]) => catalog.has(id) && finite(value) && value >= 0 && value <= 100000)) throw new InvalidData()
  const history = checkedList(data.history, h => object(h) && date(h.date) && string(h.memberId) && !!h.memberId && optional(h.cookId, string))
  return { settings: s, members, pantry: s.pantry as ObjectData[], prices: s.prices as Record<string, number>, history }
}
const meal = installed('meal-planner', '家庭餐桌', 'Meal planner', [
  currentScope('pantry', '已保存库存与自定义单价', 'Saved pantry and custom prices', ['ingredientId', 'name', 'unit', 'quantity', 'expiresOn', 'pricePerUnit']),
  currentScope('budget', '已保存预算与菜数', 'Saved budget and dish count', ['budgetRmb', 'dishCount', 'currency']),
  scope('wash-history', '洗碗完成记录（不是用餐历史）', 'Completed dishwashing (not meal history)', ['date', 'memberId', 'memberName', 'cookId', 'cookName'], true),
  currentScope('members', '成员姓名与食量（不含健康偏好）', 'Member names and portions (no health preferences)', ['name', 'portion'], true),
  currentScope('member-health', '成员喜好、忌口、过敏与纯素设置', 'Member preferences, restrictions, allergies and vegan setting', ['name', 'portion', 'likes', 'avoids', 'allergies', 'vegetarian'], true),
], local('aily.ext.meal.v1'), (data, id) => {
  const { settings, members, pantry, history, prices } = mealData(data)
  if (id === 'pantry') return { rows: pantry.map((p, i) => {
    const ingredient = catalog.get(p.ingredientId as string)!
    return { id: `pantry:${i}`, fields: { ...pick(p, ['ingredientId', 'quantity', 'expiresOn']), name: ingredient.name, unit: ingredient.unit, ...(prices[ingredient.id] === undefined ? {} : { pricePerUnit: prices[ingredient.id] }) } }
  }) }
  if (id === 'budget') return { rows: [{ id: 'settings', fields: { budgetRmb: settings.budget as number, dishCount: settings.dishCount as number, currency: 'CNY' } }] }
  if (id === 'wash-history') return { rows: history.map(h => ({ id: h.id as string, fields: { ...pick(h, ['date', 'memberId', 'cookId']), memberName: members.find(m => m.id === h.memberId)?.name as string ?? null, ...(h.cookId === undefined ? {} : { cookName: members.find(m => m.id === h.cookId)?.name as string ?? null }) } })), dateField: 'date' }
  return { rows: rows(members, id === 'member-health' ? ['name', 'portion', 'likes', 'avoids', 'allergies'] : ['name', 'portion']), ...(id === 'member-health' ? { summary: () => ({ vegetarian: settings.vegetarian as boolean }) } : {}) }
})
const skincare = installed('skincare-diary', '护肤日记', 'Skincare diary', [scope('entries', '护肤记录、肌肤状态与备注', 'Skincare, skin condition and notes', ['date', 'period', 'products', 'condition', 'notes'], true)], local('aily.ext.skincare'), data => ({ rows: rows(checkedList(data, v => object(v) && date(v.date) && ['早', '晚'].includes(v.period as string) && texts(v, ['products', 'condition', 'notes'])), ['date', 'period', 'products', 'condition', 'notes']), dateField: 'date' }))
const wardrobe = installed('wardrobe', '衣橱', 'Wardrobe', [currentScope('items', '已保存衣物（无穿搭历史）', 'Saved clothing (no outfit history)', ['name', 'category', 'color', 'season'], true)], local('aily.ext.wardrobe'), data => ({ rows: rows(checkedList(data, v => object(v) && texts(v, ['name', 'category', 'color', 'season'])), ['name', 'category', 'color', 'season']) }))
const anniversary = installed('anniversary', '纪念日', 'Anniversary', [{ ...scope('dates', '已保存纪念日与重复设置', 'Saved dates and recurrence', ['name', 'date', 'yearly', 'nextDate', 'daysUntil'], true), calendar: { dateField: 'date', yearlyField: 'yearly' }, countLabel: { zh: '已保存纪念日', en: 'saved anniversaries' } }], local('aily.ext.anniversary'), data => ({ rows: rows(checkedList(data, v => object(v) && string(v.name) && date(v.date) && typeof v.yearly === 'boolean'), ['name', 'date', 'yearly']), dateField: 'date' }))
const game = installed('game-2048', '2048', '2048', [currentScope('score', '当前已保存分数（无棋盘或历史）', 'Current saved score (no board or history)', ['score'])], local('aily.ext.2048.score'), data => {
  if (!Number.isSafeInteger(data) || Number(data) < 0) throw new InvalidData()
  return { rows: [{ id: 'current', fields: { score: data as number } }] }
})

function blobValid(v: unknown): v is Blob {
  return !!v && typeof v === 'object' && 'size' in v && Number.isSafeInteger(v.size) && Number(v.size) > 0 && 'type' in v && string(v.type) && (typeof (v as Blob).slice === 'function')
}
function mediaList(data: unknown): ObjectData[] {
  return checkedList(data, m => object(m) && ['album', 'music'].includes(m.kind as string) && texts(m, ['name', 'mime', 'collection']) && timestamp(m.addedAt) && typeof m.favorite === 'boolean' && blobValid(m.blob) && String(m.mime).startsWith(m.kind === 'album' ? 'image/' : 'audio/'))
}
const mediaFields = ['name', 'mime', 'addedAt', 'favorite', 'collection', 'size']
const mediaLoad = async (): Promise<Snapshot> => { const data = await mediaDb.items.toArray(); return { source: data, data } }
const mediaProvider = (kind: 'album' | 'music', name: string, english: string) => {
  const value = builtin(kind, name, english, [{ ...scope('metadata', '本机媒体名称、分组与元数据（不含文件）', 'Local media names, collections and metadata (no files)', [...mediaFields, 'totalBytes', 'favoriteCount'], true), countLabel: kind === 'album' ? { zh: 'Aily 已导入照片数量', en: 'Photo count (imported into Aily)' } : { zh: 'Aily 已导入音频数量', en: 'Audio count (imported into Aily)' } }], mediaLoad, data => ({
    rows: mediaList(data).filter(m => m.kind === kind).map(m => ({ id: m.id as string, fields: { ...pick(m, mediaFields), size: (m.blob as Blob).size } })), dateField: 'addedAt',
    summary: selected => ({ totalBytes: selected.reduce((sum, m) => sum + Number(m.fields.size), 0), favoriteCount: selected.filter(m => m.fields.favorite).length }),
  }))
  value.manifest.aliases = kind === 'album' ? ['照片', '图库'] : ['音频库']
  value.manifest.dataBoundary = kind === 'album'
    ? { zh: '仅统计 Aily 已导入照片记录，不是系统相册总数；不读取照片文件。', en: 'Counts only photo records imported into Aily, not the system photo library; no photo files are read.' }
    : { zh: '仅查询 Aily 已导入音乐元数据，不是系统或受保护音乐曲库；不读取音频文件。', en: 'Queries only music metadata imported into Aily, not the system or protected music library; no audio files are read.' }
  return value
}
const laughter = installed('laughter-collector', '笑声收集器', 'Laughter collector', [scope('metadata', '人物、标题、日期与时长（无音频或转录）', 'Person, title, date and duration (no audio or transcripts)', ['person', 'name', 'date', 'duration', 'totalDuration'], true)], async () => {
  const data = await laughterDb.recordings.toArray(); return { source: data, data }
}, data => ({ rows: checkedList(data, v => object(v) && texts(v, ['person', 'name']) && timestamp(v.createdAt) && finite(v.duration) && v.duration > 0 && blobValid(v.blob) && optional(v.sourceId, string)).map(v => ({ id: v.id as string, fields: { ...pick(v, ['person', 'name', 'duration']), date: v.createdAt as string } })), dateField: 'date', summary: selected => ({ totalDuration: selected.reduce((sum, row) => sum + Number(row.fields.duration), 0) }) }))
const organizer = installed('photo-organizer', '照片整理', 'Photo organizer', [scope('decisions', '整理标记与本机照片元数据（待处理不是已删除）', 'Decisions and local photo metadata (pending is not deleted)', ['status', 'updatedAt', 'source', ...mediaFields, 'pendingCount', 'keepCount'], true)], async () => {
  const data = await mediaDb.transaction('r', mediaDb.items, mediaDb.photoDecisions, async () => ({ items: await mediaDb.items.toArray(), decisions: await mediaDb.photoDecisions.toArray() }))
  return { source: data, data }
}, data => {
  if (!object(data)) throw new InvalidData()
  const media = mediaList(data.items)
  const decisions = checkedList(data.decisions, d => object(d) && string(d.id) && /^(library|native):.+/.test(d.id) && ['pending', 'keep'].includes(d.status as string) && timestamp(d.updatedAt))
  return { rows: decisions.map(d => {
    const source = String(d.id).startsWith('library:') ? 'library' : 'native'
    const linked = source === 'library' ? media.find(m => m.kind === 'album' && `library:${m.id}` === d.id) : undefined
    return { id: d.id as string, fields: { ...pick(d, ['status', 'updatedAt']), source, ...(linked ? { ...pick(linked, mediaFields), size: (linked.blob as Blob).size } : {}) } }
  }), dateField: 'updatedAt', summary: selected => ({ pendingCount: selected.filter(d => d.fields.status === 'pending').length, keepCount: selected.filter(d => d.fields.status === 'keep').length }) }
})
function unsupported(id: string, name: string, english: string, availability: 'builtin' | 'installable'): AppDataProvider {
  return { manifest: { id, name, english, availability, schemaVersion: 1, scopes: [] }, read: async () => result('unsupported', `${id}:no-persisted-history`) }
}

export const builtinAppDataProviders: AppDataProvider[] = [
  ledger, contacts, diary, mediaProvider('album', '相册', 'Album'), mediaProvider('music', '音乐', 'Music'),
  unsupported('app-store', '应用商店', 'App Store', 'builtin'), unsupported('divination', '占卜', 'Divination', 'builtin'),
  meal, skincare, wardrobe, anniversary, game, laughter, organizer,
  unsupported('focus-timer', '专注计时', 'Focus timer', 'installable'), unsupported('gomoku', '五子棋', 'Gomoku', 'installable'),
]
let initialized = false
export function initializeAppDataProviders(): void {
  if (initialized) return
  builtinAppDataProviders.forEach(registerAppDataProvider)
  initialized = true
}
