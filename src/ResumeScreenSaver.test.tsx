import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ResumeScreenSaver, { type ResumeScreenSaverProps } from './ResumeScreenSaver'
import { characters } from './data'
import { resumeScenes } from './resumeScenes'
const currentScene = (character = characters[0]) => resumeScenes[character.id].find(scene => scene.id === screen.getByRole('dialog').getAttribute('data-scene'))!
import { setLocale } from './i18n'

const extraNodes: HTMLElement[] = []
const extraListeners: (() => void)[] = []
const props = (overrides: Partial<ResumeScreenSaverProps> = {}): ResumeScreenSaverProps => ({
  character: characters[0], name: '主 Bot', replying: false, entering: false, error: '', onEnter: vi.fn(), ...overrides,
})
const appendRoot = (attributes: Record<string, string> = {}) => {
  const node = document.createElement('div')
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value)
  document.body.append(node)
  extraNodes.push(node)
  return node
}

beforeEach(() => { setLocale('zh-CN') })
afterEach(() => {
  cleanup()
  extraListeners.splice(0).forEach(remove => remove())
  extraNodes.splice(0).forEach(node => node.remove())
  setLocale('zh-CN')
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ResumeScreenSaver', () => {
  it('changes the presentation scene on the next return without repeating it or adding actions', () => {
    const view = render(<ResumeScreenSaver {...props()} />)
    const first = screen.getByRole('dialog').getAttribute('data-scene')
    view.unmount()
    render(<ResumeScreenSaver {...props()} />)
    expect(screen.getByRole('dialog').getAttribute('data-scene')).not.toBe(first)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(document.querySelector('.resume-screensaver-scene-icon svg')).not.toBeNull()
  })
  it('portals an accessible full-screen cover to body with one explicit enter action', () => {
    const onEnter = vi.fn()
    const view = render(<ResumeScreenSaver {...props({ onEnter })} />)
    const cover = screen.getByRole('dialog', { name: '主 Bot' })
    expect(cover.parentElement).toBe(document.body)
    expect(view.container).not.toContainElement(cover)
    expect(cover).toHaveAttribute('aria-modal', 'true')
    expect(cover).not.toHaveAttribute('inert')
    expect(cover).not.toHaveAttribute('aria-hidden')
    expect(document.body).not.toHaveAttribute('inert')
    expect(within(cover).getByRole('heading', { name: '主 Bot' })).toBeInTheDocument()
    expect(within(cover).getAllByRole('button')).toHaveLength(1)
    expect(screen.getByText(characters[0].avatar)).toHaveAttribute('class', 'resume-screensaver-avatar')
    fireEvent.click(screen.getByRole('button', { name: '进入聊天' }))
    expect(onEnter).toHaveBeenCalledOnce()
  })

  it.each(characters)('shows a role-appropriate scene for $name with an explicit non-human demo disclaimer', character => {
    render(<ResumeScreenSaver {...props({ character })} />)
    expect(screen.getByText(currentScene(character).activity)).toBeInTheDocument()
    expect(screen.getByText('AI角色场景 · 本机演示/非真人')).toBeInTheDocument()
    expect(screen.getByText('角色设定展示，不代表真实后台任务。')).toBeInTheDocument()
    expect(screen.queryByText('正在回复你的消息')).not.toBeInTheDocument()
    expect(screen.queryByText('当前会话状态')).not.toBeInTheDocument()
  })

  it('uses only real replying props for conversation status, never a static scene', () => {
    const view = render(<ResumeScreenSaver {...props({ replying: true })} />)
    expect(screen.getByText('当前会话状态')).toBeInTheDocument()
    expect(screen.getByText('正在回复你的消息')).toBeInTheDocument()
    expect(screen.queryByText(characters[0].status)).not.toBeInTheDocument()
    expect(screen.queryByText('AI角色场景 · 本机演示/非真人')).not.toBeInTheDocument()
    view.rerender(<ResumeScreenSaver {...props({ replying: false })} />)
    expect(screen.getByText(currentScene().activity)).toBeInTheDocument()
    expect(screen.queryByText('正在回复你的消息')).not.toBeInTheDocument()
  })

  it('disables the enter button with a spinner while entering and exposes errors without changing them', () => {
    const onEnter = vi.fn(), error = '进入失败 / Original error'
    const view = render(<ResumeScreenSaver {...props({ entering: true, error, onEnter })} />)
    const button = screen.getByRole('button', { name: '正在进入聊天…' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button.querySelector('.resume-screensaver-spinner')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent(error)
    expect(button).toHaveAttribute('aria-describedby', screen.getByRole('alert').id)
    fireEvent.click(button)
    expect(onEnter).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveFocus()
    view.rerender(<ResumeScreenSaver {...props({ onEnter })} />)
    expect(screen.getByRole('button', { name: '进入聊天' })).toBeEnabled()
    expect(screen.getByRole('button')).toHaveFocus()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button').querySelector('.resume-screensaver-spinner')).toBeNull()
  })

  it('localizes scene copy live in English without changing the selected scene or supplied errors', () => {
    const view = render(<ResumeScreenSaver {...props({ error: '原始错误' })} />)
    act(() => setLocale('en'))
    expect(screen.getByText('Welcome back')).toBeInTheDocument()
    expect(screen.getByText('AI character scene · Local demo / Not a real person')).toBeInTheDocument()
    expect(screen.getByText('A character scene, not a real background task.')).toBeInTheDocument()
    expect(screen.getByText(currentScene().english)).toBeInTheDocument()
    expect(screen.getByText('Device time')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('原始错误')
    expect(screen.getByRole('button', { name: 'Enter chat' })).toBeInTheDocument()
    view.rerender(<ResumeScreenSaver {...props({ replying: true, entering: true })} />)
    expect(screen.getByText('Current conversation status')).toBeInTheDocument()
    expect(screen.getByText('Replying to your message')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Entering chat…' })).toBeDisabled()
  })

  it('falls back to the character name for an empty display name', () => {
    render(<ResumeScreenSaver {...props({ name: '  ' })} />)
    expect(screen.getByRole('dialog', { name: characters[0].name })).toBeInTheDocument()
  })

  it('preserves background DOM identity and drafts, and exactly restores prior inert/aria-hidden states', () => {
    const plain = appendRoot()
    const existing = appendRoot({ inert: 'already-inert', 'aria-hidden': 'false' })
    const hidden = appendRoot({ 'aria-hidden': 'true' })
    const propertyOnly = appendRoot()
    Object.defineProperty(propertyOnly, 'inert', { value: false, writable: true, configurable: true })
    const background = render(<textarea aria-label="草稿" defaultValue="未提交草稿" />, { container: plain })
    const input = background.getByRole('textbox') as HTMLTextAreaElement
    input.value = '未提交草稿，仍在编辑'
    input.focus()
    const blur = vi.spyOn(input, 'blur')
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const view = render(<ResumeScreenSaver {...props()} />)
    for (const node of [plain, existing, hidden, propertyOnly, view.container]) {
      expect(node.inert).toBe(true)
      expect(node).toHaveAttribute('aria-hidden', 'true')
    }
    expect(blur).toHaveBeenCalledOnce()
    expect(screen.getByRole('button')).toHaveFocus()
    expect(plain.querySelector('textarea')).toBe(input)
    expect(input.value).toBe('未提交草稿，仍在编辑')
    expect(document.body.style.overflow).toBe('hidden')
    view.unmount()
    expect(plain).not.toHaveAttribute('inert')
    expect(plain).not.toHaveAttribute('aria-hidden')
    expect(Object.hasOwn(plain, 'inert')).toBe(false)
    expect(existing).toHaveAttribute('inert', 'already-inert')
    expect(existing).toHaveAttribute('aria-hidden', 'false')
    expect(hidden).not.toHaveAttribute('inert')
    expect(hidden).toHaveAttribute('aria-hidden', 'true')
    expect(propertyOnly.inert).toBe(false)
    expect(propertyOnly).not.toHaveAttribute('inert')
    expect(plain.querySelector('textarea')).toBe(input)
    expect(input.value).toBe('未提交草稿，仍在编辑')
    expect(input).not.toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
    document.body.style.overflow = originalOverflow
  })

  it('isolates new background portals through MutationObserver and restores their original attributes', async () => {
    const view = render(<ResumeScreenSaver {...props()} />)
    let portal: HTMLElement | undefined
    await act(async () => { portal = appendRoot({ 'aria-hidden': 'false', inert: 'new-portal-inert' }) })
    expect(portal).toHaveAttribute('inert', '')
    expect(portal).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('dialog')).not.toHaveAttribute('inert')
    view.unmount()
    expect(portal).toHaveAttribute('inert', 'new-portal-inert')
    expect(portal).toHaveAttribute('aria-hidden', 'false')
    let later: HTMLElement | undefined
    await act(async () => { later = appendRoot() })
    expect(later).not.toHaveAttribute('inert')
    expect(later).not.toHaveAttribute('aria-hidden')
  })

  it('blocks older DesktopTools-style capture keys and bubble focus traps, and contains Tab/Escape', () => {
    const background = appendRoot()
    const input = document.createElement('input')
    background.append(input)
    const oldKey = vi.fn(), oldFocus = vi.fn(() => input.focus()), hiddenClosed = vi.fn()
    const closeOnEscape = (event: KeyboardEvent) => { oldKey(event); if (event.key === 'Escape') hiddenClosed() }
    document.addEventListener('keydown', closeOnEscape, true)
    document.addEventListener('focusin', oldFocus)
    extraListeners.push(() => document.removeEventListener('keydown', closeOnEscape, true), () => document.removeEventListener('focusin', oldFocus))
    const onEnter = vi.fn()
    const view = render(<ResumeScreenSaver {...props({ onEnter })} />)
    const button = screen.getByRole('button')
    expect(button).toHaveFocus()
    expect(oldFocus).not.toHaveBeenCalled()
    input.focus() // JSDOM permits focusing inert nodes; the capture guard still redirects.
    expect(button).toHaveFocus()
    expect(oldFocus).not.toHaveBeenCalled()
    for (const shiftKey of [false, true]) {
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
      button.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(button).toHaveFocus()
    }
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    button.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(onEnter).not.toHaveBeenCalled()
    expect(hiddenClosed).not.toHaveBeenCalled()
    expect(oldKey).not.toHaveBeenCalled()
    view.unmount()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(hiddenClosed).toHaveBeenCalledOnce()
  })

  it('keeps keyboard focus contained while entering disables the unique button', () => {
    const view = render(<ResumeScreenSaver {...props({ entering: true })} />)
    const cover = screen.getByRole('dialog')
    fireEvent.keyDown(cover, { key: 'Tab' })
    expect(cover).toHaveFocus()
    fireEvent.keyDown(cover, { key: 'Tab', shiftKey: true })
    expect(cover).toHaveFocus()
    view.rerender(<ResumeScreenSaver {...props()} />)
    expect(screen.getByRole('button')).toHaveFocus()
  })

  it('updates only the device clock and removes its interval, observer, and global capture handlers on unmount', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date('2026-11-07T10:24:00Z'))
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
    const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener')
    const storage = vi.spyOn(Storage.prototype, 'getItem')
    const fetch = vi.spyOn(globalThis, 'fetch')
    const view = render(<ResumeScreenSaver {...props()} />)
    const time = document.querySelector('.resume-screensaver-clock time')!
    const sceneBefore = screen.getByRole('dialog').getAttribute('data-scene')
    expect(time).toHaveAttribute('datetime', '2026-11-07T10:24:00.000Z')
    expect(vi.getTimerCount()).toBe(1)
    act(() => vi.advanceTimersByTime(60_000))
    expect(time).toHaveAttribute('datetime', '2026-11-07T10:25:00.000Z')
    expect(screen.getByRole('dialog')).toHaveAttribute('data-scene', sceneBefore)
    expect(screen.getByText(currentScene().activity)).toBeInTheDocument()
    expect(storage).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    const focusHandler = add.mock.calls.find(([name]) => name === 'focusin')?.[1]
    const keyHandler = add.mock.calls.find(([name]) => name === 'keydown')?.[1]
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(disconnect).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith('focusin', focusHandler, true)
    expect(remove).toHaveBeenCalledWith('keydown', keyHandler, true)
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
