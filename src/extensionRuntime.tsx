import type { ComponentType } from 'react'
import type { Locale } from './i18n'
import type { AppDataProvider } from './appDataTypes'
import { registerAppDataProvider } from './appDataGateway'
import { extensionApps, isSafeExtensionAppId, isReservedBuiltinAppId, registerExtensionApp, type ExtensionApp } from './extensionApps'

export type MiniAppRegistration = {
  app: ExtensionApp
  provider: AppDataProvider
  component: ComponentType<{ locale: Locale }>
  /** Called only by the host's explicitly confirmed delete-data workflow, never by uninstall. */
  clearData: () => Promise<void>
}
type DataCleanup = { id: string; clearData: MiniAppRegistration['clearData']; active: boolean }
type RegisteredMiniApp = { component: MiniAppRegistration['component']; cleanup: DataCleanup }
const registered = new Map<string, RegisteredMiniApp>()
// A module can disappear while its persisted data survives. Keep each successful registration's
// deletion hook independently, including older versions when the same id is registered again.
const cleanups = new Set<DataCleanup>()
function validRenderer(component: unknown): boolean {
  if (typeof component === 'function') return true
  if (!component || typeof component !== 'object' || !('$$typeof' in component)) return false
  return [Symbol.for('react.memo'), Symbol.for('react.forward_ref'), Symbol.for('react.lazy')].includes((component as { $$typeof: symbol }).$$typeof)
}

/** A future mini-app is a single lifecycle: catalog, read-only data adapter, renderer and deletion hook. */
export function registerMiniApp({ app, provider, component, clearData }: MiniAppRegistration): () => void {
  if (!app || !isSafeExtensionAppId(app.id) || isReservedBuiltinAppId(app.id) || registered.has(app.id) || extensionApps.some(item => item.id === app.id) || !provider?.manifest || provider.manifest.id !== app.id || provider.manifest.name !== app.name || provider.manifest.english !== app.english || provider.manifest.availability !== 'installable' || !validRenderer(component) || typeof clearData !== 'function') throw new Error('Invalid or duplicate mini app registration')
  const id = app.id
  const cleanup = { id, clearData, active: true }
  const runtime = { component, cleanup }
  cleanups.add(cleanup)
  // Publish renderer first. Provider registration is not catalog-visible for an installable app;
  // when catalog registration emits its event, both renderer and provider are already available.
  registered.set(id, runtime)
  let unregisterProvider: (() => void) | undefined
  let unregisterApp: (() => void) | undefined
  try {
    unregisterProvider = registerAppDataProvider(provider)
    unregisterApp = registerExtensionApp(app)
  } catch (cause) {
    registered.delete(id)
    cleanups.delete(cleanup)
    unregisterProvider?.()
    throw cause
  }
  let active = true
  return () => {
    if (!active) return
    active = false
    cleanup.active = false
    if (registered.get(id) === runtime) registered.delete(id)
    try { unregisterApp?.() } finally { unregisterProvider?.() }
  }
}

export function getRegisteredMiniAppComponent(id: string): ComponentType<{ locale: Locale }> | undefined { return registered.get(id)?.component }

/** Includes never-installed, uninstalled and unregistered apps. Successful inactive hooks are
 * retired; active hooks remain for future writes, and failed tombstones remain retryable.
 * Hooks are in-memory: future modules must register again on host startup to restore deletion support. */
export async function clearRegisteredMiniAppData(): Promise<void> {
  const entries = [...cleanups]
  const results = await Promise.allSettled(entries.map(entry => Promise.resolve().then(() => entry.clearData())))
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && !entries[index].active) cleanups.delete(entries[index])
  })
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Some mini app data could not be cleared')
}
