import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { db, loadLocalData, saveSetting } from './db'
import { acceptSafetyConsent } from './privacy'
import { getLocale, setLocale } from './i18n'

const previousLocale = getLocale()
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
beforeEach(async () => {
  setLocale('zh-CN')
  localStorage.clear(); sessionStorage.clear()
  await db.delete(); await db.open()
  await saveSetting('onboarded', true)
  await saveSetting('selected', 'chen')
  acceptSafetyConsent()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); setLocale(previousLocale)
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

describe('moments and reminders navigation', () => {
  it('replaces the bottom Moments tab with Reminders and returns from its settings', async () => {
    render(<App />)
    const navigation = await screen.findByRole('navigation')
    expect(within(navigation).queryByRole('button', { name: '朋友圈' })).toBeNull()
    fireEvent.click(within(navigation).getByRole('button', { name: '提醒' }))
    expect(screen.getByRole('heading', { name: '今日提醒' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '今日轻量事件' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /主动提醒设置/ }))
    expect(screen.getByRole('heading', { name: '角色主动消息' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '← 返回提醒' }))
    expect(screen.getByRole('heading', { name: '今日提醒' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation')).getByRole('button', { name: '提醒' })).toHaveClass('active')
  })

  it('opens a role-scoped feed beside the game, preserves drafts on back, and switches private chats to the feed owner', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '与陈奕恒聊天' }))
    const input = screen.getByRole('textbox', { name: '发消息' })
    fireEvent.change(input, { target: { value: '原来的草稿' } })
    const momentsButton = screen.getByRole('button', { name: '朋友圈' })
    expect(momentsButton.previousElementSibling).toHaveTextContent('猜拳')
    fireEvent.click(momentsButton)
    const feed = screen.getByRole('region', { name: '角色朋友圈' })
    expect(within(feed).getByText('陈奕恒的朋友圈')).toBeInTheDocument()
    expect(within(feed).queryByRole('region', { name: '今日轻量事件' })).toBeNull()
    await within(feed).findByRole('button', { name: '私聊陈奕恒' })
    expect(within(feed).queryByRole('button', { name: '私聊陆听澜' })).toBeNull()
    fireEvent.click(within(feed).getByRole('button', { name: '返回聊天' }))
    expect(screen.queryByRole('region', { name: '角色朋友圈' })).toBeNull()
    expect(input).toHaveValue('原来的草稿')
    fireEvent.click(momentsButton)
    const nextFeed = screen.getByRole('region', { name: '角色朋友圈' })
    fireEvent.click(within(nextFeed).getByRole('button', { name: '顾辰泽' }))
    expect(within(nextFeed).getByText('顾辰泽的朋友圈')).toBeInTheDocument()
    expect(within(nextFeed).queryByRole('button', { name: '私聊陈奕恒' })).toBeNull()
    fireEvent.click(await within(nextFeed).findByRole('button', { name: '私聊顾辰泽' }))
    expect(screen.queryByRole('region', { name: '角色朋友圈' })).toBeNull()
    expect((screen.getByRole('textbox', { name: '发消息' }) as HTMLInputElement).value).toContain('我看到你的动态了')
    await waitFor(async () => expect((await loadLocalData()).settings.selected).toBe('gu'))
    expect(await db.messages.count()).toBe(0)
  })

  it('opens reminder topics as an editable chat draft without sending', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '提醒' }))
    const topic = screen.getByRole('region', { name: '今日轻量事件' })
    const choices = topic.querySelectorAll('.daily-event-choices button')
    fireEvent.click(choices[0])
    expect(screen.getByRole('textbox', { name: '发消息' }).getAttribute('value')).not.toBe('')
    expect(screen.getByRole('button', { name: '朋友圈' })).toBeInTheDocument()
    expect(await db.messages.count()).toBe(0)
  })
})
