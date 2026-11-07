import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppDataPanel, { appDataServiceLabel } from './AppDataPanel'
import * as gateway from './appDataGateway'
import type { AppDataIdentity } from './appDataTypes'
import { registerMiniApp } from './extensionRuntime'
import { setExtensionInstalled } from './extensionApps'

const identity: AppDataIdentity = { role: 'lu', primaryId: 'lu', temporary: false, endpoint: 'https://example.com/v1/chat/completions', model: 'test-model' }
let dispose: (() => void) | undefined
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); gateway.invalidateAppDataAccess()
  localStorage.setItem('aily-desktop-ledger', JSON.stringify([{ id: 'one', kind: 'expense', cents: 1234, note: 'PRIVATE-NOTE-NOT-AUTHORIZED', date: '2026-11-01', category: 'food' }]))
})
afterEach(() => { cleanup(); localStorage.clear(); dispose?.(); dispose = undefined; vi.restoreAllMocks() })
function setup(extra: Partial<Parameters<typeof AppDataPanel>[0]> = {}) {
  const send = vi.fn(async () => {}), close = vi.fn(), stop = vi.fn()
  const props = { identity: () => identity, text: '帮我整理本月收支', modelAvailable: true, send, close, stop, ...extra }
  const view = render(<AppDataPanel {...props} />)
  return { ...view, send, close, stop, props }
}
async function preview() {
  fireEvent.click(screen.getByRole('checkbox', { name: '收支汇总（不含备注）' }))
  fireEvent.click(screen.getByRole('button', { name: '本机读取并预览' }))
  await screen.findByRole('heading', { name: '将发送的数据' })
}
describe('explicit main Bot app data consent', () => {
  it('does not read private data on mount; local preview is not sent, and excludes unselected fields', async () => {
    const read = vi.spyOn(gateway, 'previewAppData')
    const { send } = setup()
    expect(read).not.toHaveBeenCalled()
    await preview()
    expect(read).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
    expect(screen.getByLabelText('应用数据预览')).toHaveTextContent('1234')
    expect(screen.getByLabelText('应用数据预览')).not.toHaveTextContent('PRIVATE-NOTE-NOT-AUTHORIZED')
    expect(screen.getByRole('button', { name: '仅本次授权并询问主 Bot' })).toBeDisabled()
  })
  it('sends an opaque capability only after the second confirmation, not raw source records', async () => {
    const { send, close } = setup()
    await preview()
    fireEvent.click(screen.getByRole('checkbox', { name: '我已检查预览，允许向上述模型发送这些数据，仅限本次。' }))
    fireEvent.click(screen.getByRole('button', { name: '仅本次授权并询问主 Bot' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    const args = send.mock.calls[0] as unknown as [{ text: string; appDataTicket: { token: string } }]
    expect(args[0].text).toBe('帮我整理本月收支')
    expect(args[0].appDataTicket.token).toMatch(/^app-data:/)
    expect(JSON.stringify(args[0])).not.toContain('1234')
    await waitFor(() => expect(close).toHaveBeenCalled())
  })
  it('invalidates a preview and confirmation whenever the question or keyword filter changes', async () => {
    setup(); await preview()
    fireEvent.click(screen.getByRole('checkbox', { name: '我已检查预览，允许向上述模型发送这些数据，仅限本次。' }))
    fireEvent.change(screen.getByLabelText('记录关键词筛选（可选，不填则读取范围内全部记录）'), { target: { value: 'food' } })
    expect(screen.queryByRole('heading', { name: '将发送的数据' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '本机读取并预览' }))
    await screen.findByRole('heading', { name: '将发送的数据' })
    expect(screen.getByRole('button', { name: '仅本次授权并询问主 Bot' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('要问主 Bot 的问题'), { target: { value: '换一个问题' } })
    expect(screen.queryByRole('heading', { name: '将发送的数据' })).not.toBeInTheDocument()
  })
  it.each([{ ...identity, role: 'chen' as const }, { ...identity, temporary: true }])('blocks all data reads for identity %j', invalid => {
    const read = vi.spyOn(gateway, 'previewAppData')
    setup({ identity: () => invalid })
    expect(screen.getByRole('checkbox', { name: '收支汇总（不含备注）' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '本机读取并预览' })).toBeDisabled()
    expect(read).not.toHaveBeenCalled()
  })
  it('keeps preview local in demo mode and cancels without sending', async () => {
    const { send, close } = setup({ modelAvailable: false })
    await preview()
    fireEvent.click(screen.getByRole('checkbox', { name: '我已检查预览，允许向上述模型发送这些数据，仅限本次。' }))
    expect(screen.getByRole('button', { name: '仅本次授权并询问主 Bot' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '取消并关闭' }))
    expect(close).toHaveBeenCalled(); expect(send).not.toHaveBeenCalled()
  })
  it('discovers a newly registered and installed mini-app without granting it access', async () => {
    setup()
    await act(async () => {
      dispose = registerMiniApp({
        app: { id: 'future-water', name: '未来饮水', english: 'Future Water', description: 'D', englishDescription: 'D', icon: 'W', color: '#abc', category: 'life' },
        component: () => <p>Water app</p>, clearData: async () => {},
        provider: { manifest: { id: 'future-water', name: '未来饮水', english: 'Future Water', availability: 'installable', schemaVersion: 1, scopes: [{ id: 'water', name: '饮水记录', english: 'Water records', fields: ['count'], sensitive: false }] }, read: async () => ({ status: 'ok', summary: { count: 2 }, records: [], revision: '1', truncated: false }) },
      })
      setExtensionInstalled('future-water', true)
    })
    const water = await screen.findByRole('checkbox', { name: '饮水记录' })
    expect(water).not.toBeChecked()
    fireEvent.click(water)
    fireEvent.click(screen.getByRole('checkbox', { name: '收支汇总（不含备注）' }))
    await act(async () => { setExtensionInstalled('future-water', false) })
    expect(screen.queryByRole('checkbox', { name: '饮水记录' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '本机读取并预览' }))
    await screen.findByRole('heading', { name: '将发送的数据' })
    expect(screen.getByLabelText('应用数据预览')).toHaveTextContent('1234')
  })
  it('hides credentials and query parameters when showing the target model service', () => {
    expect(appDataServiceLabel('https://name:password@example.com/v1/chat?key=SECRET#private')).toBe('https://example.com/v1/chat')
  })
})
