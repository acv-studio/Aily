import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { db } from './db'
import { encryptBackup } from './cryptoBackup'
import { saveEncryptedBackup } from './saveBackup'

vi.mock('./saveBackup', () => ({ saveEncryptedBackup: vi.fn() }))
vi.mock('./cryptoBackup', () => ({ encryptBackup: vi.fn(), decryptBackup: vi.fn() }))
const encrypted = '{"format":"aily-encrypted-backup","data":"ciphertext"}'

beforeEach(async () => {
  vi.resetAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  await db.delete()
  await db.open()
  await db.settings.put({ key: 'onboarded', value: true })
  vi.mocked(encryptBackup).mockResolvedValue(encrypted)
})
afterEach(cleanup)

async function exportFromProfile() {
  const { container } = render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: '我的' }))
  const password = container.querySelector('input[type="password"]')
  expect(password).not.toBeNull()
  fireEvent.change(password!, { target: { value: 'test-passphrase' } })
  fireEvent.click(screen.getByRole('button', { name: /导出/ }))
}

describe('profile backup export results', () => {
  it('passes only the encrypted backup to the platform helper and retains browser success copy', async () => {
    vi.mocked(saveEncryptedBackup).mockResolvedValue('downloaded')
    await exportFromProfile()
    expect(await screen.findByText('加密备份已导出，API Key 不包含在文件中')).toBeInTheDocument()
    expect(encryptBackup).toHaveBeenCalledWith(expect.any(String), 'test-passphrase')
    expect(saveEncryptedBackup).toHaveBeenCalledExactlyOnceWith(encrypted)
  })

  it('does not claim export success when native sharing is cancelled', async () => {
    vi.mocked(saveEncryptedBackup).mockResolvedValue('cancelled')
    await exportFromProfile()
    expect(await screen.findByText('已取消备份导出')).toBeInTheDocument()
    expect(screen.queryByText('加密备份已导出，API Key 不包含在文件中')).not.toBeInTheDocument()
  })

  it('replaces previous success when a later export is cancelled', async () => {
    vi.mocked(saveEncryptedBackup).mockResolvedValueOnce('downloaded').mockResolvedValueOnce('cancelled')
    await exportFromProfile()
    expect(await screen.findByText('加密备份已导出，API Key 不包含在文件中')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /导出/ }))
    expect(await screen.findByText('已取消备份导出')).toBeInTheDocument()
    expect(screen.queryByText('加密备份已导出，API Key 不包含在文件中')).not.toBeInTheDocument()
  })

  it('describes a native handoff without claiming the receiver saved the file', async () => {
    vi.mocked(saveEncryptedBackup).mockResolvedValue('shared')
    await exportFromProfile()
    expect(await screen.findByText('加密备份已交给系统分享，请确认已保存；API Key 不包含在文件中')).toBeInTheDocument()
  })

  it('shows helper errors instead of export success', async () => {
    vi.mocked(saveEncryptedBackup).mockRejectedValue(new Error('此设备无法分享备份文件'))
    await exportFromProfile()
    expect(await screen.findByText('此设备无法分享备份文件')).toBeInTheDocument()
    expect(screen.queryByText('加密备份已导出，API Key 不包含在文件中')).not.toBeInTheDocument()
  })

  it('never invokes the helper when encryption fails', async () => {
    vi.mocked(encryptBackup).mockRejectedValue(new Error('备份密码至少需要 6 位'))
    await exportFromProfile()
    expect(await screen.findByText('备份密码至少需要 6 位')).toBeInTheDocument()
    expect(saveEncryptedBackup).not.toHaveBeenCalled()
  })
})
