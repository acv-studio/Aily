import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfirmedMemory } from './chatService'
import { InviteLanding, InvitePanel, MemoryShareDialog } from './SharingPanel'
import { defaultCardText, renderMemoryCard } from './sharing'
import { getLocale, setLocale, translate } from './i18n'

vi.mock('./sharing', async importOriginal => ({ ...await importOriginal<typeof import('./sharing')>(), renderMemoryCard: vi.fn() }))
const memory: ConfirmedMemory = { id: 'private', characterId: 'lu', category: 'relationship', text: '我们的原文，不要翻译', confirmedAt: '2026-01-01' }
beforeEach(() => {
  setLocale('en')
  vi.clearAllMocks()
  let id = 0
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:english-${++id}`) })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  vi.mocked(renderMemoryCard).mockResolvedValue(new Blob(['png']))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); setLocale('zh-CN') })

describe('English sharing', () => {
  it('localizes invitation UI without changing the role link', () => {
    const panel = render(<InvitePanel role="chen" close={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Invite friends to meet Aily' })).toBeInTheDocument()
    expect((screen.getByLabelText('Invitation link') as HTMLInputElement).value).toContain('#invite=chen')
    expect(screen.getByRole('option', { name: 'Chen Yiheng' })).toBeInTheDocument()
    panel.unmount()
    render(<InviteLanding role="chen" start={vi.fn()} dismiss={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Chen Yiheng' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Meet this AI companion' })).toBeInTheDocument()
  })
  it('regenerates locale-specific previews and resets consent while preserving source and edited copy', async () => {
    render(<MemoryShareDialog memory={memory} close={vi.fn()} canExport={() => true} />)
    expect(screen.getByLabelText('Public text')).toHaveValue(translate(defaultCardText))
    const consent = () => screen.getByLabelText(translate('我已检查预览，同意公开卡片内容'))
    const loadAndApprove = async () => {
      fireEvent.load(await screen.findByAltText(translate('待分享的回忆卡预览')))
      fireEvent.click(consent())
      expect(consent()).toBeChecked()
    }
    await loadAndApprove()
    act(() => setLocale('zh-CN'))
    expect(screen.getByLabelText('公开文案')).toHaveValue(defaultCardText)
    expect(consent()).not.toBeChecked()
    expect(consent()).toBeDisabled()
    await loadAndApprove()
    fireEvent.click(screen.getByLabelText('主动公开这条回忆的文字（最多 120 字）'))
    await waitFor(() => expect(renderMemoryCard).toHaveBeenLastCalledWith({ role: 'lu', text: memory.text }))
    await loadAndApprove()
    act(() => setLocale('en'))
    expect(screen.getByLabelText('Public text')).toHaveValue(memory.text)
    expect(consent()).not.toBeChecked()
    expect(consent()).toBeDisabled()
    await loadAndApprove()
    fireEvent.change(screen.getByLabelText('Public text'), { target: { value: '陆听澜 · my own public draft' } })
    await loadAndApprove()
    act(() => setLocale('zh-CN'))
    expect(screen.getByLabelText('公开文案')).toHaveValue('陆听澜 · my own public draft')
    expect(consent()).not.toBeChecked()
    expect(screen.getByRole('button', { name: '保存 PNG' })).toBeDisabled()
    // Flush the final canvas completion before this test releases the mounted dialog.
    await act(async () => {})
  })
  it('paints localized card chrome but never translates public copy', async () => {
    const painted: string[] = []
    const ctx = { fillRect: vi.fn(), strokeRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), stroke: vi.fn(), fillText: (text: string) => painted.push(text), measureText: (text: string) => ({ width: text.length * 10 }), createRadialGradient: () => ({ addColorStop: vi.fn() }) }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['png'], { type: 'image/png' })))
    const actual = await vi.importActual<typeof import('./sharing')>('./sharing')
    expect(getLocale()).toBe('en')
    await actual.renderMemoryCard({ role: 'lu', text: '陆听澜' })
    expect(painted).toContain('A moment together')
    expect(painted).toContain('With Lu Tinglan · AI companion')
    expect(painted).toContain('陆听澜')
    expect(painted).toContain('Shared by choice · AI companionship, not a real-person relationship')
    expect(painted.join(' ')).not.toContain(memory.text)
  })
})
