import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { db } from './db'
import { encryptBackup } from './cryptoBackup'
import { saveEncryptedBackup } from './saveBackup'

vi.mock('./saveBackup', () => ({ saveEncryptedBackup: vi.fn() }))
vi.mock('./cryptoBackup', () => ({ encryptBackup: vi.fn(), decryptBackup: vi.fn() }))
const encrypted = '{"format":"aily-encrypted-backup","data":"ciphertext"}'
const browserNotice = '已发起加密备份下载，请妥善保存文件和密码。'
const nativeNotice = '加密备份已交给系统分享，请确认已保存；API Key 不包含在文件中'
const setPassword = (value = 'test-passphrase') => fireEvent.change(screen.getByLabelText('备份密码'), { target: { value } })
const exportBackup = () => fireEvent.click(screen.getByRole('button', { name: '导出加密备份' }))

beforeEach(async () => {
  vi.resetAllMocks()
  window.history.replaceState(null, '', '/')
  localStorage.clear()
  sessionStorage.clear()
  await db.delete()
  await db.open()
  await db.settings.put({ key: 'onboarded', value: true })
  vi.mocked(encryptBackup).mockResolvedValue(encrypted)
})
afterEach(cleanup)

async function exportFromProfile() {
  render(<App />)
  const continueButton = await screen.findByRole('button', { name: '确认并继续' })
  expect(continueButton).toBeDisabled()
  expect(screen.queryByRole('button', { name: '我的' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('我已年满 18 周岁'))
  fireEvent.click(screen.getByLabelText('我理解 AI 身份与数据说明'))
  fireEvent.click(continueButton)
  fireEvent.click(await screen.findByRole('button', { name: '我的' }))
  setPassword()
  exportBackup()
}

function expectNoSuccess() {
  expect(screen.queryByText(browserNotice)).not.toBeInTheDocument()
  expect(screen.queryByText(nativeNotice)).not.toBeInTheDocument()
}

describe('profile backup export results', () => {
  it('passes only the encrypted backup to the platform helper and retains browser success copy', async () => {
    vi.mocked(saveEncryptedBackup).mockResolvedValue('downloaded')
    await exportFromProfile()
    expect(await screen.findByRole('status')).toHaveTextContent(browserNotice)
    expect(encryptBackup).toHaveBeenCalledWith(expect.any(String), 'test-passphrase')
    expect(saveEncryptedBackup).toHaveBeenCalledExactlyOnceWith(encrypted)
    expect(screen.getByLabelText('备份密码')).toHaveValue('')
  })

  it('does not claim export success when native sharing is cancelled and clears the password', async () => {
    vi.mocked(saveEncryptedBackup).mockResolvedValue('cancelled')
    await exportFromProfile()
    expect(await screen.findByRole('status')).toHaveTextContent('已取消备份导出')
    expectNoSuccess()
    expect(screen.getByLabelText('备份密码')).toHaveValue('')
  })

  it('replaces previous success when a later export is cancelled after re-entering the password', async () => {
    vi.mocked(saveEncryptedBackup).mockResolvedValueOnce('downloaded').mockResolvedValueOnce('cancelled')
    await exportFromProfile()
    expect(await screen.findByText(browserNotice)).toBeInTheDocument()
    expect(screen.getByLabelText('备份密码')).toHaveValue('')
    setPassword()
    exportBackup()
    expect(await screen.findByText('已取消备份导出')).toBeInTheDocument()
    expectNoSuccess()
    expect(saveEncryptedBackup).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText('备份密码')).toHaveValue('')
  })

  it('describes a native handoff without claiming the receiver saved the file', async () => {
    vi.mocked(saveEncryptedBackup).mockResolvedValue('shared')
    await exportFromProfile()
    expect(await screen.findByRole('status')).toHaveTextContent(nativeNotice)
    expect(screen.getByLabelText('备份密码')).toHaveValue('')
  })

  it('keeps controls busy until the platform helper settles and prevents duplicate exports', async () => {
    let finish!: (result: 'shared') => void
    const pending = new Promise<'shared'>(resolve => { finish = resolve })
    vi.mocked(saveEncryptedBackup).mockReturnValue(pending)
    await exportFromProfile()
    await waitFor(() => expect(saveEncryptedBackup).toHaveBeenCalledOnce())
    const exportButton = screen.getByRole('button', { name: '正在加密导出…' })
    expect(exportButton).toBeDisabled()
    expect(screen.getByLabelText('备份密码')).toBeDisabled()
    expect(screen.getByLabelText('导入备份文件')).toBeDisabled()
    expect(screen.getByRole('button', { name: '清空本机聊天与记忆' })).toBeDisabled()
    fireEvent.click(exportButton)
    expect(saveEncryptedBackup).toHaveBeenCalledOnce()
    expectNoSuccess()
    await act(async () => { finish('shared'); await pending })
    expect(await screen.findByRole('status')).toHaveTextContent(nativeNotice)
    expect(screen.getByLabelText('备份密码')).toHaveValue('')
    expect(screen.getByRole('button', { name: '导出加密备份' })).toBeEnabled()
  })

  it('shows helper errors instead of export success and retains the password for retry', async () => {
    vi.mocked(saveEncryptedBackup).mockRejectedValue(new Error('此设备无法分享备份文件'))
    await exportFromProfile()
    expect(await screen.findByRole('alert')).toHaveTextContent('此设备无法分享备份文件')
    expectNoSuccess()
    expect(screen.getByLabelText('备份密码')).toHaveValue('test-passphrase')
    expect(screen.getByRole('button', { name: '导出加密备份' })).toBeEnabled()
  })

  it('never invokes the helper when encryption fails', async () => {
    vi.mocked(encryptBackup).mockRejectedValue(new Error('备份加密失败'))
    await exportFromProfile()
    expect(await screen.findByRole('alert')).toHaveTextContent('备份加密失败')
    expect(saveEncryptedBackup).not.toHaveBeenCalled()
    expectNoSuccess()
    expect(screen.getByLabelText('备份密码')).toHaveValue('test-passphrase')
  })

  it('requires a fresh valid password after a completed export', async () => {
    vi.mocked(saveEncryptedBackup).mockResolvedValue('downloaded')
    await exportFromProfile()
    await screen.findByText(browserNotice)
    exportBackup()
    expect(await screen.findByRole('alert')).toHaveTextContent('请设置至少 6 位的备份密码')
    expect(saveEncryptedBackup).toHaveBeenCalledOnce()
    expect(encryptBackup).toHaveBeenCalledOnce()
    expectNoSuccess()
  })
})
