import { extensionInstallationSnapshot, installedExtensionIds, isRetiredExtensionAppId, pruneRetiredExtensionInstallations, setExtensionInstalled } from './extensionApps'

export const defaultExtensionIds: readonly string[] = Object.freeze([])
export const defaultExtensionMarkerKey = 'aily.extension-defaults.v1'

/** Apply trusted bundled defaults once, including existing installations. Reads stay side-effect free.
 * An explicit uninstall is respected because its default has already been acknowledged. */
export function ensureDefaultExtensionsInstalled(): string[] {
  const raw = localStorage.getItem(defaultExtensionMarkerKey)
  const seen: unknown = raw === null ? [] : JSON.parse(raw)
  if (!Array.isArray(seen) || seen.some(id => !defaultExtensionIds.includes(id) && !isRetiredExtensionAppId(id)) || new Set(seen).size !== seen.length) throw new Error('Invalid default installation marker')
  const activeSeen = seen.filter(id => !isRetiredExtensionAppId(id))
  const missing = defaultExtensionIds.filter(id => !activeSeen.includes(id))
  const current = extensionInstallationSnapshot().ids // Refuse to overwrite corrupt installation data.
  if (!missing.length && activeSeen.length === seen.length) return pruneRetiredExtensionInstallations()
  const marker = JSON.stringify([...activeSeen, ...missing])
  // Persist acknowledgement first; roll it back if installation cannot be saved.
  localStorage.setItem(defaultExtensionMarkerKey, marker)
  try {
    pruneRetiredExtensionInstallations()
    for (const id of missing) if (!current.includes(id)) setExtensionInstalled(id, true)
  } catch (failure) {
    try {
      if (localStorage.getItem(defaultExtensionMarkerKey) === marker) {
        if (raw === null) localStorage.removeItem(defaultExtensionMarkerKey)
        else localStorage.setItem(defaultExtensionMarkerKey, raw)
      }
    } catch { /* Keep the original storage error; never reset other app data. */ }
    throw failure
  }
  return installedExtensionIds()
}
