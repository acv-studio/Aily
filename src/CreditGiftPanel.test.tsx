import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DemoStoryEvent, DemoWalletSnapshot } from './giftDemo'
import type { useBilling } from './billing'

const billingStore = vi.hoisted(() => ({
  state: null as ReturnType<typeof useBilling> | null,
  listeners: new Set<() => void>(),
  checkIn: vi.fn<() => Promise<void>>(),
  refresh: vi.fn<() => Promise<void>>(),
  purchase: vi.fn(), restore: vi.fn(), reservePoints: vi.fn(),
}))
vi.mock('./billing', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useBilling: () => useSyncExternalStore(
      listener => { billingStore.listeners.add(listener); return () => { billingStore.listeners.delete(listener) } },
      () => billingStore.state!,
      () => billingStore.state!,
    ),
    reservePoints: billingStore.reservePoints,
  }
})

const history = vi.hoisted(() => ({
  wallet: { balance: 0, transactions: [] } as DemoWalletSnapshot,
  events: [] as DemoStoryEvent[],
  walletObservers: new Set<{ next: (value: DemoWalletSnapshot) => void; error: (failure: unknown) => void }>(),
  storyObservers: new Set<{ next: (value: DemoStoryEvent[]) => void; error: (failure: unknown) => void }>(),
  walletUnsubscribe: vi.fn(), storyUnsubscribe: vi.fn(),
  rechargeDemo: vi.fn(), sendDemoGift: vi.fn(), completeDemoStoryEvent: vi.fn(),
  walletPut: vi.fn(), transactionAdd: vi.fn(), storyPut: vi.fn(), storyAdd: vi.fn(),
}))
vi.mock('./giftDemo', () => ({
  // Match the real independent liveQuery subscriptions, but do not open IndexedDB.
  // Cancellation suppresses queued historical records after an unmount/retry.
  subscribeDemoWallet: (next: (value: DemoWalletSnapshot) => void, error: (failure: unknown) => void) => {
    const observer = { next, error }
    history.walletObservers.add(observer)
    queueMicrotask(() => { if (history.walletObservers.has(observer)) next(history.wallet) })
    return () => { history.walletObservers.delete(observer); history.walletUnsubscribe() }
  },
  subscribeDemoStoryEvents: (next: (value: DemoStoryEvent[]) => void, error: (failure: unknown) => void) => {
    const observer = { next, error }
    history.storyObservers.add(observer)
    queueMicrotask(() => { if (history.storyObservers.has(observer)) next(history.events) })
    return () => { history.storyObservers.delete(observer); history.storyUnsubscribe() }
  },
  rechargeDemo: history.rechargeDemo,
  sendDemoGift: history.sendDemoGift,
  completeDemoStoryEvent: history.completeDemoStoryEvent,
  demoDb: {
    wallet: { put: history.walletPut }, transactions: { add: history.transactionAdd },
    storyEvents: { put: history.storyPut, add: history.storyAdd },
  },
}))

import GiftStorePanel from './GiftStorePanel'
import { creditGifts, getCreditGift, giftMessage, giftResponseInstruction, type CreditGiftId } from './creditGifts'
import { setLocale, type Locale } from './i18n'

function publishBilling(patch: Partial<ReturnType<typeof useBilling>>) {
  act(() => {
    billingStore.state = { ...billingStore.state!, ...patch }
    billingStore.listeners.forEach(listener => listener())
  })
}
function deferred() {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function openPanel(props: Partial<React.ComponentProps<typeof GiftStorePanel>> = {}) {
  const onSendGift = vi.fn<(id: CreditGiftId) => Promise<void>>().mockResolvedValue(undefined)
  const view = render(<GiftStorePanel selected="chen" onSendGift={onSendGift} {...props} />)
  await act(async () => { await Promise.resolve() })
  return { ...view, onSendGift }
}
const card = (name: string, cost: number, locale: Locale = 'zh-CN') => screen.getByRole('button', { name: `${name}${cost} ${locale === 'en' ? 'credits' : '积分'}` })

beforeEach(() => {
  vi.clearAllMocks()
  setLocale('zh-CN')
  billingStore.checkIn.mockReset().mockResolvedValue(undefined)
  billingStore.refresh.mockReset().mockResolvedValue(undefined)
  billingStore.state = {
    ready: true, balance: 20, dailyQuota: 20, canCheckIn: true, busy: false, error: '',
    entitlement: { productId: null, multiplier: 1, expiresAt: null }, products: [],
    checkIn: billingStore.checkIn, refresh: billingStore.refresh,
    purchase: billingStore.purchase, restore: billingStore.restore,
  }
  history.wallet = { balance: 0, transactions: [] }
  history.events = []
})
afterEach(() => {
  cleanup()
  // Sending and checking in may only delegate; neither may touch the demo wallet.
  for (const write of [history.rechargeDemo, history.sendDemoGift, history.completeDemoStoryEvent,
    history.walletPut, history.transactionAdd, history.storyPut, history.storyAdd]) {
    expect(write).not.toHaveBeenCalled()
  }
  expect(billingStore.reservePoints).not.toHaveBeenCalled()
  expect(billingStore.purchase).not.toHaveBeenCalled()
  expect(billingStore.restore).not.toHaveBeenCalled()
  expect(billingStore.listeners.size).toBe(0)
  expect(history.walletObservers.size).toBe(0)
  expect(history.storyObservers.size).toBe(0)
})

describe('redesigned credit gift panel', () => {
  it.each(['zh-CN', 'en'] as const)('shows all six authoritative prices with accessible gift labels in %s and no demo recharge or quantity controls', async locale => {
    setLocale(locale)
    await openPanel()
    expect(creditGifts.map(gift => gift.cost)).toEqual([3, 5, 8, 10, 10, 10])
    const grid = screen.getByLabelText(locale === 'en' ? 'Choose one gift' : '选择一份礼物')
    expect(within(grid).getAllByRole('button')).toHaveLength(6)
    for (const gift of creditGifts) {
      expect(card(locale === 'en' ? gift.englishName : gift.name, gift.cost, locale)).toHaveAttribute('aria-pressed', String(gift.id === 'flower'))
    }
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /充值|recharge|top.?up|确认赠送（演示）|Confirm gift \(demo\)/i })).not.toBeInTheDocument()
    expect(screen.getByText(locale === 'en' ? 'Total: 3 credits' : '合计 3 积分')).toBeInTheDocument()
  })

  it('selects a gift without charging or sending, then sends the current gift ID exactly once', async () => {
    const { onSendGift } = await openPanel()
    fireEvent.click(card('热饮', 5))
    fireEvent.click(card('回忆相册', 10))
    expect(card('回忆相册', 10)).toHaveAttribute('aria-pressed', 'true')
    expect(card('一朵花', 3)).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('回忆相册 × 1')).toBeInTheDocument()
    expect(screen.getByText('合计 10 积分')).toBeInTheDocument()
    expect(screen.getByTestId('credit-balance')).toHaveTextContent(/^20$/)
    expect(onSendGift).not.toHaveBeenCalled()
    expect(billingStore.checkIn).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '送给TA' }))
    expect(await screen.findByRole('status')).toHaveTextContent('礼物已送出，已写入当前聊天。')
    expect(onSendGift).toHaveBeenCalledExactlyOnceWith('album')
    expect(card('回忆相册', 10)).toHaveAttribute('aria-pressed', 'true')
    // The panel does not invent a balance debit; the parent/ledger owns settlement.
    publishBilling({ balance: 10 })
    expect(screen.getByTestId('credit-balance')).toHaveTextContent(/^10$/)
  })

  it('preserves the selected gift after a rejected send, shows no success, and retries the same ID', async () => {
    const onSendGift = vi.fn<(id: CreditGiftId) => Promise<void>>()
      .mockRejectedValueOnce(new Error('AI reply failed')).mockResolvedValueOnce(undefined)
    await openPanel({ onSendGift })
    fireEvent.click(card('小夜灯', 8))
    fireEvent.click(screen.getByRole('button', { name: '送给TA' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('AI reply failed')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(card('小夜灯', 8)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('credit-balance')).toHaveTextContent(/^20$/)
    expect(screen.getByRole('button', { name: '送给TA' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '送给TA' }))
    await screen.findByText('礼物已送出，已写入当前聊天。')
    expect(onSendGift.mock.calls).toEqual([['lamp'], ['lamp']])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('closes the pre-render duplicate-click gap and locks gift selection while sending', async () => {
    const pending = deferred()
    const onSendGift = vi.fn<(id: CreditGiftId) => Promise<void>>().mockReturnValue(pending.promise)
    await openPanel({ onSendGift })
    fireEvent.click(card('旅行明信片', 10))
    const send = screen.getByRole('button', { name: '送给TA' })
    act(() => { send.click(); send.click() })
    expect(onSendGift).toHaveBeenCalledExactlyOnceWith('travel')
    expect(screen.getByRole('button', { name: '正在送出…' })).toBeDisabled()
    expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'true')
    expect(card('热饮', 5)).toBeDisabled()
    expect(screen.getByRole('button', { name: '签到 +20' })).toBeDisabled()
    fireEvent.click(card('热饮', 5))
    expect(card('旅行明信片', 10)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await act(async () => { pending.resolve(); await pending.promise })
    expect(screen.getByRole('status')).toHaveTextContent('礼物已送出')
    expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'false')
  })

  it('respects both externally sending and billing busy states', async () => {
    const { onSendGift, rerender } = await openPanel({ sending: true })
    expect(screen.getByRole('button', { name: '正在送出…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '正在送出…' }))
    publishBilling({ busy: true })
    rerender(<GiftStorePanel selected="chen" onSendGift={onSendGift} sending={false} />)
    expect(screen.getByRole('button', { name: '送给TA' })).toBeDisabled()
    expect(card('一朵花', 3)).toBeDisabled()
    expect(onSendGift).not.toHaveBeenCalled()
    publishBilling({ busy: false })
    expect(screen.getByRole('button', { name: '送给TA' })).toBeEnabled()
  })

  it('uses live billing readiness and balance to block sends and show the exact shortfall', async () => {
    billingStore.state = { ...billingStore.state!, ready: false, balance: 99 }
    const { onSendGift } = await openPanel()
    expect(screen.getByTestId('credit-balance')).toHaveTextContent('—')
    expect(screen.getByRole('status')).toHaveTextContent('正在读取积分…')
    expect(screen.getByRole('button', { name: '送给TA' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '签到 +20' })).toBeDisabled()
    fireEvent.click(card('电影邀约', 10))
    publishBilling({ ready: true, balance: 4 })
    expect(screen.getByRole('status')).toHaveTextContent('还差 6 积分')
    fireEvent.click(screen.getByRole('button', { name: '送给TA' }))
    expect(onSendGift).not.toHaveBeenCalled()
    publishBilling({ balance: 10 })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '送给TA' })).toBeEnabled()
    expect(card('电影邀约', 10)).toHaveAttribute('aria-pressed', 'true')
  })

  it.each(['zh-CN', 'en'] as const)('offers check-in and the monthly callback for insufficient credits in %s', async locale => {
    setLocale(locale)
    billingStore.state = { ...billingStore.state!, balance: 2 }
    billingStore.checkIn.mockImplementation(async () => {
      billingStore.state = { ...billingStore.state!, balance: 22, canCheckIn: false }
      billingStore.listeners.forEach(listener => listener())
    })
    const onOpenBilling = vi.fn()
    const { onSendGift } = await openPanel({ onOpenBilling })
    fireEvent.click(card(locale === 'en' ? 'Night light' : '小夜灯', 8, locale))
    expect(screen.getByRole('status')).toHaveTextContent(locale === 'en' ? 'You need 6 more credits' : '还差 6 积分')
    expect(screen.getByRole('button', { name: locale === 'en' ? 'Send gift' : '送给TA' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'View Apple monthly pass' : '查看 Apple 月卡' }))
    expect(onOpenBilling).toHaveBeenCalledTimes(1)
    expect(onSendGift).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: locale === 'en' ? 'Check in +20' : '签到 +20' })[1])
    expect(await screen.findByText(locale === 'en' ? 'Checked in. You received 20 credits.' : '签到成功，已领取 20 积分。')).toHaveAttribute('role', 'status')
    expect(billingStore.checkIn).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('credit-balance')).toHaveTextContent(/^22$/)
    expect(screen.queryByText(locale === 'en' ? 'You need 6 more credits' : '还差 6 积分')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: locale === 'en' ? 'Checked in today' : '今日已签到' })).toBeDisabled()
    expect(screen.getByRole('button', { name: locale === 'en' ? 'Send gift' : '送给TA' })).toBeEnabled()
    expect(onSendGift).not.toHaveBeenCalled()
  })

  it('deduplicates check-in and reports failure without claiming a reward', async () => {
    const pending = deferred()
    billingStore.checkIn.mockReturnValue(pending.promise)
    await openPanel()
    const checkIn = screen.getByRole('button', { name: '签到 +20' })
    act(() => { checkIn.click(); checkIn.click() })
    expect(billingStore.checkIn).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '签到中…' })).toBeDisabled()
    await act(async () => { pending.reject(new Error('Check-in unavailable')); await pending.promise.catch(() => {}) })
    expect(screen.getByRole('alert')).toHaveTextContent('Check-in unavailable')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByTestId('credit-balance')).toHaveTextContent(/^20$/)
    expect(screen.getByRole('button', { name: '签到 +20' })).toBeEnabled()
  })

  it('localizes pending and success status live while preserving the chosen gift', async () => {
    const pending = deferred()
    const onSendGift = vi.fn<(id: CreditGiftId) => Promise<void>>().mockReturnValue(pending.promise)
    await openPanel({ onSendGift })
    fireEvent.click(card('电影邀约', 10))
    fireEvent.click(screen.getByRole('button', { name: '送给TA' }))
    act(() => setLocale('en'))
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
    expect(card('Movie invitation', 10, 'en')).toHaveAttribute('aria-pressed', 'true')
    await act(async () => { pending.resolve(); await pending.promise })
    expect(screen.getByRole('status')).toHaveTextContent('Gift sent. It is now in your current chat.')
    act(() => setLocale('zh-CN'))
    expect(screen.getByRole('status')).toHaveTextContent('礼物已送出，已写入当前聊天。')
    expect(onSendGift).toHaveBeenCalledExactlyOnceWith('movie')
  })

  it('does not show a late success for a different current companion', async () => {
    const pending = deferred()
    const onSendGift = vi.fn<(id: CreditGiftId) => Promise<void>>().mockReturnValue(pending.promise)
    const { rerender } = await openPanel({ onSendGift })
    fireEvent.click(screen.getByRole('button', { name: '送给TA' }))
    rerender(<GiftStorePanel selected="lu" onSendGift={onSendGift} />)
    await act(async () => { pending.resolve(); await pending.promise })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(onSendGift).toHaveBeenCalledExactlyOnceWith('flower')
  })

  it('does not show legacy history or count old demo coins as available credits', async () => {
    history.wallet = { balance: 1000, transactions: [{ id: 'old-topup', kind: 'recharge', coins: 1000, createdAt: '2026-01-02T12:00:00Z' }] }
    billingStore.state = { ...billingStore.state!, balance: 0 }
    await openPanel()
    expect(screen.queryByText('旧演示记录 · 只读保留')).not.toBeInTheDocument()
    expect(screen.queryByTestId('demo-balance')).not.toBeInTheDocument()
    expect(screen.getByTestId('credit-balance')).toHaveTextContent(/^0$/)
    expect(screen.getByRole('button', { name: '送给TA' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('还差 3 积分')
    expect(history.walletObservers.size).toBe(0)
    expect(history.storyObservers.size).toBe(0)
  })

  it('sends credit gifts without subscribing to legacy wallet or story records', async () => {
    const { unmount } = await openPanel()
    act(() => {
      history.walletObservers.forEach(observer => observer.error(new Error('Old wallet unreadable')))
      history.storyObservers.forEach(observer => observer.error(new Error('Old stories unreadable')))
    })
    expect(screen.getByRole('button', { name: '送给TA' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '送给TA' }))
    await screen.findByText('礼物已送出，已写入当前聊天。')
    expect(screen.getByTestId('credit-balance')).toHaveTextContent(/^20$/)
    unmount()
    expect(history.walletObservers.size).toBe(0)
    expect(history.storyObservers.size).toBe(0)
    expect(history.walletUnsubscribe).not.toHaveBeenCalled()
    expect(history.storyUnsubscribe).not.toHaveBeenCalled()
  })

  it('disables sending without a parent callback and never invokes the deprecated demo callback', async () => {
    const onGiftSent = vi.fn()
    await openPanel({ onSendGift: undefined, onGiftSent })
    expect(screen.getByText('送礼暂不可用，请返回聊天后重试。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '送给TA' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '送给TA' }))
    expect(onGiftSent).not.toHaveBeenCalled()
  })
})

describe('credit gift contract', () => {
  it('resolves only current gift IDs and formats bilingual messages with authoritative prices and one included reply', () => {
    expect(getCreditGift('concert-ticket')).toBeUndefined()
    expect(getCreditGift('unknown')).toBeUndefined()
    for (const gift of creditGifts) {
      expect(getCreditGift(gift.id)).toBe(gift)
      expect(giftMessage(gift.id, 'zh-CN')).toBe(`🎁 虚拟礼物：${gift.name}（${gift.cost} 积分，含一次 AI 回应）`)
      expect(giftMessage(gift.id, 'en')).toBe(`🎁 Virtual gift: ${gift.englishName} (${gift.cost} points, includes one AI reply).`)
      expect(giftResponseInstruction(gift.id, 'zh-CN')).toContain(gift.description)
      expect(giftResponseInstruction(gift.id, 'zh-CN')).toContain('不提升关系进度，不要求继续送礼，不把基本关心与付费绑定')
      expect(giftResponseInstruction(gift.id, 'en')).toContain(gift.englishDescription)
      expect(giftResponseInstruction(gift.id, 'en')).toContain('Do not increase relationship progress, require more gifts, or imply that basic care depends on payment.')
    }
  })
})
