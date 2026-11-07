import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { db, finishOnboarding, saveSetting } from './db'
import { defaultOnboardingProfile } from './onboarding'
import { acceptSafetyConsent } from './privacy'
import { streamReply, type StreamRequest } from './chatService'
import { characters, type CharacterId } from './data'

const resume = vi.hoisted(() => ({ callback: () => {} }))
const androidBack = vi.hoisted(() => ({ callback: (): boolean => false }))
vi.mock('./useAndroidBack', () => ({ default: (callback: () => boolean) => { androidBack.callback = callback } }))
vi.mock('./useAppResume', () => ({ default: (callback: () => void) => { resume.callback = callback } }))
vi.mock('./chatService', async () => ({ ...await vi.importActual('./chatService'), streamReply: vi.fn() }))
const stream = vi.mocked(streamReply)
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear(); window.history.replaceState(null, '', '/')
  await db.delete(); await db.open(); stream.mockReset()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll); else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView') })
async function seed(primary: CharacterId = 'lu', selected: CharacterId = primary, consent = true) {
  await finishOnboarding(defaultOnboardingProfile(primary), [])
  await saveSetting('selected', selected)
  if (consent) acceptSafetyConsent()
}
async function setup(primary: CharacterId = 'lu', selected: CharacterId = primary) {
  await seed(primary, selected); const view = render(<App />)
  await screen.findByRole('button', { name: `与${characters.find(c => c.id === primary)!.name}聊天` })
  return view
}
const triggerResume = () => act(() => resume.callback())
const saver = () => screen.getByRole('dialog', { name: /陆听澜|陈奕恒|顾辰泽/ })
async function enter() { await act(async () => { fireEvent.click(screen.getByRole('button', { name: '进入聊天' })) }) }
function deferReply() {
  let request!: StreamRequest, complete!: () => void
  stream.mockImplementationOnce(value => {
    request = value
    return new Promise<void>((resolve, reject) => {
      value.signal?.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true })
      complete = () => { value.onDelta('回复完成'); resolve() }
    })
  })
  return { request: () => request, complete: () => complete() }
}
describe('resume screen saver host integration', () => {
  it('Android system back and the chat arrow return to home, not the resume cover, retaining the chat draft', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: '与陆听澜聊天' }))
    fireEvent.change(screen.getByRole('textbox', { name: '发消息' }), { target: { value: '保留这份草稿' } })
    act(() => { expect(androidBack.callback()).toBe(true) })
    expect(screen.getByRole('button', { name: '与陆听澜聊天' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '进入聊天' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '与陆听澜聊天' }))
    expect(screen.getByRole('textbox', { name: '发消息' })).toHaveValue('保留这份草稿')
    fireEvent.click(screen.getByRole('button', { name: '返回消息' }))
    expect(screen.getByRole('button', { name: '与陆听澜聊天' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '进入聊天' })).not.toBeInTheDocument()
  })
  it('Android back dismisses the screen saver to home and later real resume still shows it', async () => {
    await setup(); fireEvent.click(screen.getByRole('button', { name: '与陆听澜聊天' }))
    triggerResume()
    expect(screen.getByRole('button', { name: '进入聊天' })).toBeInTheDocument()
    act(() => { expect(androidBack.callback()).toBe(true) })
    expect(screen.queryByRole('button', { name: '进入聊天' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '与陆听澜聊天' })).toBeInTheDocument()
    triggerResume(); expect(screen.getByRole('button', { name: '进入聊天' })).toBeInTheDocument()
  })
  it('Android back closes chat settings before leaving the conversation', async () => {
    await setup(); fireEvent.click(screen.getByRole('button', { name: '与陆听澜聊天' }))
    fireEvent.click(screen.getByRole('button', { name: '聊天设置' }))
    expect(screen.getByRole('button', { name: '搜索消息' })).toBeInTheDocument()
    act(() => { expect(androidBack.callback()).toBe(true) })
    expect(screen.queryByRole('button', { name: '搜索消息' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '发消息' })).toBeInTheDocument()
    act(() => { expect(androidBack.callback()).toBe(true) })
    expect(screen.getByRole('button', { name: '与陆听澜聊天' })).toBeInTheDocument()
  })
  it('does not show a screen saver during cold start or loading', async () => {
    await seed(); render(<App />); triggerResume()
    await screen.findByRole('button', { name: '与陆听澜聊天' })
    expect(screen.queryByRole('button', { name: '进入聊天' })).not.toBeInTheDocument()
  })
  it('never bypasses returning-user consent with a screen saver or chat entry', async () => {
    await seed('lu', 'lu', false); render(<App />)
    await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0))
    triggerResume(); expect(screen.queryByRole('button', { name: '进入聊天' })).not.toBeInTheDocument()
  })
  it('keeps the current chat and draft mounted underneath the saver, then enters chat without the settings popup', async () => {
    await setup(); fireEvent.click(screen.getByRole('button', { name: '与陆听澜聊天' }))
    const input = screen.getByRole('textbox', { name: '发消息' })
    fireEvent.change(input, { target: { value: '后台前的草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '聊天设置' }))
    triggerResume()
    expect(within(saver()).getByRole('heading', { name: '陆听澜' })).toBeInTheDocument()
    expect(input.isConnected).toBe(true); expect(input).toHaveValue('后台前的草稿')
    expect(input.closest('[inert]')).not.toBeNull()
    await enter()
    expect(screen.queryByRole('button', { name: '进入聊天' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '发消息' })).toBe(input)
    expect(input).toHaveValue('后台前的草稿')
    expect(screen.queryByRole('button', { name: '搜索消息' })).not.toBeInTheDocument()
    expect(stream).not.toHaveBeenCalled()
  })
  it('enters the main Bot directly from profile and leaves the profile content alive until the button is pressed', async () => {
    const view = await setup(); fireEvent.click(screen.getByRole('button', { name: '我的' }))
    const profile = view.container.querySelector('.profile-screen') || view.container.querySelector('.profile')
    triggerResume(); expect(profile?.isConnected).toBe(true)
    await enter(); expect(screen.getByRole('textbox', { name: '发消息' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '进入聊天' })).not.toBeInTheDocument()
  })
  it('shows the configured primary, not the currently selected companion, and switches safely on entry', async () => {
    await setup('gu', 'chen'); triggerResume()
    expect(within(saver()).getByRole('heading', { name: '顾辰泽' })).toBeInTheDocument()
    expect(within(saver()).getByText('正在阅读')).toBeInTheDocument()
    await enter()
    expect(screen.getByRole('textbox', { name: '发消息' })).toBeInTheDocument()
    expect((await db.settings.get('selected'))?.value).toBe('gu')
  })
  it('shows a real primary reply and does not stop it when opening its chat', async () => {
    const pending = deferReply(); await setup(); fireEvent.click(screen.getByRole('button', { name: '与陆听澜聊天' }))
    fireEvent.change(screen.getByRole('textbox', { name: '发消息' }), { target: { value: '你好' } }); fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(stream).toHaveBeenCalled())
    triggerResume(); expect(within(saver()).getByText('正在回复你的消息')).toBeInTheDocument()
    await enter(); expect(pending.request().signal?.aborted).toBe(false)
    await act(async () => pending.complete())
    expect(screen.getByText('回复完成')).toBeInTheDocument()
  })
  it('stops an active nonprimary reply before switching instead of opening the wrong conversation', async () => {
    const pending = deferReply(); await setup('gu', 'chen')
    fireEvent.click(screen.getByRole('button', { name: '寻找聊天伙伴' }))
    fireEvent.click(screen.getByRole('button', { name: '打开陈奕恒的会话' }))
    fireEvent.change(screen.getByRole('textbox', { name: '发消息' }), { target: { value: '你好' } }); fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await waitFor(() => expect(stream).toHaveBeenCalled())
    triggerResume(); expect(within(saver()).getByRole('heading', { name: '顾辰泽' })).toBeInTheDocument()
    await enter()
    await waitFor(() => expect(screen.queryByRole('button', { name: '正在进入聊天…' })).not.toBeInTheDocument())
    expect(pending.request().signal?.aborted).toBe(true)
    expect((await db.settings.get('selected'))?.value).toBe('gu')
  })
  it('can show the saver on later returns again, without creating chat messages or model requests', async () => {
    await setup(); triggerResume(); await enter(); triggerResume()
    expect(screen.getByRole('button', { name: '进入聊天' })).toBeInTheDocument()
    expect(stream).not.toHaveBeenCalled()
  })
  it('enters regular main Bot chat without any app-data setup dialog or request', async () => {
    await setup(); fireEvent.click(screen.getByRole('button', { name: '与陆听澜聊天' }))
    triggerResume(); await enter()
    fireEvent.click(screen.getByRole('button', { name: '聊天设置' }))
    expect(screen.getByText(/主 Bot 普通聊天会自动查询应用已保存记录/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '读取应用数据' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '主 Bot 应用数据' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(stream).not.toHaveBeenCalled()
    expect(await db.messages.count()).toBe(0)
  })
})
