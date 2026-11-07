import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HomeScreen from './HomeScreen'
import DesktopTools from './DesktopTools'
import { registerMiniApp, clearRegisteredMiniAppData } from './extensionRuntime'
import { approveAppDataPreview, consumeAppDataTicket, listAppDataManifests, previewAppData } from './appDataGateway'

let unregister: (() => void) | undefined
beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
afterEach(async () => { cleanup(); unregister?.(); unregister = undefined; await clearRegisteredMiniAppData() })
describe('future mini-app through the actual desktop and Bot discovery', () => {
  it('installs and opens a new App with a dynamic title, then exposes its declared data without changing chat code', async () => {
    const read = vi.fn(async () => ({ status: 'ok' as const, summary: { count: 2 }, records: [{ id: 'saved', fields: { count: 2 } }], revision: 'v1', truncated: false }))
    unregister = registerMiniApp({
      app: { id: 'future-water-app', name: '未来饮水记录', english: 'Future Water Log', description: '饮水小应用', englishDescription: 'Water mini-app', icon: '💧', color: '#abc', category: 'life' },
      provider: { manifest: { id: 'future-water-app', name: '未来饮水记录', english: 'Future Water Log', availability: 'installable', schemaVersion: 1, scopes: [{ id: 'water', name: '饮水记录', english: 'Water entries', fields: ['count'], sensitive: true }] }, read },
      component: ({ locale }) => <p>{locale === 'en' ? 'Future app is open' : '未来应用界面已打开'}</p>,
      clearData: async () => {},
    })
    render(<HomeScreen selected="lu" conversations={{}} openChat={vi.fn()} />)
    expect(listAppDataManifests().some(app => app.id === 'future-water-app')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '应用商店' }))
    fireEvent.click(screen.getByRole('button', { name: '安装 未来饮水记录' }))
    expect(read).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '打开 未来饮水记录' }))
    expect(screen.getByRole('dialog', { name: '未来饮水记录' })).toBeInTheDocument()
    expect(screen.getByText('未来应用界面已打开')).toBeInTheDocument()
    expect(listAppDataManifests().find(app => app.id === 'future-water-app')?.scopes[0].id).toBe('water')
    const identity = { role: 'lu' as const, primaryId: 'lu' as const, temporary: false, endpoint: 'https://example.com/v1/messages', model: 'test' }
    const preview = await previewAppData([{ appId: 'future-water-app', scope: 'water' }], { text: '饮水记录怎么样', limit: 20 }, identity, new AbortController().signal)
    const data = await consumeAppDataTicket(approveAppDataPreview(preview), () => identity, '饮水记录怎么样', new AbortController().signal)
    expect(data.views[0].result.summary.count).toBe(2)
  })
  it('shows an unavailable shell for an unknown App instead of crashing on a missing static title', () => {
    render(<DesktopTools tool="unknown-future-app" onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: '应用暂不可用' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('应用暂不可用')
  })
})
