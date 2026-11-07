import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { defaultExtensionMarkerKey, defaultExtensionIds, ensureDefaultExtensionsInstalled } from './defaultExtensions'
import { extensionApps, extensionInstallationKey, extensionInstallationSnapshot, installedExtensionIds, setExtensionInstalled } from './extensionApps'
beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())
describe('retired feedback app migration', () => {
  it('does not install feedback for new users and keeps repeated startup side-effect free', () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    expect(defaultExtensionIds).not.toContain('feedback')
    expect(extensionApps.some(app => app.id === 'feedback')).toBe(false)
    expect(ensureDefaultExtensionsInstalled()).toEqual([])
    expect(ensureDefaultExtensionsInstalled()).toEqual([])
    expect(writes).not.toHaveBeenCalled()
    expect(() => setExtensionInstalled('feedback', true)).toThrow('Unknown extension app')
  })
  it('removes only retired installation/acknowledgement entries and retains drafts and other app records', () => {
    localStorage.setItem(extensionInstallationKey, '["photo-organizer","feedback","focus-timer"]')
    localStorage.setItem(defaultExtensionMarkerKey, '["feedback"]')
    localStorage.setItem('aily.ext.feedback.v1', 'PRIVATE-EXISTING-DRAFT')
    localStorage.setItem('aily.ext.skincare', 'untouched')
    expect(ensureDefaultExtensionsInstalled()).toEqual(['photo-organizer', 'focus-timer'])
    expect(localStorage.getItem(extensionInstallationKey)).toBe('["photo-organizer","focus-timer"]')
    expect(localStorage.getItem(defaultExtensionMarkerKey)).toBe('[]')
    expect(localStorage.getItem('aily.ext.feedback.v1')).toBe('PRIVATE-EXISTING-DRAFT')
    expect(localStorage.getItem('aily.ext.skincare')).toBe('untouched')
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    ensureDefaultExtensionsInstalled()
    expect(writes).not.toHaveBeenCalled()
  })
  it('legacy installation readers filter the retired ID without writing or blocking other app gateways', () => {
    localStorage.setItem(extensionInstallationKey, '["feedback","focus-timer"]')
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    expect(extensionInstallationSnapshot().ids).toEqual(['focus-timer'])
    expect(installedExtensionIds()).toEqual(['focus-timer'])
    expect(writes).not.toHaveBeenCalled()
  })
  it('does not remove any other installed app when no feedback metadata exists', () => {
    localStorage.setItem(extensionInstallationKey, '["photo-organizer","focus-timer"]')
    expect(ensureDefaultExtensionsInstalled()).toEqual(['photo-organizer', 'focus-timer'])
  })
  it('refuses corrupt or unknown installation state without overwriting it', () => {
    for (const raw of ['corrupt', '["feedback","unknown-app"]', '["feedback","feedback"]']) {
      localStorage.setItem(extensionInstallationKey, raw)
      expect(ensureDefaultExtensionsInstalled).toThrow()
      expect(localStorage.getItem(extensionInstallationKey)).toBe(raw)
      expect(localStorage.getItem(defaultExtensionMarkerKey)).toBeNull()
    }
  })
  it('rolls back acknowledgement if installation migration fails, retaining all user data for retry', () => {
    localStorage.setItem(extensionInstallationKey, '["focus-timer","feedback"]')
    localStorage.setItem(defaultExtensionMarkerKey, '["feedback"]')
    localStorage.setItem('aily.ext.feedback.v1', 'draft')
    const original = Storage.prototype.setItem
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === extensionInstallationKey) throw new Error('quota')
      original.call(this, key, value)
    })
    expect(ensureDefaultExtensionsInstalled).toThrow('quota')
    expect(localStorage.getItem(defaultExtensionMarkerKey)).toBe('["feedback"]')
    expect(localStorage.getItem(extensionInstallationKey)).toBe('["focus-timer","feedback"]')
    expect(localStorage.getItem('aily.ext.feedback.v1')).toBe('draft')
    write.mockRestore()
    expect(ensureDefaultExtensionsInstalled()).toEqual(['focus-timer'])
  })
  it('preserves malformed default markers instead of silently resetting user choices', () => {
    localStorage.setItem(defaultExtensionMarkerKey, '["unknown-default"]')
    expect(ensureDefaultExtensionsInstalled).toThrow()
    expect(localStorage.getItem(defaultExtensionMarkerKey)).toBe('["unknown-default"]')
  })
})
