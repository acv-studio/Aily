import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfirmedMemory } from './chatService'
import { MemoryShareDialog } from './SharingPanel'
import { defaultCardText, downloadCard, renderMemoryCard } from './sharing'
vi.mock('./sharing', async importOriginal => ({ ...await importOriginal<typeof import('./sharing')>(), renderMemoryCard: vi.fn(), downloadCard: vi.fn() }))
const memory: ConfirmedMemory = { id: 'event', characterId: 'lu', category: 'relationship', text: '秘密姓名和地点', confirmedAt: '2026-01-01' }
const consent = () => screen.getByLabelText('我已检查预览，同意公开卡片内容')
const save = () => screen.getByRole('button', { name: '保存 PNG' })
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn().mockImplementation(() => `blob:${Math.random()}`) })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})
describe('reviewed public card', () => {
  it('waits for current image load, resets consent on editing, ignores older render completion', async () => {
    const resolves: ((blob: Blob) => void)[] = []
    vi.mocked(renderMemoryCard).mockImplementation(() => new Promise(resolve => resolves.push(resolve)))
    render(<MemoryShareDialog memory={memory} close={vi.fn()} canExport={() => true} />)
    expect(screen.getByLabelText('公开文案')).toHaveValue(defaultCardText)
    expect(consent()).toBeDisabled(); expect(save()).toBeDisabled()
    await act(async () => resolves[0](new Blob(['first'])))
    expect(consent()).toBeDisabled()
    fireEvent.load(screen.getByAltText('待分享的回忆卡预览'))
    fireEvent.click(consent()); expect(save()).toBeEnabled()
    fireEvent.change(screen.getByLabelText('公开文案'), { target: { value: '新的公开文案 A' } })
    expect(consent()).not.toBeChecked(); expect(consent()).toBeDisabled()
    fireEvent.change(screen.getByLabelText('公开文案'), { target: { value: '新的公开文案 B' } })
    await act(async () => resolves[2](new Blob(['B'])))
    const newUrl = screen.getByAltText('待分享的回忆卡预览').getAttribute('src')
    fireEvent.load(screen.getByAltText('待分享的回忆卡预览')); fireEvent.click(consent())
    await act(async () => resolves[1](new Blob(['A'])))
    expect(screen.getByAltText('待分享的回忆卡预览')).toHaveAttribute('src', newUrl)
    expect(consent()).toBeChecked(); fireEvent.click(save())
    expect(downloadCard).toHaveBeenCalledOnce()
    expect(renderMemoryCard).not.toHaveBeenCalledWith(expect.objectContaining({ text: memory.text }))
  })
  it('requires explicit text opt-in and blocks export if eligibility expires', async () => {
    vi.mocked(renderMemoryCard).mockResolvedValue(new Blob(['png']))
    const allowed = vi.fn(() => true)
    render(<MemoryShareDialog memory={memory} close={vi.fn()} canExport={allowed} />)
    await screen.findByAltText('待分享的回忆卡预览')
    fireEvent.click(screen.getByLabelText('主动公开这条回忆的文字（最多 120 字）'))
    expect(screen.getByLabelText('公开文案')).toHaveValue(memory.text)
    await waitFor(() => expect(renderMemoryCard).toHaveBeenLastCalledWith({ role: 'lu', text: memory.text }))
    await screen.findByAltText('待分享的回忆卡预览')
    fireEvent.load(screen.getByAltText('待分享的回忆卡预览')); fireEvent.click(consent())
    allowed.mockReturnValue(false); fireEvent.click(save())
    expect(downloadCard).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('已到期')
    expect(consent()).not.toBeChecked()
  })
})
