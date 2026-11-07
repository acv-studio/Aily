import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPanel, { type ChatPanelProps } from './ChatPanel'
import { characters } from './data'

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll); else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView') })
function setup(extra: Partial<ChatPanelProps> = {}) {
  const props: ChatPanelProps = { character: characters[0], messages: [], draft: '总结我的收支', setDraft: vi.fn(), send: vi.fn(async () => {}), saveMemory: vi.fn(async () => {}), withdraw: vi.fn(async () => {}), close: vi.fn(), stop: vi.fn(), replying: false, error: '', demo: false, openGame: vi.fn(), openStory: vi.fn(), isPrimary: true, appDataIdentity: () => ({ role: 'lu', primaryId: 'lu', temporary: false, endpoint: 'https://example.com/v1/messages', model: 'test' }), ...extra }
  return { ...render(<ChatPanel {...props} />), props }
}
const automaticNotice = '主 Bot 普通聊天会自动查询应用已保存记录，并将相关数据发送给你配置的模型；临时会话和非主 Bot 不读取。'
describe('automatic app-data chat UX', () => {
  it.each([{}, { isPrimary: false }, { temporary: true }])('shows a noninteractive automatic-read notice without setup for %j', extra => {
    const { props } = setup(extra)
    fireEvent.click(screen.getByRole('button', { name: '聊天设置' }))
    const notice = screen.getByText(automaticNotice)
    expect(notice.tagName).toBe('P')
    expect(notice.closest('button')).toBeNull()
    expect(screen.queryByRole('button', { name: '读取应用数据' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByLabelText('发消息').closest('.chat-controls')).not.toHaveAttribute('inert')
    expect(props.send).not.toHaveBeenCalled()
    expect(props.setDraft).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '更多发送选项' }))
    expect(screen.queryByRole('button', { name: '读取应用数据' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '经期记录' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '送礼物' })).toBeInTheDocument()
  })
  it('sends an app-data question through regular chat without a preview or confirmation', async () => {
    const { props } = setup()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })) })
    expect(props.send).toHaveBeenCalledExactlyOnceWith({ replyToId: undefined, attachment: undefined, kind: undefined })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
  it('retries failed data requests directly without reopening a manual authorization dialog', async () => {
    const { props } = setup({ messages: [{ id: 7, from: 'user', text: '总结我的收支', time: '', status: 'failed', appDataRequest: true }] })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '回复未完成 · 重试' })) })
    expect(props.send).toHaveBeenCalledExactlyOnceWith({ retryId: 7 })
    expect(props.setDraft).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it.each(['经期记录', '送礼物'])('preserves the %s modal and closes it on resume without stopping chat', name => {
    const view = setup({ resumeSignal: 0 })
    fireEvent.click(screen.getByRole('button', { name: '更多发送选项' }))
    fireEvent.click(screen.getByRole('button', { name }))
    expect(screen.getByRole('dialog', { name })).toBeInTheDocument()
    expect(screen.getByLabelText('发消息').closest('.chat-controls')).toHaveAttribute('inert')
    view.rerender(<ChatPanel {...view.props} resumeSignal={1} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('发消息')).toHaveValue('总结我的收支')
    expect(screen.getByLabelText('发消息').closest('.chat-controls')).not.toHaveAttribute('inert')
    expect(view.props.stop).not.toHaveBeenCalled()
  })
})
