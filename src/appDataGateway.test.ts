import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_DATA_ACCESS_REVISION_KEY, APP_DATA_TIMEOUT_MS, appDataTicketSources, approveAppDataPreview, consumeAppDataTicket, discardAppDataPreview, discardAppDataTicket, invalidateAppDataAccess, listAppDataManifests, previewAppData, registerAppDataProvider, subscribeAppDataChanges } from './appDataGateway'
import { extensionApps, extensionInstallationKey, installedExtensionIds, registerExtensionApp, setExtensionInstalled } from './extensionApps'
import type { AppDataIdentity, AppDataProvider, AppDataResult } from './appDataTypes'

const identity: AppDataIdentity = { role: 'momo' as AppDataIdentity['role'], primaryId: 'momo' as AppDataIdentity['role'], temporary: false, endpoint: 'local-service', model: 'test-model' }
const query = { text: 'hello', limit: 20 }
let disposers: (() => void)[] = []
let nextId = 0
function provider(options: { id?: string; installed?: boolean; fields?: string[]; result?: AppDataResult; fail?: boolean } = {}) {
  const id = options.id ?? `gateway-test-${++nextId}`
  const result: AppDataResult = options.result ?? { status: 'ok', revision: 'original-revision', records: [{ id: 'record-one', fields: { name: 'safe', note: 'private' } }], summary: { count: 1, note: 'private summary' }, truncated: false }
  const read = vi.fn(async () => { if (options.fail) throw new Error('provider failure'); return result })
  const p: AppDataProvider = { manifest: { id, name: 'Test app', english: 'Test app', availability: options.installed ? 'installable' : 'builtin', schemaVersion: 1, scopes: [{ id: 'entries', name: 'Entries', english: 'Entries', fields: options.fields ?? ['name', 'count'], sensitive: false }] }, read }
  disposers.push(registerAppDataProvider(p))
  return { p, read, result, selection: { appId: id, scope: 'entries' } }
}
function extension(id = `future-app-${++nextId}`) {
  disposers.push(registerExtensionApp({ id, name: 'Future', english: 'Future', description: 'D', englishDescription: 'D', icon: 'A', color: '#abc', category: 'life' }))
  return id
}
async function preview(p: ReturnType<typeof provider>, override = identity, signal = new AbortController().signal) { return previewAppData([p.selection], query, override, signal) }
async function ticket(p: ReturnType<typeof provider>) { return approveAppDataPreview(await preview(p)) }
beforeEach(() => { localStorage.clear(); invalidateAppDataAccess() })
afterEach(() => { vi.useRealTimers(); localStorage.clear(); disposers.reverse().forEach(dispose => dispose()); disposers = []; invalidateAppDataAccess() })

describe('app data gateway capability boundary', () => {
  it('discovers builtin and installed unsupported apps without touching private storage', async () => {
    const p = provider()
    setExtensionInstalled('focus-timer', true)
    const get = vi.spyOn(Storage.prototype, 'getItem')
    const manifests = listAppDataManifests()
    expect(manifests.find(m => m.id === p.p.manifest.id)?.scopes).toHaveLength(1)
    expect(manifests.find(m => m.id === 'focus-timer')?.scopes).toEqual([])
    expect(get.mock.calls.every(([key]) => key === extensionInstallationKey)).toBe(true)
    get.mockRestore()
    manifests[0].scopes.length = 0
    expect(listAppDataManifests().find(m => m.id === p.p.manifest.id)?.scopes).toHaveLength(1)
  })

  it.each(['null', '{}', '42', '"focus-timer"', '["unknown-app"]', '["focus-timer",42]', '["focus-timer","focus-timer"]', '["__proto__"]', '{broken', ''])('strictly rejects malformed/unknown installs %s without adapter reads', async raw => {
    const p = provider()
    localStorage.setItem(extensionInstallationKey, raw)
    await expect(preview(p)).rejects.toThrow()
    expect(p.read).not.toHaveBeenCalled()
    expect(() => installedExtensionIds()).not.toThrow()
  })

  it('accepts absent and valid empty legacy installation state and discovers future registration', async () => {
    const id = extension()
    expect(listAppDataManifests().some(m => m.id === id)).toBe(false)
    localStorage.setItem(extensionInstallationKey, JSON.stringify([id]))
    expect(listAppDataManifests().find(m => m.id === id)?.scopes).toEqual([])
    const p = provider({ id, installed: true })
    expect(listAppDataManifests().find(m => m.id === id)?.scopes[0].id).toBe('entries')
    expect((await preview(p)).views[0].result.status).toBe('ok')
    setExtensionInstalled(id, false)
    await expect(preview(p)).rejects.toThrow('not installed')
    localStorage.setItem(extensionInstallationKey, '[]')
    expect((await preview(provider())).views[0].result.status).toBe('ok')
  })

  it('rejects duplicate/dangerous app registration and unknown installation writes', () => {
    const id = extension()
    const app = extensionApps.find(app => app.id === id)!
    expect(() => registerExtensionApp(app)).toThrow()
    for (const bad of ['__proto__', 'constructor', '../private', 'Bad', 'x.y', 'x/y']) expect(() => registerExtensionApp({ ...app, id: bad })).toThrow()
    expect(() => setExtensionInstalled('unregistered', true)).toThrow()
    expect(localStorage.getItem(extensionInstallationKey)).toBeNull()
    const p = provider()
    expect(() => registerAppDataProvider(p.p)).toThrow()
  })

  it.each([{ text: 'x'.repeat(301), limit: 20 }, { text: 'x', limit: 20, from: '2026-02-30' }, { text: 'x', limit: 20, from: '11/07/2026' }, { text: 'x', limit: 20, from: '2026-11-07', to: '2026-11-07' }, { text: 'x', limit: 20, from: '2026-11-08', to: '2026-11-07' }])('rejects oversized query text and invalid/exclusive date ranges before reading %j', async badQuery => {
    const p = provider()
    await expect(previewAppData([p.selection], badQuery, identity, new AbortController().signal)).rejects.toThrow('query')
    expect(p.read).not.toHaveBeenCalled()
  })

  it('compares identity canonically regardless of object property order', async () => {
    const p = provider()
    const reordered = { model: identity.model, endpoint: identity.endpoint, temporary: identity.temporary, primaryId: identity.primaryId, role: identity.role }
    expect((await consumeAppDataTicket(await ticket(p), () => reordered, query.text, new AbortController().signal)).views).toHaveLength(1)
  })

  it('does not allow builtin providers to masquerade as installable extensions', async () => {
    const id = extension()
    expect(() => provider({ id })).toThrow('provider')
    const p = provider()
    extension(p.p.manifest.id)
    setExtensionInstalled(p.p.manifest.id, true)
    const matching = listAppDataManifests().filter(m => m.id === p.p.manifest.id)
    expect(matching).toHaveLength(1)
    expect(matching[0].scopes).toEqual([])
    await expect(preview(p)).rejects.toThrow('installable')
    expect(p.read).not.toHaveBeenCalled()
  })

  it('limits manifest/schema dimensions and rejects unknown scopes before any read', () => {
    const p = provider(), dispose = disposers.pop()!
    dispose()
    p.p.manifest.scopes[0].fields = Array.from({ length: 65 }, (_, i) => `field${i}`)
    expect(() => registerAppDataProvider(p.p)).toThrow('scope')
    p.p.manifest.scopes = []; p.p.manifest.name = 'x'.repeat(301)
    expect(() => registerAppDataProvider(p.p)).toThrow('provider')
  })

  it('rejects every unknown scope/app before invoking any adapter', async () => {
    const p = provider()
    await expect(previewAppData([p.selection, { appId: p.selection.appId, scope: 'notes' }], query, identity, new AbortController().signal)).rejects.toThrow('Unknown')
    await expect(previewAppData([{ appId: 'not-registered', scope: 'entries' }], query, identity, new AbortController().signal)).rejects.toThrow('Unknown')
    expect(p.read).not.toHaveBeenCalled()
  })

  it('filters both records and summaries through scope fields and blocks raw resources', async () => {
    const raw = { status: 'ok', revision: 'r', records: [{ id: 'one', fields: { name: 'safe', count: 1, note: 'secret', url: 'https://secret', blob: new Blob(['secret']), other: 'data:text/plain;base64,c2VjcmV0', nested: { secret: true } } }], summary: { name: 'https://secret', count: 1, note: 'secret', other: 'blob:secret' }, truncated: false } as unknown as AppDataResult
    const p = provider({ fields: ['name', 'count', 'other', 'nested'], result: raw })
    const result = (await preview(p)).views[0].result
    expect(result.records).toEqual([{ id: 'one', fields: { name: 'safe', count: 1 } }])
    expect(result.summary).toEqual({ count: 1 })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(() => provider({ fields: ['rawBlob'] })).toThrow('scope')
  })

  it('brands originals: copied/forged/mutated previews and tickets never authorize; approval is one-shot', async () => {
    const p = provider(), original = await preview(p)
    expect(() => approveAppDataPreview(structuredClone(original))).toThrow()
    original.views[0].result.records[0].fields.name = 'injected'
    expect(() => approveAppDataPreview(original)).toThrow('modified')
    const clean = await preview(p), t = approveAppDataPreview(clean)
    expect(() => approveAppDataPreview(clean)).toThrow()
    expect(appDataTicketSources(t)).toEqual(['Test app'])
    await expect(consumeAppDataTicket({ token: t.token }, () => identity, query.text, new AbortController().signal)).rejects.toThrow()
    const consumed = await consumeAppDataTicket(t, () => identity, query.text, new AbortController().signal)
    expect(consumed.views[0].result.records[0].fields.name).toBe('safe')
    await expect(consumeAppDataTicket(t, () => identity, query.text, new AbortController().signal)).rejects.toThrow('consumed')
    expect(() => appDataTicketSources(t)).toThrow()
  })

  it('captures query/identity/provider output independently from caller mutations', async () => {
    const p = provider(), mutableIdentity = { ...identity }, mutableQuery = { ...query }
    const pending = previewAppData([p.selection], mutableQuery, mutableIdentity, new AbortController().signal)
    mutableIdentity.model = 'changed'; mutableQuery.text = 'changed'
    const original = await pending
    p.result.records[0].fields.name = 'later mutation'
    const consumed = await consumeAppDataTicket(approveAppDataPreview(original), () => identity, query.text, new AbortController().signal)
    expect(consumed.views[0].result.records[0].fields.name).toBe('safe')
    expect(original.identity).toEqual(identity)
    expect(original.query).toEqual(query)
  })

  it.each([{ temporary: true }, { role: 'other' }])('rejects nonprimary or temporary identities before reading %j', async change => {
    const p = provider()
    await expect(preview(p, { ...identity, ...change } as AppDataIdentity)).rejects.toThrow('primary')
    expect(p.read).not.toHaveBeenCalled()
  })

  it.each([{ role: 'other' }, { primaryId: 'other' }, { temporary: true }, { endpoint: 'other' }, { model: 'other' }])('binds consumed authorization to role/primary/temporary/service %j', async change => {
    const p = provider()
    await expect(consumeAppDataTicket(await ticket(p), () => ({ ...identity, ...change } as AppDataIdentity), query.text, new AbortController().signal)).rejects.toThrow()
  })

  it('binds exact original query and burns a ticket even on failed consume', async () => {
    const p = provider(), t = await ticket(p)
    await expect(consumeAppDataTicket(t, () => identity, 'different', new AbortController().signal)).rejects.toThrow('query')
    await expect(consumeAppDataTicket(t, () => identity, query.text, new AbortController().signal)).rejects.toThrow('consumed')
  })

  it('rejects manifest/schema/read-version changes and unregister/re-register replacement', async () => {
    const p = provider(), t = await ticket(p)
    p.p.manifest.schemaVersion++
    await expect(consumeAppDataTicket(t, () => identity, query.text, new AbortController().signal)).rejects.toThrow('provider changed')
    const p2 = provider(), t2 = await ticket(p2)
    p2.p.read = async () => p2.result
    await expect(consumeAppDataTicket(t2, () => identity, query.text, new AbortController().signal)).rejects.toThrow('provider changed')
    const p3 = provider(), t3 = await ticket(p3)
    disposers.pop()!()
    provider({ id: p3.p.manifest.id })
    await expect(consumeAppDataTicket(t3, () => identity, query.text, new AbortController().signal)).rejects.toThrow('provider changed')
  })

  it('invalidates uninstall/reinstall even when raw installation JSON is exactly restored', async () => {
    const id = extension(), p = provider({ id, installed: true })
    setExtensionInstalled(id, true)
    const raw = localStorage.getItem(extensionInstallationKey), t = await ticket(p)
    setExtensionInstalled(id, false); setExtensionInstalled(id, true)
    expect(localStorage.getItem(extensionInstallationKey)).toBe(raw)
    await expect(consumeAppDataTicket(t, () => identity, query.text, new AbortController().signal)).rejects.toThrow('installation')
  })

  it('notifies stream listeners for same-page install, cross-tab storage, re-registration, unregister and revocation', () => {
    const listener = vi.fn(), unsubscribe = subscribeAppDataChanges(listener)
    const p = provider()
    expect(listener).toHaveBeenCalledTimes(1)
    setExtensionInstalled('focus-timer', true)
    window.dispatchEvent(new StorageEvent('storage', { key: extensionInstallationKey, oldValue: '[]', newValue: '[]' }))
    disposers.pop()!()
    provider({ id: p.p.manifest.id })
    invalidateAppDataAccess()
    expect(listener).toHaveBeenCalledTimes(6)
    window.dispatchEvent(new StorageEvent('storage', { key: 'some-source-key' }))
    expect(listener).toHaveBeenCalledTimes(7)
    unsubscribe(); invalidateAppDataAccess()
    expect(listener).toHaveBeenCalledTimes(7)
  })

  it('re-reads raw source revision at consume and every assertValid (including beyond displayed prefix)', async () => {
    const p = provider()
    p.result.revision = 'x'.repeat(301) + 'a'
    const t = await ticket(p)
    p.result.revision = 'x'.repeat(301) + 'b'
    await expect(consumeAppDataTicket(t, () => identity, query.text, new AbortController().signal)).rejects.toThrow('source changed')
    const consumed = await consumeAppDataTicket(await ticket(p), () => identity, query.text, new AbortController().signal)
    await consumed.assertValid()
    p.result.revision += 'c'
    await expect(consumed.assertValid()).rejects.toThrow('source changed')
  })

  it('assertValid checks identity and installation before and after asynchronous source read', async () => {
    const p = provider(), current = { ...identity }
    const consumed = await consumeAppDataTicket(await ticket(p), () => current, query.text, new AbortController().signal)
    p.read.mockImplementationOnce(async () => { current.model = 'changed-during-read'; return p.result })
    await expect(consumed.assertValid()).rejects.toThrow('identity')
    current.model = identity.model
    p.read.mockImplementationOnce(async () => { setExtensionInstalled('focus-timer', true); return p.result })
    await expect(consumed.assertValid()).rejects.toThrow('installation')
  })

  it('supports discard/global invalidation without any persisted grants or previews', async () => {
    const p = provider(), original = await preview(p)
    discardAppDataPreview(original)
    expect(() => approveAppDataPreview(original)).toThrow()
    const t = await ticket(p)
    discardAppDataTicket(t)
    await expect(consumeAppDataTicket(t, () => identity, query.text, new AbortController().signal)).rejects.toThrow()
    const active = await ticket(p), consumed = await consumeAppDataTicket(await ticket(p), () => identity, query.text, new AbortController().signal)
    const set = vi.spyOn(Storage.prototype, 'setItem')
    invalidateAppDataAccess()
    expect(set).toHaveBeenCalledTimes(1)
    expect(set.mock.calls[0][0]).toBe(APP_DATA_ACCESS_REVISION_KEY)
    expect(set.mock.calls[0][1]).not.toContain(query.text)
    expect(set.mock.calls[0][1]).not.toContain('original-revision')
    set.mockRestore()
    await expect(consumeAppDataTicket(active, () => identity, query.text, new AbortController().signal)).rejects.toThrow()
    await expect(consumed.assertValid()).rejects.toThrow('access changed')
  })

  it('preserves per-app failure status instead of dropping the whole preview', async () => {
    const good = provider(), failed = provider({ fail: true })
    const original = await previewAppData([good.selection, failed.selection], query, identity, new AbortController().signal)
    expect(original.views.map(v => v.result.status)).toEqual(['ok', 'unavailable'])
    const consumed = await consumeAppDataTicket(approveAppDataPreview(original), () => identity, query.text, new AbortController().signal)
    expect(consumed.views).toHaveLength(2)
  })

  it('does not expose failure/empty summaries and detects status changes even at the same source revision', async () => {
    const p = provider(), t = await ticket(p)
    p.result.status = 'empty'
    await expect(consumeAppDataTicket(t, () => identity, query.text, new AbortController().signal)).rejects.toThrow('source changed')
    for (const status of ['empty', 'unavailable', 'invalid-data', 'unsupported'] as const) {
      p.result.status = status
      const view = (await preview(p)).views[0]
      expect(view.result.records).toEqual([])
      expect(view.result.summary).toEqual({})
    }
  })

  it('caps records across multiple scopes of the same app rather than per scope alone', async () => {
    const p = provider(), dispose = disposers.pop()!
    dispose()
    p.p.manifest.scopes.push({ ...p.p.manifest.scopes[0], id: 'second' })
    p.result.records = Array.from({ length: 20 }, (_, i) => ({ id: `${i}`, fields: { name: 'safe' } }))
    disposers.push(registerAppDataProvider(p.p))
    const original = await previewAppData([p.selection, { ...p.selection, scope: 'second' }], query, identity, new AbortController().signal)
    expect(original.views.reduce((total, view) => total + view.result.records.length, 0)).toBe(20)
    expect(original.views[1].result.truncated).toBe(true)
  })

  it('returns invalid-data for malformed provider shapes instead of serializing unknown data', async () => {
    const p = provider({ result: { status: 'ok', revision: 'r', records: null } as unknown as AppDataResult })
    expect((await preview(p)).views[0].result).toEqual({ status: 'invalid-data', revision: '', records: [], summary: {}, truncated: false })
  })

  it('aborts timed-out providers and preserves unavailable while other providers succeed', async () => {
    vi.useFakeTimers()
    const slow = provider(), good = provider()
    let observed: AbortSignal | undefined
    slow.p.read = vi.fn(async (_scope, _query, signal) => { observed = signal; return new Promise<AppDataResult>(() => {}) })
    // Register a fresh provider version with its timeout reader.
    disposers.splice(disposers.length - 2, 1)[0]()
    disposers.push(registerAppDataProvider(slow.p))
    const pending = previewAppData([slow.selection, good.selection], query, identity, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(APP_DATA_TIMEOUT_MS)
    expect((await pending).views.map(v => v.result.status)).toEqual(['unavailable', 'ok'])
    expect(observed?.aborted).toBe(true)
  })

  it('cancels caller operations immediately and aborts adapter signal even if adapter ignores abort', async () => {
    const p = provider(), controller = new AbortController()
    p.read.mockImplementation(async () => new Promise<AppDataResult>(() => {}))
    const pending = preview(p, identity, controller.signal)
    await Promise.resolve(); await Promise.resolve()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect((p.read.mock.calls[0] as unknown[])[2]).toMatchObject({ aborted: true })
    const done = provider(), doneController = new AbortController()
    const consumed = await consumeAppDataTicket(await ticket(done), () => identity, query.text, doneController.signal)
    doneController.abort()
    await expect(consumed.assertValid()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('bounds strings, 20 records per app, serialized characters/UTF-8 bytes, and keeps app statuses as correct JSON', async () => {
    const ps = Array.from({ length: 8 }, () => provider({ fields: ['name', 'count'], result: { status: 'ok', revision: 'r'.repeat(1000), records: Array.from({ length: 40 }, (_, i) => ({ id: `${i}`, fields: { name: '😀'.repeat(1000), count: i } })), summary: { name: '中'.repeat(1000), count: 40 }, truncated: false } }))
    const original = await previewAppData(ps.map(p => p.selection), { text: 'q'.repeat(300), limit: 100 }, identity, new AbortController().signal)
    const json = JSON.stringify(original.views)
    expect(json.length).toBeLessThanOrEqual(12000)
    expect(JSON.stringify(original).length).toBeLessThanOrEqual(12000)
    expect(new TextEncoder().encode(JSON.stringify(original)).byteLength).toBeLessThanOrEqual(48 * 1024)
    expect(new TextEncoder().encode(json).byteLength).toBeLessThanOrEqual(48 * 1024)
    expect(JSON.parse(json)).toHaveLength(8)
    for (const view of original.views) { expect(view.result.status).toBe('ok'); expect(view.result.records.length).toBeLessThanOrEqual(20); expect(view.result.truncated).toBe(true) }
    expect(Array.from(original.query.text)).toHaveLength(300)
    const consumed = await consumeAppDataTicket(approveAppDataPreview(original), () => identity, 'q'.repeat(300), new AbortController().signal)
    expect(consumed.views).toEqual(original.views)
  })
})
