import { memo } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExtensionStore, { ExtensionAppView } from './ExtensionStore'
import { clearRegisteredMiniAppData, getRegisteredMiniAppComponent, registerMiniApp, type MiniAppRegistration } from './extensionRuntime'
import { approveAppDataPreview, consumeAppDataTicket, invalidateAppDataAccess, listAppDataManifests, previewAppData, registerAppDataProvider } from './appDataGateway'
import { BUILTIN_APP_IDS, extensionApps, extensionInstallationKey, installedExtensionIds, registerExtensionApp, setExtensionInstalled, subscribeExtensionAppChanges } from './extensionApps'
import type { AppDataIdentity } from './appDataTypes'

const identity: AppDataIdentity = { role: 'momo' as AppDataIdentity['role'], primaryId: 'momo' as AppDataIdentity['role'], temporary: false, endpoint: 'test-service', model: 'test-model' }
const query = { text: '', limit: 20 }
let serial = 0
let disposers: (() => void)[] = []
let cleanupHooks: MiniAppRegistration['clearData'][] = []
function miniApp(): MiniAppRegistration {
  const id = `future-runtime-${++serial}`
  return {
    app: { id, name: '未来应用', english: 'Future app', description: 'future description', englishDescription: 'future description', icon: 'A', color: '#123', category: 'life' },
    provider: { manifest: { id, name: '未来应用', english: 'Future app', availability: 'installable', schemaVersion: 1, scopes: [{ id: 'entries', name: '数据', english: 'Entries', fields: ['name'], sensitive: false }] }, read: vi.fn(async () => ({ status: 'ok' as const, records: [{ id: 'record', fields: { name: 'future record' } }], summary: {}, revision: 'one', truncated: false })) },
    component: ({ locale }) => <h2>{locale === 'en' ? 'Future renderer' : '未来应用界面'}</h2>,
    clearData: vi.fn(async () => {}),
  }
}
function register(app: MiniAppRegistration) { const unregister = registerMiniApp(app); disposers.push(unregister); cleanupHooks.push(app.clearData); return unregister }
function selection(app: MiniAppRegistration) { return [{ appId: app.app.id, scope: 'entries' }] }
function preview(app: MiniAppRegistration) { return previewAppData(selection(app), query, identity, new AbortController().signal) }
beforeEach(() => { localStorage.clear(); invalidateAppDataAccess() })
afterEach(async () => {
  cleanup(); vi.restoreAllMocks(); localStorage.clear(); disposers.reverse().forEach(dispose => dispose()); disposers = []
  // Retire this test's tombstones without exporting an unsafe production reset API.
  vi.resetAllMocks()
  // Vitest 5 resets to the original implementation (which may intentionally fail).
  for (const clear of cleanupHooks) if (vi.isMockFunction(clear)) clear.mockImplementation(async () => {})
  cleanupHooks = []
  await clearRegisteredMiniAppData()
  invalidateAppDataAccess()
})

describe('future mini-app runtime atomic lifecycle', () => {
  it('reserves all seven permanent host ids before provider initialization', () => {
    expect(BUILTIN_APP_IDS).toEqual(['ledger', 'contacts', 'diary', 'album', 'music', 'app-store', 'divination'])
    expect(Object.isFrozen(BUILTIN_APP_IDS)).toBe(true)
  })

  it.each(BUILTIN_APP_IDS)('rejects pre-initialization builtin-id takeover through every installable registration API: %s', id => {
    const app = miniApp()
    app.app.id = id; app.provider.manifest.id = id
    expect(() => registerMiniApp(app)).toThrow('registration')
    expect(() => registerExtensionApp(app.app)).toThrow('extension app')
    expect(() => registerAppDataProvider(app.provider)).toThrow('provider')
    expect(() => setExtensionInstalled(id, true)).toThrow('Unknown')
    expect(extensionApps.some(item => item.id === id)).toBe(false)
    expect(getRegisteredMiniAppComponent(id)).toBeUndefined()
    expect(localStorage.getItem(extensionInstallationKey)).toBeNull()
    // Failed takeover leaves the legitimate builtin initialization slot untouched.
    app.provider.manifest.availability = 'builtin'
    disposers.push(registerAppDataProvider(app.provider))
    expect(listAppDataManifests().find(manifest => manifest.id === id)?.availability).toBe('builtin')
  })
  it('registers, installs through the existing store, reads, renders and unregisters a future app without chat changes', async () => {
    const app = miniApp()
    const unregister = register(app)
    expect(extensionApps.some(item => item.id === app.app.id)).toBe(true)
    expect(getRegisteredMiniAppComponent(app.app.id)).toBe(app.component)
    expect(listAppDataManifests().some(item => item.id === app.app.id)).toBe(false)
    await expect(preview(app)).rejects.toThrow('not installed')
    expect(app.provider.read).not.toHaveBeenCalled()
    const open = vi.fn()
    const store = render(<ExtensionStore locale="en" openApp={open}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Install Future app' }))
    expect(installedExtensionIds()).toContain(app.app.id)
    fireEvent.click(screen.getByRole('button', { name: 'Open Future app' }))
    expect(open).toHaveBeenCalledWith(app.app.id)
    expect(listAppDataManifests().find(item => item.id === app.app.id)?.scopes[0].id).toBe('entries')
    const ticket = approveAppDataPreview(await preview(app))
    const consumed = await consumeAppDataTicket(ticket, () => identity, query.text, new AbortController().signal)
    expect(consumed.views[0].result.records[0].fields.name).toBe('future record')
    store.unmount()
    const view = render(<ExtensionAppView id={app.app.id} locale="en"/>)
    expect(screen.getByRole('heading', { name: 'Future renderer' })).toBeInTheDocument()
    const staleTicket = approveAppDataPreview(await preview(app))
    act(() => unregister())
    view.rerender(<ExtensionAppView id={app.app.id} locale="en"/>)
    expect(screen.getByRole('status')).toHaveTextContent('App temporarily unavailable')
    expect(extensionApps.some(item => item.id === app.app.id)).toBe(false)
    expect(installedExtensionIds()).not.toContain(app.app.id)
    expect(getRegisteredMiniAppComponent(app.app.id)).toBeUndefined()
    await expect(consumeAppDataTicket(staleTicket, () => identity, query.text, new AbortController().signal)).rejects.toThrow()
    await expect(consumed.assertValid()).rejects.toThrow()
    expect(app.clearData).not.toHaveBeenCalled()
    unregister() // Disposer is idempotent.
  })

  it('publishes renderer and data adapter before the catalog registration event', async () => {
    const app = miniApp(), observations: boolean[] = []
    const unsubscribe = subscribeExtensionAppChanges(() => {
      if (extensionApps.some(item => item.id === app.app.id)) observations.push(getRegisteredMiniAppComponent(app.app.id) === app.component)
    })
    register(app)
    expect(observations).toEqual([true])
    setExtensionInstalled(app.app.id, true)
    expect(observations).toEqual([true, true])
    expect((await preview(app)).views[0].result.status).toBe('ok')
    unsubscribe()
  })

  it.each(['id', 'name', 'english', 'availability'] as const)('rejects mismatched manifest %s before publishing anything', field => {
    const app = miniApp()
    if (field === 'availability') app.provider.manifest.availability = 'builtin'
    else app.provider.manifest[field] = 'mismatched'
    expect(() => registerMiniApp(app)).toThrow('registration')
    expect(extensionApps.some(item => item.id === app.app.id)).toBe(false)
    expect(getRegisteredMiniAppComponent(app.app.id)).toBeUndefined()
    expect(listAppDataManifests().some(item => item.id === app.app.id)).toBe(false)
  })

  it('rolls back an adapter/renderer when catalog metadata fails and permits retry', async () => {
    const app = miniApp(), valid = { ...app.app }
    app.app.category = 'invalid' as MiniAppRegistration['app']['category']
    expect(() => registerMiniApp(app)).toThrow('metadata')
    expect(getRegisteredMiniAppComponent(app.app.id)).toBeUndefined()
    expect(extensionApps.some(item => item.id === app.app.id)).toBe(false)
    app.app = valid
    register(app)
    setExtensionInstalled(app.app.id, true)
    expect((await preview(app)).views[0].result.status).toBe('ok')
  })

  it('leaves no catalog/renderer when an existing provider prevents registration, without removing that provider', async () => {
    const app = miniApp()
    disposers.push(registerAppDataProvider(app.provider))
    expect(() => registerMiniApp(app)).toThrow('provider')
    expect(getRegisteredMiniAppComponent(app.app.id)).toBeUndefined()
    expect(extensionApps.some(item => item.id === app.app.id)).toBe(false)
    // Existing adapter still exists: catalog-only registration makes its source discoverable.
    disposers.push(registerExtensionApp(app.app))
    setExtensionInstalled(app.app.id, true)
    expect((await preview(app)).views[0].result.status).toBe('ok')
  })

  it('rejects duplicate registration without destroying the original runtime', async () => {
    const app = miniApp()
    register(app)
    expect(() => registerMiniApp(app)).toThrow('duplicate')
    expect(getRegisteredMiniAppComponent(app.app.id)).toBe(app.component)
    setExtensionInstalled(app.app.id, true)
    expect((await preview(app)).views[0].result.status).toBe('ok')
  })

  it('requires a valid component and explicit deletion hook, and supports memo renderers', () => {
    const bad = miniApp()
    expect(() => registerMiniApp({ ...bad, component: {} as MiniAppRegistration['component'] })).toThrow()
    expect(() => registerMiniApp({ ...bad, clearData: undefined as unknown as MiniAppRegistration['clearData'] })).toThrow()
    expect(getRegisteredMiniAppComponent(bad.app.id)).toBeUndefined()
    const app = miniApp()
    app.component = memo(app.component)
    register(app)
    render(<ExtensionAppView id={app.app.id} locale="en"/>)
    expect(screen.getByRole('heading', { name: 'Future renderer' })).toBeInTheDocument()
  })

  it('renders unknown/catalog-only apps as unavailable instead of falling through to 2048', () => {
    const unknown = render(<ExtensionAppView id="unknown-app" locale="zh-CN"/>)
    expect(screen.getByRole('status')).toHaveTextContent('应用暂不可用')
    unknown.unmount()
    const app = miniApp()
    disposers.push(registerExtensionApp(app.app))
    render(<ExtensionAppView id={app.app.id} locale="en"/>)
    expect(screen.getByRole('status')).toHaveTextContent('App temporarily unavailable')
    expect(screen.queryByText('2048')).toBeNull()
  })

  it('only explicitly deletes local data and includes never-installed and uninstalled registered apps', async () => {
    const neverInstalled = miniApp(), installed = miniApp(), removed = miniApp()
    register(neverInstalled); register(installed); register(removed)
    localStorage.setItem(`test.${removed.app.id}`, 'keep')
    setExtensionInstalled(installed.app.id, true)
    setExtensionInstalled(removed.app.id, true)
    setExtensionInstalled(removed.app.id, false)
    expect(localStorage.getItem(`test.${removed.app.id}`)).toBe('keep')
    for (const app of [neverInstalled, installed, removed]) expect(app.clearData).not.toHaveBeenCalled()
    await clearRegisteredMiniAppData()
    for (const app of [neverInstalled, installed, removed]) expect(app.clearData).toHaveBeenCalledTimes(1)
  })

  it('tries all deletion hooks even if one fails, including unregistered runtime tombstones', async () => {
    const broken = miniApp(), good = miniApp(), removed = miniApp()
    broken.clearData = vi.fn(async () => { throw new Error('clear failed') })
    register(broken); register(good); const unregister = register(removed)
    unregister()
    await expect(clearRegisteredMiniAppData()).rejects.toThrow('could not be cleared')
    expect(broken.clearData).toHaveBeenCalledTimes(1)
    expect(good.clearData).toHaveBeenCalledTimes(1)
    expect(removed.clearData).toHaveBeenCalledTimes(1)
  })

  it('preserves unregistered cleanup hooks until data deletion succeeds, then retires the tombstone', async () => {
    const app = miniApp(), dataKey = `test.${app.app.id}`
    app.clearData = vi.fn(async () => { localStorage.removeItem(dataKey) })
    const unregister = register(app)
    localStorage.setItem(dataKey, 'persisted private data')
    unregister()
    expect(getRegisteredMiniAppComponent(app.app.id)).toBeUndefined()
    expect(localStorage.getItem(dataKey)).toBe('persisted private data')
    expect(app.clearData).not.toHaveBeenCalled()
    await clearRegisteredMiniAppData()
    expect(localStorage.getItem(dataKey)).toBeNull()
    expect(app.clearData).toHaveBeenCalledTimes(1)
    await clearRegisteredMiniAppData()
    expect(app.clearData).toHaveBeenCalledTimes(1)
  })

  it('retains a failed unregistered cleanup tombstone so explicit deletion can retry', async () => {
    const app = miniApp(), dataKey = `test.${app.app.id}`
    const clear = vi.fn(async () => { localStorage.removeItem(dataKey) })
    clear.mockRejectedValueOnce(new Error('temporary clear failure'))
    app.clearData = clear
    const unregister = register(app)
    localStorage.setItem(dataKey, 'keep until cleared')
    unregister()
    await expect(clearRegisteredMiniAppData()).rejects.toThrow('could not be cleared')
    expect(localStorage.getItem(dataKey)).toBe('keep until cleared')
    await clearRegisteredMiniAppData()
    expect(localStorage.getItem(dataKey)).toBeNull()
    expect(clear).toHaveBeenCalledTimes(2)
    await clearRegisteredMiniAppData()
    expect(clear).toHaveBeenCalledTimes(2)
  })

  it('keeps active hooks for later writes and retains every historical cleanup when an id re-registers', async () => {
    const old = miniApp(), oldKey = `old.${old.app.id}`, newKey = `new.${old.app.id}`
    old.clearData = vi.fn(async () => { localStorage.removeItem(oldKey) })
    const unregisterOld = register(old)
    localStorage.setItem(oldKey, 'old format data')
    unregisterOld()
    const next = miniApp()
    next.app.id = old.app.id; next.provider.manifest.id = old.app.id
    next.clearData = vi.fn(async () => { localStorage.removeItem(newKey) })
    register(next)
    localStorage.setItem(newKey, 'new format data')
    await clearRegisteredMiniAppData()
    expect(localStorage.getItem(oldKey)).toBeNull()
    expect(localStorage.getItem(newKey)).toBeNull()
    expect(old.clearData).toHaveBeenCalledTimes(1)
    expect(next.clearData).toHaveBeenCalledTimes(1)
    localStorage.setItem(newKey, 'later write')
    await clearRegisteredMiniAppData()
    expect(localStorage.getItem(newKey)).toBeNull()
    expect(old.clearData).toHaveBeenCalledTimes(1)
    expect(next.clearData).toHaveBeenCalledTimes(2)
  })

  it('does not retain deletion hooks from failed registrations', async () => {
    const app = miniApp()
    app.app.category = 'invalid' as MiniAppRegistration['app']['category']
    expect(() => registerMiniApp(app)).toThrow('metadata')
    await clearRegisteredMiniAppData()
    expect(app.clearData).not.toHaveBeenCalled()
  })

  it('cleans all registration layers even if corrupt installation data prevents uninstall writes', () => {
    const app = miniApp(), unregister = register(app)
    setExtensionInstalled(app.app.id, true)
    localStorage.setItem(extensionInstallationKey, JSON.stringify([app.app.id, 'unknown-app']))
    expect(() => unregister()).toThrow('installation')
    expect(extensionApps.some(item => item.id === app.app.id)).toBe(false)
    expect(getRegisteredMiniAppComponent(app.app.id)).toBeUndefined()
    localStorage.clear()
    // The old provider was also removed, so the same id can be registered again cleanly.
    register(app)
  })
})
