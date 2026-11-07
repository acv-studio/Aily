import type { AppDataIdentity, AppDataManifest, AppDataPreview, AppDataProvider, AppDataQuery, AppDataResult, AppDataSelection, AppDataTicket, AppDataValue, AppDataView } from './appDataTypes'
import { extensionApps, extensionInstallationSnapshot, installedExtensionIds, isSafeExtensionAppId, isReservedBuiltinAppId, subscribeExtensionAppChanges } from './extensionApps'
export type * from './appDataTypes'

export const APP_DATA_TIMEOUT_MS = 5000
export const APP_DATA_ACCESS_REVISION_KEY = 'aily.app-data-access.v1'
const MAX_CHARS = 12000, MAX_BYTES = 48 * 1024
const providers = new Map<string, Registered>()
const listeners = new Set<() => void>()
let accessEpoch = 0
let previews = new WeakMap<AppDataPreview, Capture>()
let tickets = new WeakMap<AppDataTicket, Capture>()
type Registered = { original: AppDataProvider; manifest: AppDataManifest; signature: string; read: AppDataProvider['read'] }
type Source = { selection: AppDataSelection; provider: Registered; revision: string | null; status: AppDataResult['status'] }
type Capture = { publicSignature: string; preview: AppDataPreview; identity: AppDataIdentity; queryText: string; install: string; sharedAccess: string | null; epoch: number; sources: Source[] }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const signature = (value: unknown): string => JSON.stringify(value)
const cut = (value: string, length = 300): string => Array.from(value).slice(0, length).join('')
const error = (message: string): Error => new Error(message)
function notify() { for (const listener of listeners) { try { listener() } catch { /* one subscriber cannot block revocation */ } } }
subscribeExtensionAppChanges(notify)
// Cross-tab source updates are conservative cancellation hints; never enumerate or read storage keys.
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === APP_DATA_ACCESS_REVISION_KEY || event.key === null) revokeLocalAccess()
  else if (event.key !== 'aily.extension-apps.v1' && event.key !== 'aily.extension-apps.incarnation.v1') notify()
})
export function subscribeAppDataChanges(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
function revokeLocalAccess(): void { accessEpoch++; previews = new WeakMap(); tickets = new WeakMap(); notify() }
export function invalidateAppDataAccess(): void {
  revokeLocalAccess()
  // Persist only a nonce, never user data. Peer tabs recheck it even if an event is delayed.
  try { localStorage.setItem(APP_DATA_ACCESS_REVISION_KEY, `${Date.now()}:${Math.random()}`) } catch { /* local revocation still works; unavailable storage fails closed at preview/consume */ }
}
function validIdentity(identity: AppDataIdentity) {
  if (!identity || identity.temporary !== false || identity.role !== identity.primaryId || [identity.role, identity.primaryId, identity.endpoint, identity.model].some(v => typeof v !== 'string' || v.length === 0 || Array.from(v).length > 300)) throw error('App data requires the permanent primary role and a configured service')
}
function identityCopy(identity: AppDataIdentity): AppDataIdentity {
  validIdentity(identity)
  return { role: identity.role, primaryId: identity.primaryId, temporary: identity.temporary, endpoint: identity.endpoint, model: identity.model }
}
function checkProvider(provider: Registered) {
  if (providers.get(provider.manifest.id) !== provider || provider.original.read !== provider.read || signature(provider.original.manifest) !== provider.signature) throw error('App data provider changed')
}
export function registerAppDataProvider(provider: AppDataProvider): () => void {
  const manifest = provider?.manifest
  if (!manifest || !isSafeExtensionAppId(manifest.id) || providers.has(manifest.id) || (manifest.availability === 'installable' && isReservedBuiltinAppId(manifest.id)) || typeof provider.read !== 'function' || !Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion < 1 || !['builtin', 'installable'].includes(manifest.availability) || typeof manifest.name !== 'string' || typeof manifest.english !== 'string' || Array.from(manifest.name).length > 300 || Array.from(manifest.english).length > 300 || !Array.isArray(manifest.scopes) || manifest.scopes.length > 20 || (manifest.availability === 'builtin' && extensionApps.some(app => app.id === manifest.id))) throw error('Invalid or duplicate app data provider')
  if (manifest.aliases !== undefined && (!Array.isArray(manifest.aliases) || manifest.aliases.length > 20 || manifest.aliases.some(alias => typeof alias !== 'string' || !alias.trim() || Array.from(alias).length > 80))) throw error('Invalid app data aliases')
  const localizedLabel = (value: unknown): boolean => !!value && typeof value === 'object' && ['zh', 'en'].every(key => { const text = (value as Record<string, unknown>)[key]; return typeof text === 'string' && text.length > 0 && Array.from(text).length <= 300 })
  if (manifest.dataBoundary !== undefined && !localizedLabel(manifest.dataBoundary)) throw error('Invalid app data boundary')
  const scopeIds = new Set<string>()
  for (const scope of manifest.scopes) {
    if (!scope || !isSafeExtensionAppId(scope.id) || scopeIds.has(scope.id) || typeof scope.name !== 'string' || typeof scope.english !== 'string' || Array.from(scope.name).length > 300 || Array.from(scope.english).length > 300 || typeof scope.sensitive !== 'boolean' || !Array.isArray(scope.fields) || scope.fields.length > 64 || scope.fields.some(field => typeof field !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field) || field.length > 80 || forbiddenField(field)) || new Set(scope.fields).size !== scope.fields.length) throw error('Invalid app data scope')
    if (scope.countLabel !== undefined && !localizedLabel(scope.countLabel)) throw error('Invalid app data count label')
    if (scope.calendar !== undefined && (!scope.calendar || typeof scope.calendar !== 'object' || typeof scope.calendar.dateField !== 'string' || !scope.fields.includes(scope.calendar.dateField) || (scope.calendar.yearlyField !== undefined && (typeof scope.calendar.yearlyField !== 'string' || !scope.fields.includes(scope.calendar.yearlyField))) || !scope.fields.includes('nextDate') || !scope.fields.includes('daysUntil'))) throw error('Invalid app data calendar declaration')
    scopeIds.add(scope.id)
  }
  const registered = { original: provider, manifest: clone(manifest), signature: signature(manifest), read: provider.read }
  providers.set(manifest.id, registered)
  notify()
  return () => { if (providers.get(registered.manifest.id) === registered) { providers.delete(registered.manifest.id); notify() } }
}
/** Host metadata only; never reads installation state or App records. */
export function listRegisteredAppDataManifests(): AppDataManifest[] { return [...providers.values()].map(provider => clone(provider.manifest)) }
export function listAppDataManifests(): AppDataManifest[] {
  const installed = new Set(installedExtensionIds())
  const result = [...providers.values()].filter(p => p.manifest.availability === 'builtin' && !extensionApps.some(app => app.id === p.manifest.id)).map(p => clone(p.manifest))
  for (const app of extensionApps) if (installed.has(app.id)) {
    const provider = providers.get(app.id)
    result.push(provider?.manifest.availability === 'installable' ? clone(provider.manifest) : { id: app.id, name: app.name, english: app.english, availability: 'installable', schemaVersion: 1, scopes: [] })
  }
  return result
}
function abortError() { return new DOMException('App data operation cancelled', 'AbortError') }
function assertSignal(signal: AbortSignal) { if (signal.aborted) throw abortError() }
async function readSource(provider: Registered, selection: AppDataSelection, query: AppDataQuery, signal: AbortSignal): Promise<AppDataResult> {
  assertSignal(signal)
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => { controller.abort(); reject(abortError()) }
    signal.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => { controller.abort(); reject(error('App data read timed out')) }, APP_DATA_TIMEOUT_MS)
  })
  try { return await Promise.race([Promise.resolve().then(() => provider.read(selection.scope, clone(query), controller.signal)), stopped]) }
  finally { if (timer !== undefined) clearTimeout(timer); if (onAbort) signal.removeEventListener('abort', onAbort) }
}
function forbiddenField(field: string) { return /(?:url|uri|blob|base64|dataurl|raw|file|path|token|password|secret)/i.test(field) || ['constructor', 'prototype', '__proto__'].includes(field) }
function value(input: unknown): AppDataValue | undefined {
  if (input === null || typeof input === 'boolean') return input
  if (typeof input === 'number') return Number.isFinite(input) ? input : undefined
  if (typeof input === 'string') return /(?:data:|blob:|https?:\/\/|file:\/\/)/i.test(input) ? undefined : cut(input)
  return undefined
}
function empty(status: AppDataResult['status']): AppDataResult { return { status, records: [], summary: {}, revision: '', truncated: false } }
function sanitize(input: AppDataResult, fields: string[]): AppDataResult {
  if (!input || !['ok', 'empty', 'unsupported', 'unavailable', 'invalid-data'].includes(input.status) || typeof input.revision !== 'string' || !Array.isArray(input.records) || !input.summary || typeof input.summary !== 'object' || Array.isArray(input.summary)) return empty('invalid-data')
  let shortened = false
  const safeValue = (raw: unknown) => {
    const safe = value(raw)
    if (safe === undefined || typeof raw === 'string' && Array.from(raw).length > 300) shortened = true
    return safe
  }
  const pick = (source: unknown): Record<string, AppDataValue> => {
    const result: Record<string, AppDataValue> = {}
    if (source && typeof source === 'object' && !Array.isArray(source)) for (const field of fields) if (!forbiddenField(field) && Object.prototype.hasOwnProperty.call(source, field)) { const safe = safeValue((source as Record<string, unknown>)[field]); if (safe !== undefined) result[field] = safe }
    return result
  }
  const records = input.status === 'ok' ? input.records.slice(0, 20).flatMap(record => record && typeof record.id === 'string' && safeValue(record.id) !== undefined ? [{ id: cut(record.id), fields: pick(record.fields) }] : []) : []
  const summary = input.status === 'ok' ? pick(input.summary) : {}
  // Revisions can contain full legacy source JSON: never expose them to previews or models.
  return { status: input.status, records, summary, revision: '', truncated: shortened || input.truncated === true || input.records.length > 20 }
}
function withinBudget(views: AppDataView[], query: AppDataQuery, identity: AppDataIdentity) { const json = signature({ query, views, identity }); return json.length <= MAX_CHARS && new TextEncoder().encode(json).byteLength <= MAX_BYTES }
function budget(views: AppDataView[], query: AppDataQuery, identity: AppDataIdentity): AppDataView[] {
  // Remove whole JSON values, never slice serialized JSON. Every selected app keeps its status envelope.
  const counts = new Map<string, number>()
  for (const view of views) {
    const count = counts.get(view.appId) ?? 0
    if (count + view.result.records.length > 20) { view.result.records = view.result.records.slice(0, Math.max(0, 20 - count)); view.result.truncated = true }
    counts.set(view.appId, count + view.result.records.length)
  }
  while (!withinBudget(views, query, identity)) {
    const withRecords = [...views].reverse().find(view => view.result.records.length)
    if (withRecords) { withRecords.result.records.pop(); withRecords.result.truncated = true; continue }
    const withSummary = [...views].reverse().find(view => Object.keys(view.result.summary).length)
    if (withSummary) { delete withSummary.result.summary[Object.keys(withSummary.result.summary).pop()!]; withSummary.result.truncated = true; continue }
    for (const view of views) { view.name = cut(view.name, 40); view.english = cut(view.english, 40); view.result.revision = ''; view.result.truncated = true }
    if (!withinBudget(views, query, identity)) throw error('Too many app data selections')
  }
  return views
}
export async function previewAppData(selections: AppDataSelection[], query: AppDataQuery, identity: AppDataIdentity, signal: AbortSignal): Promise<AppDataPreview> {
  validIdentity(identity); assertSignal(signal)
  if (!Array.isArray(selections) || selections.length === 0 || selections.length > 20 || new Set(selections.map(s => `${s.appId}/${s.scope}`)).size !== selections.length) throw error('Invalid app data selections')
  const validDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
  if (!query || typeof query.text !== 'string' || Array.from(query.text).length > 300 || (query.search !== undefined && (typeof query.search !== 'string' || Array.from(query.search).length > 100)) || !Number.isFinite(query.limit) || query.limit < 1 || (query.from !== undefined && !validDate(query.from)) || (query.to !== undefined && !validDate(query.to)) || (query.from && query.to && query.from >= query.to)) throw error('Invalid app data query (text max 300 characters; dates use an exclusive end)')
  if ((query.operation !== undefined && !['list', 'count', 'recent', 'upcoming'].includes(query.operation)) || (query.today !== undefined && !validDate(query.today)) || (query.operation === 'upcoming' && !query.today)) throw error('Invalid app data operation or reference date')
  const capturedIdentity = identityCopy(identity), queryText = query.text
  const capturedQuery: AppDataQuery = { text: cut(query.text), limit: Math.min(20, Math.floor(query.limit)), ...(query.operation !== undefined ? { operation: query.operation } : {}), ...(query.today !== undefined ? { today: query.today } : {}), ...(query.search !== undefined ? { search: query.search } : {}), ...(query.from !== undefined ? { from: cut(query.from) } : {}), ...(query.to !== undefined ? { to: cut(query.to) } : {}) }
  const installation = extensionInstallationSnapshot(), epoch = accessEpoch, sharedAccess = localStorage.getItem(APP_DATA_ACCESS_REVISION_KEY)
  // Validate every selection before invoking any adapter: unknown scope/key must never read.
  const sources: Source[] = selections.map(selection => {
    const provider = providers.get(selection.appId)
    if (!provider || !provider.manifest.scopes.some(scope => scope.id === selection.scope)) throw error('Unknown app data scope')
    checkProvider(provider)
    if (provider.manifest.availability === 'builtin' && extensionApps.some(app => app.id === selection.appId)) throw error('Extension apps require installable providers')
    if (provider.manifest.availability === 'installable' && !installation.ids.includes(selection.appId)) throw error('App is not installed')
    return { selection: clone(selection), provider, revision: null, status: 'unavailable' }
  })
  const views = await Promise.all(sources.map(async source => {
    let result: AppDataResult
    try {
      const raw = await readSource(source.provider, source.selection, capturedQuery, signal)
      source.revision = typeof raw?.revision === 'string' ? raw.revision : null
      result = sanitize(raw, source.provider.manifest.scopes.find(scope => scope.id === source.selection.scope)!.fields)
    } catch (cause) { assertSignal(signal); result = empty('unavailable') }
    source.status = result.status
    const manifest = source.provider.manifest
    return { appId: manifest.id, scope: source.selection.scope, name: cut(manifest.name), english: cut(manifest.english), readAt: new Date().toISOString(), result }
  }))
  assertSignal(signal)
  if (epoch !== accessEpoch || sharedAccess !== localStorage.getItem(APP_DATA_ACCESS_REVISION_KEY) || installation.revision !== extensionInstallationSnapshot().revision) throw error('App data access changed')
  sources.forEach(source => checkProvider(source.provider))
  const preview: AppDataPreview = { query: capturedQuery, views: budget(views, capturedQuery, capturedIdentity), identity: capturedIdentity }
  const captured = clone(preview)
  previews.set(preview, { preview: captured, publicSignature: signature(preview), identity: clone(capturedIdentity), queryText, install: installation.revision, sharedAccess, epoch, sources })
  return preview
}
function checkCapture(capture: Capture) {
  if (capture.epoch !== accessEpoch || localStorage.getItem(APP_DATA_ACCESS_REVISION_KEY) !== capture.sharedAccess || extensionInstallationSnapshot().revision !== capture.install) throw error('App installation or data access changed')
  for (const source of capture.sources) checkProvider(source.provider)
}
export function approveAppDataPreview(preview: AppDataPreview): AppDataTicket {
  const capture = previews.get(preview)
  if (!capture || signature(preview) !== capture.publicSignature) throw error('Invalid or modified app data preview')
  validIdentity(capture.identity); checkCapture(capture)
  previews.delete(preview)
  const ticket = Object.freeze({ token: `app-data:${Date.now()}:${Math.random()}` })
  tickets.set(ticket, capture)
  return ticket
}
export function appDataTicketSources(ticket: AppDataTicket): string[] { const capture = tickets.get(ticket); if (!capture) throw error('Invalid app data ticket'); checkCapture(capture); return [...new Set(capture.preview.views.map(view => view.name))] }
export function discardAppDataPreview(preview: AppDataPreview): void { previews.delete(preview) }
export function discardAppDataTicket(ticket: AppDataTicket): void { tickets.delete(ticket) }
export async function consumeAppDataTicket(ticket: AppDataTicket, identity: () => AppDataIdentity, queryText: string, signal: AbortSignal): Promise<{ views: AppDataView[]; assertValid: () => Promise<void> }> {
  const capture = tickets.get(ticket)
  if (!capture) throw error('Invalid or already consumed app data ticket')
  tickets.delete(ticket)
  const check = () => {
    assertSignal(signal); checkCapture(capture)
    const current = identityCopy(identity())
    if (signature(current) !== signature(capture.identity) || queryText !== capture.queryText) throw error('App data identity, service or query changed')
  }
  const assertValid = async () => {
    check()
    await Promise.all(capture.sources.map(async source => {
      let raw: AppDataResult | null = null
      try { raw = await readSource(source.provider, source.selection, capture.preview.query, signal) } catch { assertSignal(signal) }
      check()
      if ((typeof raw?.revision === 'string' ? raw.revision : null) !== source.revision || (raw ? sanitize(raw, source.provider.manifest.scopes.find(scope => scope.id === source.selection.scope)!.fields).status : 'unavailable') !== source.status) throw error('App data source changed')
    }))
    check()
  }
  await assertValid()
  return { views: clone(capture.preview.views), assertValid }
}
