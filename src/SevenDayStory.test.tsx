import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SevenDayStory from './SevenDayStoryPanel'
import { db } from './db'
import { completeStoryChapter } from './sevenDayStory'

beforeEach(async () => { await db.settings.clear(); await db.memories.clear() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const open = (temporary = false) => render(<SevenDayStory temporary={temporary} onSaved={vi.fn()} onClose={vi.fn()} />)
const choose = async () => {
  fireEvent.click(await screen.findByRole('button', { name: '开始这一章' }))
  fireEvent.click(screen.getByRole('button', { name: /从背后抱住他/ }))
}
describe('seven-day story UI', () => {
  it('previews without saving, confirms once, and revisits without duplicating', async () => {
    const saved = vi.fn()
    render(<SevenDayStory temporary={false} onSaved={saved} onClose={vi.fn()} />)
    await choose()
    expect(await db.memories.count()).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: '重新选择' }))
    fireEvent.click(screen.getByRole('button', { name: /从背后抱住他/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认保存选择与回忆' }))
    await screen.findByText('已保存选择与回忆')
    expect(saved).toHaveBeenCalledOnce()
    expect(await db.memories.count()).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: '查看下一章' }))
    expect(screen.getByText('明天再续写下一章')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '回看第 1 天：下班后的晚饭' }))
    expect(screen.queryByRole('button', { name: '确认保存选择与回忆' })).not.toBeInTheDocument()
  })
  it('does not read or write persisted stories in temporary mode', async () => {
    const get = vi.spyOn(db.settings, 'get')
    open(true)
    expect(screen.getByText(/临时会话不读取或保存故事进度/)).toBeInTheDocument()
    expect(get).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '开始这一章' })).not.toBeInTheDocument()
  })
  it('offers retry without claiming success after a failed write', async () => {
    open(); await choose()
    const put = vi.spyOn(db.memories, 'put').mockRejectedValueOnce(new Error('保存失败，请重试'))
    fireEvent.click(screen.getByRole('button', { name: '确认保存选择与回忆' }))
    await screen.findByRole('alert')
    expect(screen.queryByText('已保存选择与回忆')).not.toBeInTheDocument()
    expect(await db.memories.count()).toBe(0)
    put.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: '确认保存选择与回忆' }))
    await screen.findByText('已保存选择与回忆')
  })
  it('reopens at the next chapter after a missed day', async () => {
    await completeStoryChapter(0, 0, new Date('2020-01-01T12:00:00'))
    open()
    await waitFor(() => expect(screen.getByRole('heading', { name: '第 2 天' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '开始这一章' })).toBeInTheDocument()
  })
})
