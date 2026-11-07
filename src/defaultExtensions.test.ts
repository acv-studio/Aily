import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { defaultExtensionMarkerKey, ensureDefaultExtensionsInstalled } from './defaultExtensions'
import { extensionInstallationKey, installedExtensionIds, setExtensionInstalled } from './extensionApps'
beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())
describe('bundled default app installation', () => {
  it('installs feedback once for new users and keeps readers side-effect free', () => {
    expect(ensureDefaultExtensionsInstalled()).toContain('feedback')
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    expect(ensureDefaultExtensionsInstalled()).toContain('feedback')
    expect(installedExtensionIds()).toContain('feedback')
    expect(writes).not.toHaveBeenCalled()
  })
  it('adds feedback for existing users without replacing their installed apps or data', () => {
    localStorage.setItem(extensionInstallationKey, '["photo-organizer","focus-timer"]')
    localStorage.setItem('aily.ext.skincare', 'untouched')
    expect(ensureDefaultExtensionsInstalled()).toEqual(['photo-organizer', 'focus-timer', 'feedback'])
    expect(localStorage.getItem('aily.ext.skincare')).toBe('untouched')
  })
  it('does not reinstall after the user explicitly uninstalls feedback', () => {
    ensureDefaultExtensionsInstalled(); setExtensionInstalled('feedback', false)
    expect(ensureDefaultExtensionsInstalled()).not.toContain('feedback')
    setExtensionInstalled('feedback', true)
    expect(installedExtensionIds()).toContain('feedback')
  })
  it('refuses corrupt installation state without overwriting it', () => {
    localStorage.setItem(extensionInstallationKey, 'corrupt')
    expect(ensureDefaultExtensionsInstalled).toThrow()
    expect(localStorage.getItem(extensionInstallationKey)).toBe('corrupt')
    expect(localStorage.getItem(defaultExtensionMarkerKey)).toBeNull()
  })
  it('rolls back acknowledgement when the install write fails so retry remains possible', () => {
    localStorage.setItem(extensionInstallationKey, '["focus-timer"]')
    const original = Storage.prototype.setItem
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === extensionInstallationKey) throw new Error('quota')
      original.call(this, key, value)
    })
    expect(ensureDefaultExtensionsInstalled).toThrow('quota')
    expect(localStorage.getItem(defaultExtensionMarkerKey)).toBeNull()
    expect(installedExtensionIds()).toEqual(['focus-timer'])
    write.mockRestore()
    expect(ensureDefaultExtensionsInstalled()).toEqual(['focus-timer', 'feedback'])
  })
  it('preserves malformed default markers instead of silently resetting user choices', () => {
    localStorage.setItem(defaultExtensionMarkerKey, '["unknown-default"]')
    expect(ensureDefaultExtensionsInstalled).toThrow()
    expect(localStorage.getItem(defaultExtensionMarkerKey)).toBe('["unknown-default"]')
  })
})
