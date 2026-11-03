import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { acceptSafetyConsent } from './privacy'
import { db } from './db'
import { streamReply } from './chatService'
vi.mock('./chatService', async () => ({ ...await vi.importActual('./chatService'), streamReply: vi.fn() }))
beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear(); await db.delete(); await db.open()
  acceptSafetyConsent()
  await db.settings.bulkPut([{ key: 'onboarded', value: true }, { key: 'selected', value: 'lu' }])
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('refreshes story memories without interrupting an active streamed reply', async () => {
  let finish!: () => void
  vi.mocked(streamReply).mockImplementation(async request => {
    request.onDelta('继续生成的片段')
    await new Promise<void>(resolve => { finish = resolve })
    request.onDelta('，完整回复')
  })
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /去找他/ }))
  expect(screen.queryByRole('button', { name: '确认并继续' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: '发消息' }), { target: { value: '你好' } })
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
  await screen.findByText('继续生成的片段')
  fireEvent.click(screen.getByRole('button', { name: /共同故事/ }))
  fireEvent.click(await screen.findByRole('button', { name: '开始这一章' }))
  fireEvent.click(screen.getByRole('button', { name: /靠在门边看他/ }))
  fireEvent.click(screen.getByRole('button', { name: '确认保存选择与回忆' }))
  await screen.findByText('已保存选择与回忆')
  // Do not use loadLocalData here: its recovery intentionally marks sending rows failed.
  expect((await db.messages.toArray()).filter(message => message.status === 'sending')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: '关闭故事' }))
  expect(screen.getByRole('button', { name: '停止回复' })).toBeInTheDocument()
  expect(screen.getByText('继续生成的片段')).toBeInTheDocument()
  await act(async () => { finish() })
  await screen.findByText('继续生成的片段，完整回复')
  await waitFor(async () => expect((await db.messages.toArray()).every(message => message.status === 'sent')).toBe(true))
})
