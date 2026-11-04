import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HomeScreen from './HomeScreen'
import ClockWidget from './ClockWidget'
import { setLocale } from './i18n'

vi.mock('./WeatherWidget', () => ({ default: () => <section aria-label="天气">选择城市查看天气</section> }))
vi.mock('./DesktopTools', () => ({ default: ({ tool, onClose }: { tool: string; onClose: () => void }) => <div role="dialog" aria-label={tool}><button onClick={onClose}>关闭工具</button></div> }))
beforeEach(() => setLocale('zh-CN'))
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('companion desktop home', () => {
  it('puts device time and weather above one main bot and six working app entries', () => {
    const openChat = vi.fn()
    render(<HomeScreen selected="chen" primaryId="lu" primaryName="阿澜" conversations={{}} openChat={openChat} />)
    expect(screen.getByLabelText('系统时间')).toBeInTheDocument()
    expect(screen.getByLabelText('天气')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '与阿澜聊天' }))
    expect(openChat).toHaveBeenLastCalledWith('lu')
    const apps = within(screen.getByRole('group', { name: '日常小应用' }))
    expect(apps.getAllByRole('button').map(button => button.textContent)).toEqual(['记账', '相册', '通讯录', '音乐', '日记', '梅花易数'])
    for (const [label, id] of [['记账', 'ledger'], ['相册', 'album'], ['通讯录', 'contacts'], ['音乐', 'music'], ['日记', 'diary'], ['梅花易数', 'divination']]) {
      fireEvent.click(apps.getByRole('button', { name: label }))
      expect(screen.getByRole('dialog', { name: id })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '关闭工具' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
  })
  it('keeps other companions accessible without changing the main bot', () => {
    const openChat = vi.fn()
    render(<HomeScreen selected="chen" primaryId="lu" conversations={{}} openChat={openChat} />)
    fireEvent.click(screen.getByRole('button', { name: '其他聊天伙伴' }))
    const strip = within(screen.getByRole('group', { name: '聊天伙伴' }))
    expect(strip.getAllByRole('button')).toHaveLength(3)
    expect(strip.getByRole('button', { name: '打开陈奕恒的会话' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(strip.getByRole('button', { name: '打开顾辰泽的会话' }))
    expect(openChat).toHaveBeenLastCalledWith('gu')
    fireEvent.click(screen.getByRole('button', { name: '与陆听澜聊天' }))
    expect(openChat).toHaveBeenLastCalledWith('lu')
  })
  it('shows only the main bot’s latest unwithdrawn message', () => {
    render(<HomeScreen selected="lu" openChat={vi.fn()} conversations={{
      lu: [{ id: 1, from: 'user', text: '明天看海', time: '20:15' }, { id: 2, from: 'user', text: '撤回的秘密', time: '20:16', withdrawn: true }],
      chen: [{ id: 3, from: 'character', text: '早点休息', time: '21:10' }],
    }} />)
    expect(screen.getByRole('button', { name: '与陆听澜聊天' })).toHaveTextContent('明天看海')
    expect(screen.queryByText('撤回的秘密')).not.toBeInTheDocument()
    expect(screen.queryByText('早点休息')).not.toBeInTheDocument()
  })
  it('updates from device time and cleans up its timer', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-04T14:59:59+08:00'))
    const view = render(<ClockWidget />)
    const before = screen.getByLabelText('系统时间').querySelector('time')!.textContent
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByLabelText('系统时间').querySelector('time')!.textContent).not.toBe(before)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
