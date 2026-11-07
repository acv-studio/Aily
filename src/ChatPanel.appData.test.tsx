import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPanel, { type ChatPanelProps } from './ChatPanel'
import { characters } from './data'
import { invalidateAppDataAccess } from './appDataGateway'

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
beforeEach(() => {
  localStorage.clear(); invalidateAppDataAccess()
  localStorage.setItem('aily-desktop-ledger', JSON.stringify([{ id: 'one', date: '2026-11-01', kind: 'expense', cents: 1234, note: '' }]))
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); invalidateAppDataAccess(); if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll); else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView') })
function setup(extra: Partial<ChatPanelProps> = {}) {
  const props: ChatPanelProps = { character: characters[0], messages: [], draft: '总结我的收支', setDraft: vi.fn(), send: vi.fn(async () => {}), saveMemory: vi.fn(async () => {}), withdraw: vi.fn(async () => {}), close: vi.fn(), stop: vi.fn(), replying: false, error: '', demo: false, openGame: vi.fn(), openStory: vi.fn(), isPrimary: true, appDataIdentity: () => ({ role: 'lu', primaryId: 'lu', temporary: false, endpoint: 'https://example.com/v1/messages', model: 'test' }), ...extra }
  return { ...render(<ChatPanel {...props} />), props }
}
describe('real chat app-data entry', () => {
  it('opens from chat settings, protects the background and restores focus when canceled', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '聊天设置' }))
    fireEvent.click(screen.getByRole('button', { name: '读取应用数据' }))
    expect(screen.getByRole('dialog', { name: '主 Bot 应用数据' })).toBeInTheDocument()
    expect(screen.getByLabelText('要问主 Bot 的问题')).toHaveValue('总结我的收支')
    expect(screen.getByLabelText('发消息').closest('.chat-controls')).toHaveAttribute('inert')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '主 Bot 应用数据' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('发消息').closest('.chat-controls')).not.toHaveAttribute('inert')
  })
  it.each([{ isPrimary: false }, { temporary: true }])('disables the data entry for %j', extra => {
    setup(extra)
    fireEvent.click(screen.getByRole('button', { name: '聊天设置' }))
    expect(screen.getByRole('button', { name: '读取应用数据' })).toBeDisabled()
  })
  it('stops a pending authorized send when the user closes with Escape, even before replying rerenders', async () => {
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    const { props } = setup({ send: vi.fn(() => pending) })
    fireEvent.click(screen.getByRole('button', { name: '聊天设置' }))
    fireEvent.click(screen.getByRole('button', { name: '读取应用数据' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '收支汇总（不含备注）' }))
    fireEvent.click(screen.getByRole('button', { name: '本机读取并预览' }))
    await screen.findByRole('heading', { name: '将发送的数据' })
    fireEvent.click(screen.getByRole('checkbox', { name: '我已检查预览，允许向上述模型发送这些数据，仅限本次。' }))
    fireEvent.click(screen.getByRole('button', { name: '仅本次授权并询问主 Bot' }))
    await waitFor(() => expect(props.send).toHaveBeenCalledTimes(1))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.stop).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: '主 Bot 应用数据' })).not.toBeInTheDocument()
    await act(async () => { finish(); await pending })
  })
})
