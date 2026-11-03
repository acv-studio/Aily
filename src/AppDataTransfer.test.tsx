import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import * as localData from './db'
import { acceptSafetyConsent } from './privacy'

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear()
  await localData.db.delete(); await localData.db.open()
  await localData.saveSetting('onboarded', true)
  acceptSafetyConsent()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function openProfile() {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: '跳过，进入消息' }))
  fireEvent.click(await screen.findByRole('button', { name: '我的' }))
  expect(screen.getByRole('region', { name: '本机聊天与记忆' })).toBeInTheDocument()
}
function chooseLegacyBackup() {
  const raw = JSON.stringify({ version: 2, conversations: {}, memories: [], summaries: [], settings: { onboarded: true, selected: 'chen' } })
  const file = new File([raw], 'legacy-backup.json', { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(raw) })
  fireEvent.change(screen.getByLabelText('导入备份文件'), { target: { files: [file] } })
}

describe('backup refresh errors in the ready app', () => {
  it('shows a retryable read error after a successful import instead of silently retaining stale UI', async () => {
    await openProfile()
    const initialize = vi.spyOn(localData, 'initializeLocalData').mockRejectedValueOnce(new Error('reload unavailable'))
    chooseLegacyBackup()
    fireEvent.click(screen.getByRole('button', { name: '导入并替换本机数据' }))
    fireEvent.click(screen.getByRole('button', { name: '确认替换' }))
    expect(await screen.findByRole('status')).toHaveTextContent('备份已导入')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('无法读取本机数据')
    expect(alert).not.toHaveTextContent('未覆盖任何记录')
    // The transaction succeeded; only the follow-up UI refresh failed.
    expect((await localData.loadLocalData()).settings.selected).toBe('chen')
    expect(screen.getByRole('heading', { name: '我的 Aily' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试读取' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: /主角色\s*陈奕恒/ })).toBeInTheDocument())
    expect(initialize).toHaveBeenCalledTimes(2)
  })

  it('shows a retryable refresh error after clear and reaches onboarding when retry succeeds', async () => {
    await openProfile()
    const initialize = vi.spyOn(localData, 'initializeLocalData').mockRejectedValueOnce(new Error('reload unavailable'))
    fireEvent.click(screen.getByRole('button', { name: '清空本机聊天与记忆' }))
    fireEvent.click(screen.getByRole('button', { name: '确认清空' }))
    expect(await screen.findByRole('status')).toHaveTextContent('已清空')
    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取本机数据')
    expect((await localData.loadLocalData()).settings.onboarded).not.toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '重试读取' }))
    expect(await screen.findByRole('button', { name: /遇见 TA/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '本机聊天与记忆' })).not.toBeInTheDocument()
    expect(initialize).toHaveBeenCalledTimes(2)
  })
})
