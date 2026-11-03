import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import * as storage from './db'
import { db, loadLocalData, saveSetting } from './db'

beforeEach(async () => { localStorage.clear(); sessionStorage.clear(); await db.delete(); await db.open() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function confirmSafetyConsent(name = '确认并继续') {
  expect(await screen.findByRole('button', { name })).toBeDisabled()
  fireEvent.click(screen.getByLabelText('我已年满 18 周岁'))
  expect(screen.getByRole('button', { name })).toBeDisabled()
  fireEvent.click(screen.getByLabelText('我理解 AI 身份与数据说明'))
  fireEvent.click(screen.getByRole('button', { name }))
}

describe('Aily core journey', () => {
  it('keeps application tabs locked until journal persistence settles', async () => {
    await saveSetting('onboarded', true)
    await storage.saveMemory({ id: 'event', characterId: 'lu', category: 'relationship', text: '我们完成海边故事', confirmedAt: '2026-11-01T10:00:00Z' })
    render(<App />)
    await confirmSafetyConsent()
    fireEvent.click(await screen.findByRole('button', { name: '回忆' }))
    fireEvent.click(screen.getByRole('button', { name: '周记月记' }))
    fireEvent.click(screen.getByRole('button', { name: '预览并确认' }))
    const original = storage.saveMemory
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    const save = vi.spyOn(storage, 'saveMemory').mockImplementationOnce(async memory => { await pending; return original(memory) })
    fireEvent.click(screen.getByRole('button', { name: '确认保存周记' }))
    expect(screen.getByRole('button', { name: '消息' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '消息' }))
    expect(screen.getByRole('button', { name: '确认保存周记' })).toBeInTheDocument()
    await act(async () => { finish(); await pending })
    await waitFor(() => expect(screen.getByRole('button', { name: '消息' })).toBeEnabled())
    expect(save).toHaveBeenCalledTimes(1)
    expect((await loadLocalData()).memories).toHaveLength(2)
  })
  it('requires new disclosure even when a previous profile is already onboarded', async () => {
    await saveSetting('onboarded', true)
    render(<App />)
    expect(await screen.findByRole('button', { name: '确认并继续' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /去找他/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('我已年满 18 周岁'))
    fireEvent.click(screen.getByLabelText('我理解 AI 身份与数据说明'))
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }))
    expect(await screen.findByRole('button', { name: /去找他/ })).toBeInTheDocument()
  })

  it('introduces the memory-first value proposition after loading storage', async () => {
    render(<App />)
    expect(await screen.findByText(/会生长/)).toBeInTheDocument()
    expect(screen.getByText(/来自未来的一条回忆 · 场景示例/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '首次引导进度' })).toHaveAttribute('max', '9')
    expect(screen.getByRole('button', { name: '遇见 TA' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /去找他/ })).not.toBeInTheDocument()
    expect(screen.getByText(/本机优先保存，外部模型另有传输 · 记录保存在当前设备/)).toBeInTheDocument()
    expect(screen.getByText(/第 1 \/ 9 步 · 初遇/)).toBeInTheDocument()
    expect((await loadLocalData()).settings.onboarded).not.toBe(true)
  })

  it('lets previously onboarded users add preferences without restarting or switching characters', async () => {
    await saveSetting('onboarded', true)
    await saveSetting('selected', 'chen')
    render(<App />)
    await confirmSafetyConsent()
    fireEvent.click(await screen.findByRole('button', { name: '我的' }))
    fireEvent.click(screen.getByRole('button', { name: '修改称呼与互动偏好' }))
    expect(screen.getByLabelText('你想怎么称呼 TA')).toHaveValue('陈奕恒')
    fireEvent.change(screen.getByLabelText('你的名字或昵称'), { target: { value: '雨雨' } })
    fireEvent.click(screen.getByRole('button', { name: '保存偏好' }))
    await screen.findByRole('button', { name: '修改称呼与互动偏好' })
    expect(screen.getByRole('heading', { name: '雨雨' })).toBeInTheDocument()
    expect((await loadLocalData()).settings.selected).toBe('chen')
  })

  it('persists character choice in IndexedDB instead of a duplicate localStorage blob', async () => {
    render(<App />)
    await confirmSafetyConsent('遇见 TA')
    fireEvent.click(screen.getByRole('button', { name: /陈奕恒/ }))
    fireEvent.click(screen.getByRole('button', { name: /开始我们的故事/ }))
    expect(screen.getByRole('heading', { name: '先听听我的自我介绍' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    fireEvent.change(screen.getByLabelText('你的名字或昵称'), { target: { value: '小雨' } })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    fireEvent.change(screen.getByLabelText('你想怎么称呼 TA'), { target: { value: '阿恒' } })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    fireEvent.click(screen.getByRole('button', { name: '发送试聊' }))
    fireEvent.click(screen.getByRole('button', { name: '称呼没问题，继续' }))
    expect(screen.getByText(/必要的聊天片段、相关记忆与互动偏好会直发 DeepSeek/)).toBeInTheDocument()
    expect(screen.getByText(/API Key 只保留在本次浏览器会话，不包含在备份内/)).toBeInTheDocument()
    expect((await loadLocalData()).settings.onboarded).not.toBe(true)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '完成引导' })) })
    expect(screen.queryByRole('button', { name: '确认并继续' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('陈奕恒')).toHaveLength(2))
    const data = await loadLocalData()
    expect(data.settings.onboardingProfile).toMatchObject({ userName: '小雨', characterName: '阿恒', adultEnabled: false })
    expect(data.memories.some(memory => memory.category === 'relationship' && memory.state === 'confirmed')).toBe(true)
    expect(data.conversations.chen).toHaveLength(2)
    expect((await loadLocalData()).settings.selected).toBe('chen')
    expect(localStorage.getItem('aily-demo-state')).toBeNull()
  })
})
