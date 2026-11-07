import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import ChatPanel, { type ChatPanelProps } from './ChatPanel'
import { characters } from './data'
import { copyMessageText } from './messageClipboard'
import { MESSAGE_LONG_PRESS_MS } from './useMessageLongPress'
import type { ChatMessage } from './chatService'
vi.mock('./messageClipboard', () => ({ copyMessageText: vi.fn() }))
const copy = vi.mocked(copyMessageText)
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
class TestPointerEvent extends MouseEvent {
  pointerId: number; isPrimary: boolean; pointerType: string
  constructor(type: string, init: MouseEventInit & { pointerId?: number; isPrimary?: boolean; pointerType?: string } = {}) {
    super(type, init); this.pointerId = init.pointerId ?? 1; this.isPrimary = init.isPrimary ?? true; this.pointerType = init.pointerType ?? 'touch'
  }
}
const first: ChatMessage = { id: 1, from: 'user', text: '第一行\n第二行🙂', time: '17:33', status: 'sent' }
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.useFakeTimers(); vi.stubGlobal('PointerEvent', TestPointerEvent); copy.mockReset(); copy.mockResolvedValue(undefined)
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll); else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView') })
function setup(extra: Partial<ChatPanelProps> = {}) {
  const props: ChatPanelProps = { character: characters[0], messages: [first], draft: '保留草稿', setDraft: vi.fn(), send: vi.fn(async () => {}), saveMemory: vi.fn(async () => {}), withdraw: vi.fn(async () => {}), close: vi.fn(), stop: vi.fn(), replying: false, error: '', demo: true, openGame: vi.fn(), openStory: vi.fn(), ...extra }
  const view = render(<ChatPanel {...props} />)
  const bubble = (id = 1) => view.container.querySelector<HTMLElement>(`[data-message-id="${id}"] .bubble`)!
  return { ...view, props, bubble }
}
const down = (bubble: HTMLElement) => fireEvent.pointerDown(bubble, { clientX: 20, clientY: 30, pointerId: 1, isPrimary: true, pointerType: 'touch', button: 0 })
function hold(bubble: HTMLElement) { down(bubble); act(() => vi.advanceTimersByTime(MESSAGE_LONG_PRESS_MS)); fireEvent.pointerUp(bubble, { pointerId: 1 }) }
describe('long-press message actions and explicit copy', () => {
  it('does not open actions on a normal tap or short press', () => {
    const { bubble } = setup(); down(bubble()); act(() => vi.advanceTimersByTime(MESSAGE_LONG_PRESS_MS - 1)); fireEvent.pointerUp(bubble()); fireEvent.click(bubble(), { detail: 1 }); act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByRole('group', { name: '消息操作菜单' })).not.toBeInTheDocument(); expect(copy).not.toHaveBeenCalled()
  })
  it('opens Copy, Quote, Remember and Withdraw only after a complete long press', () => {
    const { bubble, props } = setup(); down(bubble()); act(() => vi.advanceTimersByTime(MESSAGE_LONG_PRESS_MS - 1)); expect(screen.queryByText('复制')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1)); fireEvent.pointerUp(bubble())
    expect(screen.getByRole('button', { name: '复制消息 1' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: '引用消息 1' })).toBeInTheDocument(); expect(screen.getByText('记住这条')).toBeInTheDocument(); expect(screen.getByText('撤回')).toBeInTheDocument()
    expect(props.send).not.toHaveBeenCalled(); expect(props.saveMemory).not.toHaveBeenCalled()
  })
  it.each(['move', 'cancel', 'leave', 'scroll', 'blur', 'second-pointer'])('cancels a pending long press on %s', reason => {
    const { bubble } = setup(); down(bubble()); act(() => vi.advanceTimersByTime(100))
    if (reason === 'move') fireEvent.pointerMove(bubble(), { pointerId: 1, clientX: 40, clientY: 30 })
    if (reason === 'cancel') fireEvent.pointerCancel(bubble())
    if (reason === 'leave') fireEvent.pointerLeave(bubble())
    if (reason === 'scroll') fireEvent.scroll(screen.getByLabelText('聊天记录'))
    if (reason === 'blur') fireEvent.blur(window)
    if (reason === 'second-pointer') fireEvent.pointerDown(document.body, { pointerId: 2, isPrimary: false })
    act(() => vi.advanceTimersByTime(1000)); expect(screen.queryByText('复制')).not.toBeInTheDocument()
  })
  it('permits small finger movement but prevents the native context menu', () => {
    const { bubble } = setup(); down(bubble()); fireEvent.pointerMove(bubble(), { pointerId: 1, clientX: 24, clientY: 33 }); act(() => vi.advanceTimersByTime(MESSAGE_LONG_PRESS_MS))
    expect(screen.getByText('复制')).toBeInTheDocument()
    expect(fireEvent.contextMenu(bubble())).toBe(false)
  })
  it.each(['Enter', ' '])('retains accessible keyboard activation with %j and Escape dismissal', key => {
    const { bubble } = setup(); bubble().focus(); fireEvent.keyDown(bubble(), { key })
    const button = screen.getByRole('button', { name: '复制消息 1' }); button.focus(); fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('复制')).not.toBeInTheDocument(); expect(bubble()).toHaveFocus()
  })
  it('dismisses on outside press, and can switch to another message by long press', () => {
    const { bubble } = setup({ messages: [first, { ...first, id: 2, text: '另一条消息' }] }); hold(bubble()); fireEvent.pointerDown(screen.getByLabelText('发消息'))
    expect(screen.queryByText('复制')).not.toBeInTheDocument(); hold(bubble(2)); expect(screen.getByRole('button', { name: '复制消息 2' })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: '复制消息 1' })).not.toBeInTheDocument()
  })
  it.each([{ from: 'user' as const }, { from: 'character' as const }, { from: 'character' as const, localOnly: true, appDataReply: true }])('copies the complete original text for %j without sending or changing the draft', async fields => {
    const { bubble, props } = setup({ messages: [{ ...first, ...fields }] }); hold(bubble())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制消息 1' })) })
    expect(copy).toHaveBeenCalledExactlyOnceWith(first.text); expect(screen.getByText('消息已复制。')).toBeInTheDocument(); expect(screen.queryByText('复制')).not.toBeInTheDocument()
    expect(props.send).not.toHaveBeenCalled(); expect(props.setDraft).not.toHaveBeenCalled(); expect(props.saveMemory).not.toHaveBeenCalled()
  })
  it('reports a copy failure without claiming success and allows retry', async () => {
    const { bubble } = setup(); copy.mockRejectedValueOnce(new Error('denied')); hold(bubble())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制消息 1' })) })
    expect(screen.getByText('复制失败，请重试。')).toBeInTheDocument(); expect(screen.queryByText('消息已复制。')).not.toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制消息 1' })) }); expect(copy).toHaveBeenCalledTimes(2)
  })
  it('prevents duplicate writes while the clipboard is pending and suppresses late notice in another companion', async () => {
    let finish!: () => void; copy.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const view = setup(); hold(view.bubble()); fireEvent.click(screen.getByRole('button', { name: '复制消息 1' })); fireEvent.click(screen.getByRole('button', { name: '复制消息 1' }))
    expect(copy).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: '复制消息 1' })).toBeDisabled()
    view.rerender(<ChatPanel {...view.props} character={characters[1]} messages={[{ ...first, text: '新角色消息' }]} />)
    await act(async () => finish()); expect(screen.queryByText('消息已复制。')).not.toBeInTheDocument(); expect(copy).toHaveBeenCalledWith(first.text)
  })
  it('does not carry pending gestures or open menus across role changes, withdrawal or unmount', () => {
    const view = setup(); down(view.bubble()); view.rerender(<ChatPanel {...view.props} character={characters[1]} />); act(() => vi.advanceTimersByTime(1000)); expect(screen.queryByText('复制')).not.toBeInTheDocument()
    hold(view.bubble()); view.rerender(<ChatPanel {...view.props} character={characters[1]} messages={[{ ...first, withdrawn: true, text: '' }]} />); expect(screen.queryByText('复制')).not.toBeInTheDocument()
    view.rerender(<ChatPanel {...view.props} />); down(view.bubble()); view.unmount(); act(() => vi.advanceTimersByTime(1000)); expect(copy).not.toHaveBeenCalled()
  })
  it('does not intercept media controls, and does not offer copying empty attachments or streaming/withdrawn messages', () => {
    const attachment = { dataUrl: 'data:audio/webm;base64,aGVsbG8=', mimeType: 'audio/webm', name: 'voice' }
    const view = setup({ messages: [{ ...first, text: '', kind: 'audio', attachment }, { ...first, id: 2, status: 'sending' }, { ...first, id: 3, withdrawn: true, text: '' }] })
    down(view.container.querySelector('audio')!); act(() => vi.advanceTimersByTime(1000)); expect(screen.queryByRole('group', { name: '消息操作菜单' })).not.toBeInTheDocument()
    hold(view.bubble()); expect(screen.getByRole('button', { name: '引用消息 1' })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: '复制消息 1' })).not.toBeInTheDocument()
    fireEvent.pointerDown(document.body); hold(view.bubble(2)); hold(view.bubble(3)); expect(screen.queryByRole('group', { name: '消息操作菜单' })).not.toBeInTheDocument(); expect(copy).not.toHaveBeenCalled()
  })
  it('keeps quote and withdrawal actions functional and closes the menu after selection', () => {
    const { bubble, props } = setup(); hold(bubble()); fireEvent.click(screen.getByRole('button', { name: '引用消息 1' })); expect(screen.getByText('引用：', { exact: false })).toBeInTheDocument(); expect(screen.queryByText('复制')).not.toBeInTheDocument()
    hold(bubble()); fireEvent.click(screen.getByText('撤回')); expect(props.withdraw).toHaveBeenCalledWith(1); expect(screen.queryByText('复制')).not.toBeInTheDocument()
  })
})
