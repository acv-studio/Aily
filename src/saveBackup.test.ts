import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { saveEncryptedBackup } from './saveBackup'

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn() } }))
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' },
  Filesystem: { writeFile: vi.fn(), deleteFile: vi.fn() },
}))
vi.mock('@capacitor/share', () => ({ Share: { canShare: vi.fn(), share: vi.fn() } }))

const encrypted = '{"format":"aily-encrypted-backup","version":1,"data":"ciphertext"}'
const uri = 'file:///private/cache/export.json'
const filename = 'aily-backup-2026-11-03.json'
let click: ReturnType<typeof vi.spyOn>
let createUrl: ReturnType<typeof vi.fn>
let revokeUrl: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-03T16:00:00Z'))
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false)
  vi.mocked(Share.canShare).mockResolvedValue({ value: true })
  vi.mocked(Share.share).mockResolvedValue({ activityType: 'chosen.destination' })
  vi.mocked(Filesystem.writeFile).mockResolvedValue({ uri })
  vi.mocked(Filesystem.deleteFile).mockResolvedValue(undefined)
  createUrl = vi.fn().mockReturnValue('blob:encrypted-backup')
  revokeUrl = vi.fn()
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: createUrl, revokeObjectURL: revokeUrl }))
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('encrypted backup browser download', () => {
  it('downloads the same JSON and date-based filename without native calls', async () => {
    let anchor: HTMLAnchorElement | undefined
    click.mockImplementation(function (this: HTMLAnchorElement) { anchor = this })
    await expect(saveEncryptedBackup(encrypted)).resolves.toBe('downloaded')
    expect(createUrl).toHaveBeenCalledOnce()
    const blob = createUrl.mock.calls[0][0] as Blob
    expect(blob.type).toBe('application/json')
    expect(blob.size).toBe(new TextEncoder().encode(encrypted).length)
    expect(anchor?.href).toBe('blob:encrypted-backup')
    expect(anchor?.download).toBe(filename)
    expect(revokeUrl).toHaveBeenCalledWith('blob:encrypted-backup')
    expect(Filesystem.writeFile).not.toHaveBeenCalled()
    expect(Share.canShare).not.toHaveBeenCalled()
    expect(Share.share).not.toHaveBeenCalled()
  })

  it('revokes its object URL and propagates download failures', async () => {
    const failure = new Error('download failed')
    click.mockImplementation(() => { throw failure })
    await expect(saveEncryptedBackup(encrypted)).rejects.toBe(failure)
    expect(revokeUrl).toHaveBeenCalledWith('blob:encrypted-backup')
  })
})

describe('encrypted backup native share', () => {
  beforeEach(() => { vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true) })

  it('writes UTF-8 encrypted JSON to cache and shares the native file', async () => {
    await expect(saveEncryptedBackup(encrypted)).resolves.toBe('shared')
    expect(Filesystem.writeFile).toHaveBeenCalledWith({
      path: expect.stringMatching(new RegExp(`^[a-f0-9-]+-${filename.replaceAll('.', '\\.')}$`)),
      data: encrypted, directory: Directory.Cache, encoding: Encoding.UTF8,
    })
    expect(Share.share).toHaveBeenCalledWith({ title: filename, files: [uri], dialogTitle: '导出加密备份' })
    expect(Filesystem.deleteFile).not.toHaveBeenCalled()
    expect(createUrl).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
  })

  it('uses distinct cache paths for repeated exports', async () => {
    await saveEncryptedBackup(encrypted)
    await saveEncryptedBackup(encrypted)
    const calls = vi.mocked(Filesystem.writeFile).mock.calls
    expect(calls[0][0].path).not.toBe(calls[1][0].path)
  })

  it('does not write a file or fall back to a browser download when sharing is unavailable', async () => {
    vi.mocked(Share.canShare).mockResolvedValue({ value: false })
    await expect(saveEncryptedBackup(encrypted)).rejects.toThrow('此设备无法分享备份文件')
    expect(Filesystem.writeFile).not.toHaveBeenCalled()
    expect(Share.share).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
  })

  it('propagates share capability errors', async () => {
    const failure = new Error('plugin unavailable')
    vi.mocked(Share.canShare).mockRejectedValue(failure)
    await expect(saveEncryptedBackup(encrypted)).rejects.toBe(failure)
    expect(Filesystem.writeFile).not.toHaveBeenCalled()
  })

  it('propagates filesystem errors without opening the share sheet', async () => {
    const failure = new Error('cache write failed')
    vi.mocked(Filesystem.writeFile).mockRejectedValue(failure)
    await expect(saveEncryptedBackup(encrypted)).rejects.toBe(failure)
    expect(Share.share).not.toHaveBeenCalled()
  })

  it.each([new Error('Share canceled'), { message: 'Share canceled' }])('does not report success for rejected native cancellation', async cancellation => {
    vi.mocked(Share.share).mockRejectedValue(cancellation)
    await expect(saveEncryptedBackup(encrypted)).resolves.toBe('cancelled')
    expect(Filesystem.deleteFile).toHaveBeenCalledWith({
      path: vi.mocked(Filesystem.writeFile).mock.calls[0][0].path, directory: Directory.Cache,
    })
  })

  it.each([{ activityType: '' }, {}])('preserves fulfilled handoffs without activity metadata for late recipients', async result => {
    vi.mocked(Share.share).mockResolvedValue(result)
    await expect(saveEncryptedBackup(encrypted)).resolves.toBe('shared')
    expect(Filesystem.deleteFile).not.toHaveBeenCalled()
  })

  it('propagates sharing errors even if cache cleanup also fails', async () => {
    const failure = new Error('share failed')
    vi.mocked(Share.share).mockRejectedValue(failure)
    vi.mocked(Filesystem.deleteFile).mockRejectedValue(new Error('cleanup failed'))
    await expect(saveEncryptedBackup(encrypted)).rejects.toBe(failure)
    expect(Filesystem.deleteFile).toHaveBeenCalledOnce()
  })
})
