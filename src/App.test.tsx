import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { db, loadLocalData, saveSetting } from './db'
import { acceptSafetyConsent, hasSafetyConsent } from './privacy'

beforeEach(async () => { localStorage.clear(); sessionStorage.clear(); await db.delete(); await db.open() })
afterEach(cleanup)

async function acceptDisclosure(name = '确认并继续') {
  expect(await screen.findByRole('button', { name })).toBeDisabled()
  fireEvent.click(screen.getByLabelText('我已年满 18 周岁'))
  expect(screen.getByRole('button', { name })).toBeDisabled()
  fireEvent.click(screen.getByLabelText('我理解 AI 身份与数据说明'))
  expect(screen.getByRole('button', { name })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name }))
  expect(hasSafetyConsent()).toBe(true)
}

describe('Aily core journey', () => {
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
    expect(screen.getByText(/第 1 \/ 9 步 · 初遇/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /遇见 TA/ })).toBeDisabled()
    expect(screen.getByText(/AI 角色互动.*记录保存在当前设备/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /去找他/ })).not.toBeInTheDocument()
    expect((await loadLocalData()).settings.onboarded).not.toBe(true)
  })

  it('lets previously onboarded users add preferences without restarting or switching characters', async () => {
    acceptSafetyConsent()
    await saveSetting('onboarded', true)
    await saveSetting('selected', 'chen')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '我的' }))
    expect(screen.queryByRole('button', { name: '确认并继续' })).not.toBeInTheDocument()
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
    await acceptDisclosure('遇见 TA')
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
    await waitFor(() => expect(screen.getAllByText('陈奕恒')).toHaveLength(2))
    expect(screen.queryByRole('button', { name: '确认并继续' })).not.toBeInTheDocument()
    expect(hasSafetyConsent()).toBe(true)
    const data = await loadLocalData()
    expect(data.settings.onboardingProfile).toMatchObject({ userName: '小雨', characterName: '阿恒', adultEnabled: false })
    expect(data.memories.some(memory => memory.category === 'relationship' && memory.state === 'confirmed')).toBe(true)
    expect(data.conversations.chen).toHaveLength(2)
    expect((await loadLocalData()).settings.selected).toBe('chen')
    expect(localStorage.getItem('aily-demo-state')).toBeNull()
  })
})
