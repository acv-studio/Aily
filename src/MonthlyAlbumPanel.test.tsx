import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MonthlyAlbumPanel from './MonthlyAlbumPanel'
import MemoryPanel from './MemoryPanel'
import { defaultMemoryPolicy } from './longMemory'
import { setLocale } from './i18n'
import type { ConfirmedMemory } from './chatService'
import * as album from './monthlyAlbum'

const event: ConfirmedMemory = { id: 'event', characterId: 'lu', category: 'relationship', text: '小明和我们一起完成海边故事', confirmedAt: '2026-10-30T10:00:00Z' }
const props = { memories: [event], role: 'lu' as const, policy: defaultMemoryPolicy, messages: [], privateNames: ['小明'], search: '', category: 'all' }
beforeEach(() => setLocale('zh-CN'))
afterEach(() => { cleanup(); vi.restoreAllMocks(); setLocale('zh-CN') })
function preview() { fireEvent.click(screen.getByRole('button', { name: '预览分享内容' })) }
function confirm() { fireEvent.click(screen.getByLabelText('我已检查预览，确认可对外分享')) }

describe('monthly album flow', () => {
  it('requires preview and explicit consent; default sharing contains no original text', async () => {
    const download = vi.spyOn(album, 'downloadAlbum').mockImplementation(() => {})
    render(<MonthlyAlbumPanel {...props} />)
    expect(screen.queryByRole('button', { name: '下载回忆册' })).toBeNull()
    preview()
    expect(document.querySelector('pre')).not.toHaveTextContent(event.text)
    expect(screen.getByRole('button', { name: '下载回忆册' })).toBeDisabled()
    confirm(); fireEvent.click(screen.getByRole('button', { name: '下载回忆册' }))
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.stringContaining('一起珍藏的一件小事'), '2026-10'))
    expect(download.mock.calls[0][0]).not.toContain('小明')
  })
  it('redacts configured and custom names only after excerpts are opted in, and permits deselection', () => {
    render(<MonthlyAlbumPanel {...props} />)
    fireEvent.click(screen.getByLabelText('包含脱敏文字摘录（默认不包含）'))
    fireEvent.change(screen.getByLabelText('额外隐藏的姓名、地点或词语（逗号或换行分隔）'), { target: { value: '海边' } })
    preview()
    expect(document.querySelector('pre')).not.toHaveTextContent('小明')
    expect(document.querySelector('pre')).not.toHaveTextContent('海边')
    expect(document.querySelector('pre')).toHaveTextContent('故事')
    fireEvent.click(screen.getByRole('button', { name: '返回调整' }))
    expect(screen.queryByLabelText('我已检查预览，确认可对外分享')).toBeNull()
    fireEvent.click(screen.getByLabelText(event.text))
    expect(screen.getByRole('button', { name: '预览分享内容' })).toBeDisabled()
  })
  it.each(['edit', 'delete', 'withdraw', 'policy', 'filter'] as const)('blocks stale exports after %s', change => {
    const download = vi.spyOn(album, 'downloadAlbum').mockImplementation(() => {})
    const sourced = { ...event, sourceMessageId: 1 }
    const initial = { ...props, memories: [sourced] }
    const { rerender } = render(<MonthlyAlbumPanel {...initial} />)
    preview(); confirm()
    const changed = change === 'edit' ? { memories: [{ ...sourced, text: '改变了原事件' }] }
      : change === 'delete' ? { memories: [] }
      : change === 'withdraw' ? { messages: [{ id: 1, from: 'user' as const, text: '', time: '', withdrawn: true }] }
      : change === 'policy' ? { policy: { ...defaultMemoryPolicy, extractionEnabled: false } }
      : { search: 'unmatched' }
    rerender(<MonthlyAlbumPanel {...initial} {...changed} />)
    const button = screen.queryByRole('button', { name: '下载回忆册' })
    if (button) { expect(button).toBeDisabled(); fireEvent.click(button) }
    expect(download).not.toHaveBeenCalled()
    // Restore count but use a different source: generic output alone cannot authorize export.
    rerender(<MonthlyAlbumPanel {...initial} memories={[{ ...sourced, id: 'new' }]} />)
    expect(screen.getByRole('button', { name: '下载回忆册' })).toBeDisabled()
  })
  it('blocks export while a parent privacy-policy revocation is pending', async () => {
    const download = vi.spyOn(album, 'downloadAlbum').mockImplementation(() => {})
    let finish!: () => void
    const onPolicy = vi.fn().mockResolvedValue(undefined).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    render(<MemoryPanel selected="lu" memories={[event]} onSave={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()} onPolicy={onPolicy} />)
    fireEvent.click(screen.getByRole('button', { name: '月度回忆册' }))
    preview(); confirm()
    fireEvent.click(screen.getByLabelText('自动提议与摘要（关闭后仅保留原始聊天）'))
    expect(onPolicy).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '下载回忆册' })).toBeDisabled()
    expect(screen.getByLabelText('我已检查预览，确认可对外分享')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '下载回忆册' }))
    expect(download).not.toHaveBeenCalled()
    finish()
    await waitFor(() => expect(screen.getByRole('button', { name: '下载回忆册' })).toBeEnabled())
  })
  it('rechecks expiry at export even without a new render', () => {
    const download = vi.spyOn(album, 'downloadAlbum').mockImplementation(() => {})
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T00:00:00Z'))
    try {
      render(<MonthlyAlbumPanel {...props} memories={[{ ...event, expiresAt: '2026-11-04T00:01:00Z' }]} />)
      preview(); confirm()
      vi.setSystemTime(new Date('2026-11-04T00:02:00Z'))
      fireEvent.click(screen.getByRole('button', { name: '下载回忆册' }))
      expect(download).not.toHaveBeenCalled()
      expect(screen.getByRole('status')).toHaveTextContent('已变化')
    } finally { vi.useRealTimers() }
  })
  it('shares exactly the preview with Web Share and handles cancellation without download', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('cancel', 'AbortError'))
    vi.stubGlobal('navigator', { ...navigator, share })
    const download = vi.spyOn(album, 'downloadAlbum').mockImplementation(() => {})
    try {
      render(<MonthlyAlbumPanel {...props} />); preview(); confirm()
      const text = document.querySelector('pre')!.textContent
      fireEvent.click(screen.getByRole('button', { name: '分享回忆册' }))
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已取消分享'))
      expect(share).toHaveBeenCalledWith({ title: 'Aily · 月度回忆册', text })
      expect(download).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: '下载回忆册' })).toBeEnabled()
    } finally { vi.unstubAllGlobals() }
  })
  it('reports failures and permits retry, with no false success', async () => {
    vi.spyOn(album, 'downloadAlbum').mockImplementation(() => { throw new Error('blocked') })
    render(<MonthlyAlbumPanel {...props} />); preview(); confirm()
    fireEvent.click(screen.getByRole('button', { name: '下载回忆册' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('未完成'))
    expect(screen.getByRole('button', { name: '下载回忆册' })).toBeEnabled()
  })
  it('switches months, resets consent and honors disabled categories', () => {
    render(<MonthlyAlbumPanel {...props} memories={[event, { ...event, id: 'nov', confirmedAt: '2026-11-01T00:00:00Z' }]} />)
    preview(); confirm()
    fireEvent.change(screen.getByLabelText('回忆月份（UTC）'), { target: { value: '2026-10' } })
    preview()
    expect(screen.getByLabelText('我已检查预览，确认可对外分享')).not.toBeChecked()
    expect(document.querySelector('pre')).toHaveTextContent('2026-10')
    cleanup()
    render(<MonthlyAlbumPanel {...props} policy={{ ...defaultMemoryPolicy, disabledCategories: ['relationship'] }} />)
    expect(screen.queryByRole('button', { name: '预览分享内容' })).toBeNull()
  })
  it('localizes chrome and safe defaults without translating user excerpts', () => {
    setLocale('en'); render(<MonthlyAlbumPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview sharing content' }))
    expect(document.querySelector('pre')).toHaveTextContent('A little moment we treasure together')
    expect(screen.getByRole('button', { name: 'Download album' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Back to edit' }))
    fireEvent.click(screen.getByLabelText('Include redacted text excerpts (off by default)'))
    fireEvent.click(screen.getByRole('button', { name: 'Preview sharing content' }))
    expect(document.querySelector('pre')).toHaveTextContent('海边故事')
  })
})
