import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { acceptSafetyConsent } from './privacy'
import { db, loadLocalData, saveSetting } from './db'

beforeEach(async () => { localStorage.clear(); sessionStorage.clear(); await db.delete(); await db.open() })
afterEach(cleanup)

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
    expect(screen.getByText(/本机优先保存，外部模型另有传输/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /遇见 TA/ })).toBeDisabled()
    expect(screen.getByText(/记录保存在当前设备/)).toBeInTheDocument()
  })

  it('lets previously onboarded users add preferences without restarting or switching characters', async () => {
    await saveSetting('onboarded', true)
    await saveSetting('selected', 'chen')
    acceptSafetyConsent()
    render(<App />)
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
    await screen.findByRole('button', { name: /遇见 TA/ })
    fireEvent.click(screen.getByLabelText('我已年满 18 周岁'))
    fireEvent.click(screen.getByLabelText('我理解 AI 身份与数据说明'))
    fireEvent.click(screen.getByRole('button', { name: /遇见 TA/ }))
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
    expect((await loadLocalData()).settings.onboarded).not.toBe(true)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '完成引导' })) })
    await waitFor(() => expect(screen.getAllByText('陈奕恒')).toHaveLength(2))
    const data = await loadLocalData()
    expect(data.settings.onboardingProfile).toMatchObject({ userName: '小雨', characterName: '阿恒', adultEnabled: false })
    expect(data.memories.some(memory => memory.category === 'relationship' && memory.state === 'confirmed')).toBe(true)
    expect(data.conversations.chen).toHaveLength(2)
    expect((await loadLocalData()).settings.selected).toBe('chen')
    expect(localStorage.getItem('aily-demo-state')).toBeNull()
  })
})
