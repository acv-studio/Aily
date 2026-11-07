import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteLocalProfile } from './privacy'
import { clearRegisteredMiniAppData, registerMiniApp } from './extensionRuntime'
import { db } from './db'
import { demoDb } from './giftDemo'

let unregister: (() => void) | undefined
let clearData: ReturnType<typeof vi.fn<() => Promise<void>>> | undefined
const key = 'aily.app.privacy-future.entries'
beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear()
  await db.delete(); await db.open(); await demoDb.delete(); await demoDb.open()
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, work: (lock: object) => Promise<void>) => work({}) } })
})
afterEach(async () => {
  localStorage.clear(); unregister?.(); unregister = undefined
  clearData?.mockImplementation(async () => { localStorage.removeItem(key) }); await clearRegisteredMiniAppData(); clearData = undefined
  vi.unstubAllGlobals()
})
function register(clear: () => Promise<void>) {
  unregister = registerMiniApp({
    app: { id: 'privacy-future', name: 'Future', english: 'Future', description: 'D', englishDescription: 'D', icon: 'A', color: '#abc', category: 'life' },
    provider: { manifest: { id: 'privacy-future', name: 'Future', english: 'Future', availability: 'installable', schemaVersion: 1, scopes: [] }, read: async () => ({ status: 'empty', records: [], summary: {}, revision: '', truncated: false }) },
    component: () => null, clearData: clear,
  })
}
describe('host privacy deletion includes app data', () => {
  it('clears every legacy extension key and shared access nonce, without scanning unrelated data', async () => {
    const keys = ['aily.extension-apps.v1', 'aily.extension-apps.incarnation.v1', 'aily.extension-defaults.v1', 'aily.ext.feedback.v1', 'aily.ext.skincare', 'aily.ext.wardrobe', 'aily.ext.anniversary', 'aily.ext.2048.grid', 'aily.ext.2048.score', 'aily.ext.meal.v1', 'aily.app-data-access.v1']
    keys.forEach(key => localStorage.setItem(key, 'private'))
    localStorage.setItem('unrelated-app-data', 'keep')
    await deleteLocalProfile()
    keys.forEach(key => expect(localStorage.getItem(key)).toBeNull())
    expect(localStorage.getItem('unrelated-app-data')).toBe('keep')
  })
  it('deletes retained data through a future App cleanup even after runtime unregistration', async () => {
    clearData = vi.fn(async () => { localStorage.removeItem(key) })
    register(clearData); localStorage.setItem(key, 'private')
    unregister!()
    expect(localStorage.getItem(key)).toBe('private')
    await deleteLocalProfile()
    expect(clearData).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(key)).toBeNull()
  })
  it('reports a future App deletion failure and retains the hook for a real retry', async () => {
    clearData = vi.fn(async () => { throw new Error('app-storage-denied') })
    register(clearData); localStorage.setItem(key, 'private'); sessionStorage.setItem('aily-api-key', 'secret')
    unregister!()
    await expect(deleteLocalProfile()).rejects.toThrow('Some mini app data')
    expect(localStorage.getItem(key)).toBe('private')
    expect(sessionStorage.getItem('aily-api-key')).toBeNull()
    clearData.mockImplementation(async () => { localStorage.removeItem(key) })
    await deleteLocalProfile()
    expect(clearData).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem(key)).toBeNull()
  })
})
