import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProactiveSettings from './ProactiveSettings'
import { DEFAULT_PROACTIVE_CONFIG, GENERIC_NOTIFICATION_BODY, PROACTIVE_SETTINGS_KEY, reminderLedgerKey } from './proactive'

const now = new Date(2026, 10, 3, 9, 0, 0)
function persist(patch: Record<string, unknown> = {}) {
  localStorage.setItem(PROACTIVE_SETTINGS_KEY, JSON.stringify({ ...DEFAULT_PROACTIVE_CONFIG, enabled: true, ...patch }))
}
async function tick(ms = 15_000) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

describe('ProactiveSettings', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    localStorage.clear()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('defaults off, discloses open-app limits and does not request permission on mount', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted')
    vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'default', requestPermission }))
    const onMessage = vi.fn().mockResolvedValue(undefined)
    render(<ProactiveSettings selected="lu" busy={false} onMessage={onMessage} />)
    expect(screen.getByLabelText('开启本地定时提醒')).not.toBeChecked()
    expect(screen.getByText(/关闭应用后无法送达通知/)).toBeInTheDocument()
    await tick()
    expect(onMessage).not.toHaveBeenCalled()
    expect(requestPermission).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '启用系统通知（申请权限）' }))
    await act(async () => {})
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem(PROACTIVE_SETTINGS_KEY)!)).toMatchObject({ enabled: false, notifications: true })
  })

  it('sends only local labeled templates once, uses generic notification body, and persists no latest text', async () => {
    persist({ kind: 'followup', notifications: true })
    const notification = Object.assign(vi.fn(), { permission: 'granted', requestPermission: vi.fn() })
    vi.stubGlobal('Notification', notification)
    const onMessage = vi.fn().mockResolvedValue(undefined)
    render(<ProactiveSettings selected="chen" busy={false} onMessage={onMessage} latestUserText="private secret" />)
    await act(async () => {})
    expect(onMessage).toHaveBeenCalledWith('chen', expect.stringContaining('本地定时跟进 · 非 AI 生成'))
    expect(onMessage.mock.calls[0][1]).not.toContain('private secret')
    expect(notification).toHaveBeenCalledWith('Aily 本地提醒', { body: GENERIC_NOTIFICATION_BODY, tag: reminderLedgerKey(now, 'chen') })
    expect(localStorage.getItem(PROACTIVE_SETTINGS_KEY)).not.toContain('private secret')
    await tick(30_000)
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(notification.requestPermission).not.toHaveBeenCalled()
  })

  it('honors busy, DND, opt-out and skips past reminders', async () => {
    persist()
    const onMessage = vi.fn().mockResolvedValue(undefined)
    const view = render(<ProactiveSettings selected="lu" busy onMessage={onMessage} />)
    await tick()
    expect(onMessage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('开启本地定时提醒'))
    view.rerender(<ProactiveSettings selected="lu" busy={false} onMessage={onMessage} />)
    await tick()
    expect(onMessage).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('免打扰开始'), { target: { value: '08:00' } })
    fireEvent.change(screen.getByLabelText('免打扰结束'), { target: { value: '10:00' } })
    fireEvent.click(screen.getByLabelText('开启本地定时提醒'))
    await tick()
    expect(onMessage).not.toHaveBeenCalled()
    vi.setSystemTime(new Date(2026, 10, 3, 9, 1))
    fireEvent.click(screen.getByLabelText('启用免打扰'))
    await tick()
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('suppresses repeat deliveries from two mounted tabs/components via shared ledger', async () => {
    persist()
    const first = vi.fn().mockResolvedValue(undefined)
    const second = vi.fn().mockResolvedValue(undefined)
    render(<><ProactiveSettings selected="lu" busy={false} onMessage={first} /><ProactiveSettings selected="lu" busy={false} onMessage={second} /></>)
    await act(async () => {})
    expect(first.mock.calls.length + second.mock.calls.length).toBe(1)
  })

  it('uses Web Locks when available and rechecks opt-out before a queued delivery', async () => {
    persist()
    let queued: (() => Promise<void>) | undefined
    const request = vi.fn((_name: string, callback: () => Promise<void>) => {
      queued = callback
      return Promise.resolve()
    })
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
    try {
      const onMessage = vi.fn().mockResolvedValue(undefined)
      render(<ProactiveSettings selected="lu" busy={false} onMessage={onMessage} />)
      expect(request).toHaveBeenCalled()
      fireEvent.click(screen.getByLabelText('开启本地定时提醒'))
      await act(async () => { await queued?.() })
      expect(onMessage).not.toHaveBeenCalled()
    } finally { Reflect.deleteProperty(navigator, 'locks') }
  })

  it('fails closed when local storage is unavailable and ignores invalid persisted settings', async () => {
    localStorage.setItem(PROACTIVE_SETTINGS_KEY, JSON.stringify({ ...DEFAULT_PROACTIVE_CONFIG, enabled: true, schedule: '99:99' }))
    const onMessage = vi.fn().mockResolvedValue(undefined)
    const view = render(<ProactiveSettings selected="lu" busy={false} onMessage={onMessage} />)
    expect(screen.getByLabelText('开启本地定时提醒')).not.toBeChecked()
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    fireEvent.click(screen.getByLabelText('开启本地定时提醒'))
    expect(screen.getByLabelText('开启本地定时提醒')).not.toBeChecked()
    await tick()
    expect(onMessage).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('提醒已停用')
    write.mockRestore()
    view.unmount()
    persist()
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    render(<ProactiveSettings selected="lu" busy={false} onMessage={onMessage} />)
    await tick()
    expect(onMessage).not.toHaveBeenCalled()
    read.mockRestore()
  })

  it('reacts to another tab opting out and cleans the timer on unmount', async () => {
    persist()
    const onMessage = vi.fn().mockResolvedValue(undefined)
    const view = render(<ProactiveSettings selected="gu" busy onMessage={onMessage} />)
    persist({ enabled: false })
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: PROACTIVE_SETTINGS_KEY })) })
    expect(screen.getByLabelText('开启本地定时提醒')).not.toBeChecked()
    view.rerender(<ProactiveSettings selected="gu" busy={false} onMessage={onMessage} />)
    await tick()
    expect(onMessage).not.toHaveBeenCalled()
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not retry failed delivery or send notifications after opting out during a callback', async () => {
    persist({ notifications: true })
    const notification = Object.assign(vi.fn(), { permission: 'granted', requestPermission: vi.fn() })
    vi.stubGlobal('Notification', notification)
    let resolve: (() => void) | undefined
    const onMessage = vi.fn(() => new Promise<void>(done => { resolve = done }))
    render(<ProactiveSettings selected="lu" busy={false} onMessage={onMessage} />)
    fireEvent.click(screen.getByLabelText('开启本地定时提醒'))
    await act(async () => { resolve?.() })
    expect(notification).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('开启本地定时提醒'))
    await tick()
    expect(onMessage).toHaveBeenCalledTimes(1)
    cleanup()
    persist()
    const rejected = vi.fn().mockRejectedValue(new Error('failed'))
    render(<ProactiveSettings selected="chen" busy={false} onMessage={rejected} />)
    await act(async () => {})
    await tick()
    expect(rejected).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('今日不自动重试')
  })
})
