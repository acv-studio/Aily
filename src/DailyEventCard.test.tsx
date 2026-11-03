import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DailyEventCard from './DailyEventCard'
import { getDailyEvent } from './dailyEvents'
import { setLocale } from './i18n'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 11, 25, 12))
  setLocale('zh-CN')
})
afterEach(() => { cleanup(); vi.useRealTimers(); setLocale('zh-CN') })

describe('DailyEventCard', () => {
  it('offers curated holiday choices as drafts for the selected role, with no automatic action', () => {
    const onChat = vi.fn()
    render(<DailyEventCard selected="chen" onChat={onChat} />)
    expect(screen.getByText('节日话题')).toBeInTheDocument()
    expect(screen.getByText(/不自动发送或保存回忆/)).toBeInTheDocument()
    expect(onChat).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('combobox', { name: '一起聊的角色' }), { target: { value: 'gu' } })
    const event = getDailyEvent(new Date(), 'gu', 'zh-CN')
    fireEvent.click(screen.getByRole('button', { name: event.choices[1] }))
    expect(onChat).toHaveBeenCalledExactlyOnceWith('gu', event.prompts[1])
  })
  it('refreshes the local day while open and on visibility restoration', () => {
    render(<DailyEventCard selected="lu" onChat={vi.fn()} />)
    act(() => { vi.setSystemTime(new Date(2026, 11, 26, 0)); vi.advanceTimersByTime(60000) })
    expect(screen.getByText('日常话题')).toBeInTheDocument()
    expect(screen.queryByText('节日话题')).not.toBeInTheDocument()
    act(() => { vi.setSystemTime(new Date(2027, 0, 1, 12)); document.dispatchEvent(new Event('visibilitychange')) })
    expect(screen.getByText('节日话题')).toBeInTheDocument()
  })
  it('follows a changed selected role and supports live English localization', () => {
    const view = render(<DailyEventCard selected="lu" onChat={vi.fn()} />)
    view.rerender(<DailyEventCard selected="chen" onChat={vi.fn()} />)
    expect(screen.getByRole('combobox')).toHaveValue('chen')
    act(() => setLocale('en'))
    expect(screen.getByRole('region', { name: 'Today’s small event' })).toBeInTheDocument()
    expect(screen.getByText('Holiday topic')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Chat with' })).toHaveValue('chen')
    expect(screen.getByText(/nothing is sent or saved as a memory automatically/)).toBeInTheDocument()
  })
  it('disables role changes and drafting while its caller is busy and cleans up its timer', () => {
    const view = render(<DailyEventCard selected="lu" disabled onChat={vi.fn()} />)
    expect(screen.getByRole('combobox')).toBeDisabled()
    screen.getAllByRole('button').forEach(button => expect(button).toBeDisabled())
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
