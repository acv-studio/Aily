import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entitlement, PlanId, StoreProduct } from './billing'

const bridge = vi.hoisted(() => ({
  isNative: true,
  platform: 'ios',
  listener: null as null | ((result: { entitlement: { productId: string | null; multiplier: number; expiresAt: string | null } }) => void | Promise<void>),
  products: vi.fn(), purchase: vi.fn(), restore: vi.fn(), entitlement: vi.fn(), addListener: vi.fn(),
}))
vi.mock('@capacitor/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@capacitor/core')>()
  return {
    ...actual,
    Capacitor: { ...actual.Capacitor, isNativePlatform: () => bridge.isNative, getPlatform: () => bridge.platform },
    registerPlugin: vi.fn((name: string) => {
      if (name !== 'AilyBilling') throw new Error(`Unexpected native plugin: ${name}`)
      return bridge
    }),
  }
})
import { nativeBillingAvailable, refreshBilling, reservePoints, useBilling } from './billing'

const free: Entitlement = { productId: null, multiplier: 1, expiresAt: null }
const now = new Date(2026, 0, 2, 12)
const ledger = new Dexie('aily-billing-v1')
ledger.version(1).stores({ ledger: 'id' })
const plans: [PlanId, number, number][] = [
  ['com.aily.app.monthly.5x', 5, 100],
  ['com.aily.app.monthly.10x', 10, 200],
  ['com.aily.app.monthly.20x', 20, 400],
  ['com.aily.app.monthly.50x', 50, 1000],
]
const active = (id: PlanId = plans[0][0], multiplier = 999): Entitlement => ({ productId: id, multiplier, expiresAt: new Date(now.getTime() + 86_400_000).toISOString() })
const products: StoreProduct[] = plans.map(([id, multiplier]) => ({ id, displayPrice: `$${multiplier}.99`, displayName: `Aily Plus ${multiplier}×`, description: 'Monthly auto-renewable pass' }))
bridge.addListener.mockImplementation(async (event: string, listener: typeof bridge.listener) => {
  expect(event).toBe('entitlementChanged')
  bridge.listener = listener
  return { remove: vi.fn().mockResolvedValue(undefined) }
})
beforeEach(async () => {
  // Fake Date only: fake-indexeddb's timers and task queue must remain live.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  bridge.isNative = true
  bridge.platform = 'ios'
  bridge.products.mockReset().mockResolvedValue({ products })
  bridge.entitlement.mockReset().mockResolvedValue({ entitlement: free })
  bridge.purchase.mockReset().mockResolvedValue({ status: 'cancelled' })
  bridge.restore.mockReset().mockResolvedValue({ entitlement: free })
  await ledger.table('ledger').clear()
  await refreshBilling()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })
async function billing() {
  const hook = renderHook(() => useBilling())
  await act(async () => { await refreshBilling() })
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  return hook
}
async function change(entitlement: Entitlement) {
  expect(bridge.listener).toBeTypeOf('function')
  await act(async () => { await bridge.listener!({ entitlement }) })
}
async function spend(cost: 1 | 5) { const reservation = await reservePoints(cost); await reservation.commit() }

describe('StoreKit bridge with the real IndexedDB ledger', () => {
  it.each(plans)('maps verified %s to %s× and %s points/day, ignoring bridge multiplier claims', async (id, multiplier, quota) => {
    bridge.entitlement.mockResolvedValue({ entitlement: active(id) })
    const hook = await billing()
    expect(hook.result.current.entitlement).toEqual({ ...active(id), multiplier })
    expect(hook.result.current.dailyQuota).toBe(quota)
    expect(hook.result.current.balance).toBe(quota)
    await act(async () => { await hook.result.current.checkIn(); await spend(5) })
    expect(hook.result.current.balance).toBe(quota + 15)
    expect(await ledger.table('ledger').get('main')).toMatchObject({ used: 5, bonus: 20 })
  })

  it('retains spent daily credits and bonus when upgrading and receiving a revocation', async () => {
    const hook = await billing()
    await act(async () => { await hook.result.current.checkIn(); await spend(5) })
    await change(active(plans[3][0]))
    expect(hook.result.current.balance).toBe(1015)
    await change(free)
    expect(hook.result.current.entitlement).toEqual(free)
    expect(hook.result.current.dailyQuota).toBe(20)
    expect(hook.result.current.balance).toBe(35)
    expect(await ledger.table('ledger').get('main')).toMatchObject({ used: 5, bonus: 20 })
  })

  it('resets a paid daily quota at local midnight while carrying the fixed bonus', async () => {
    bridge.entitlement.mockResolvedValue({ entitlement: { ...active(plans[1][0]), expiresAt: new Date(2026, 0, 10).toISOString() } })
    const hook = await billing()
    await act(async () => { await hook.result.current.checkIn(); await spend(5) })
    expect(hook.result.current.balance).toBe(215)
    vi.setSystemTime(new Date(2026, 0, 3, 0))
    await act(async () => { await refreshBilling() })
    expect(hook.result.current.dailyQuota).toBe(200)
    expect(hook.result.current.balance).toBe(220)
    expect(hook.result.current.canCheckIn).toBe(true)
    await act(async () => { await hook.result.current.checkIn() })
    expect(hook.result.current.balance).toBe(240)
    expect(await ledger.table('ledger').get('main')).toMatchObject({ used: 0, bonus: 40, day: '2026-01-03' })
  })

  it('releases a failed reservation after entitlement revocation without overspending the free quota', async () => {
    bridge.entitlement.mockResolvedValue({ entitlement: active() })
    const hook = await billing()
    let holds!: Awaited<ReturnType<typeof reservePoints>>[]
    await act(async () => { holds = await Promise.all(Array.from({ length: 5 }, () => reservePoints(5))) })
    expect(hook.result.current.balance).toBe(75)
    await change(free)
    expect(hook.result.current.balance).toBe(0)
    await act(async () => {
      for (const hold of holds.slice(0, 4)) await hold.commit()
      await expect(holds[4].commit()).rejects.toThrow('积分余额不足')
      await holds[4].release()
    })
    expect(hook.result.current.balance).toBe(0)
    expect(await ledger.table('ledger').get('main')).toMatchObject({ used: 20, bonus: 0, holds: {} })
  })

  it('resets expired entitlement to the free quota without minting allowance or deleting bonus', async () => {
    bridge.entitlement.mockResolvedValue({ entitlement: { ...active(), expiresAt: new Date(now.getTime() + 1000).toISOString() } })
    const hook = await billing()
    await act(async () => { await hook.result.current.checkIn(); for (let i = 0; i < 5; i++) await spend(5) })
    expect(hook.result.current.balance).toBe(95)
    vi.setSystemTime(new Date(now.getTime() + 1000))
    await act(async () => { await refreshBilling() })
    expect(hook.result.current.entitlement).toEqual(free)
    expect(hook.result.current.dailyQuota).toBe(20)
    expect(hook.result.current.balance).toBe(20)
    expect(await ledger.table('ledger').get('main')).toMatchObject({ used: 25, bonus: 20 })
  })

  it.each([
    { ...active(), expiresAt: null },
    { ...active(), expiresAt: 'not-a-date' },
    { ...active(), expiresAt: new Date(now.getTime() - 1).toISOString() },
    { ...active(), productId: 'unknown.product' as PlanId },
    { ...active(), productId: null },
  ])('rejects inactive or unrecognized entitlement %#', async entitlement => {
    bridge.entitlement.mockResolvedValue({ entitlement })
    const hook = await billing()
    expect(hook.result.current.entitlement).toEqual(free)
    expect(hook.result.current.dailyQuota).toBe(20)
    expect(hook.result.current.balance).toBe(20)
  })

  it.each(['pending', 'cancelled'] as const)('%s purchases do not grant rights or bonus', async status => {
    const hook = await billing()
    bridge.purchase.mockResolvedValue({ status })
    await act(async () => { await hook.result.current.purchase(plans[0][0]) })
    expect(bridge.purchase).toHaveBeenCalledExactlyOnceWith({ productId: plans[0][0] })
    expect(hook.result.current.entitlement).toEqual(free)
    expect(hook.result.current.balance).toBe(20)
    expect(hook.result.current.dailyQuota).toBe(20)
    expect(hook.result.current.busy).toBe(false)
    if (status === 'pending') expect(hook.result.current.error).toContain('等待 Apple 批准')
    else expect(hook.result.current.error).toBe('')
  })

  it.each(['pending', 'cancelled'] as const)('does not trust an attached entitlement on a %s transaction', async status => {
    const hook = await billing()
    // Defensive boundary: a returned entitlement alone is not proof of purchase success.
    bridge.purchase.mockResolvedValue({ status, entitlement: active() })
    await act(async () => { await hook.result.current.purchase(plans[0][0]) })
    expect(hook.result.current.entitlement).toEqual(free)
    expect(hook.result.current.dailyQuota).toBe(20)
    expect(hook.result.current.balance).toBe(20)
  })

  it('grants purchased rights only from a valid entitlement, and no purchase bonus', async () => {
    const hook = await billing()
    bridge.purchase.mockResolvedValueOnce({ status: 'purchased' })
    await act(async () => { await hook.result.current.purchase(plans[1][0]) })
    expect(hook.result.current.balance).toBe(20)
    bridge.purchase.mockResolvedValueOnce({ status: 'purchased', entitlement: active(plans[1][0]) })
    await act(async () => { await hook.result.current.purchase(plans[1][0]) })
    expect(hook.result.current.dailyQuota).toBe(200)
    expect(hook.result.current.balance).toBe(200)
    expect(await ledger.table('ledger').get('main')).toMatchObject({ used: 0, bonus: 0 })
  })

  it('surfaces purchase failures without changing rights or locking future purchases', async () => {
    const hook = await billing()
    bridge.purchase.mockRejectedValueOnce(new Error('StoreKit unavailable'))
    await act(async () => { await hook.result.current.purchase(plans[0][0]) })
    expect(hook.result.current.error).toBe('StoreKit unavailable')
    expect(hook.result.current.balance).toBe(20)
    expect(hook.result.current.busy).toBe(false)
    bridge.purchase.mockResolvedValueOnce({ status: 'purchased', entitlement: active() })
    await act(async () => { await hook.result.current.purchase(plans[0][0]) })
    expect(hook.result.current.dailyQuota).toBe(100)
    expect(hook.result.current.error).toBe('')
  })

  it('suppresses simultaneous purchases while waiting for the native result', async () => {
    const hook = await billing()
    let resolve!: (value: { status: 'purchased'; entitlement: Entitlement }) => void
    bridge.purchase.mockImplementationOnce(() => new Promise(res => { resolve = res }))
    let operation!: Promise<void>
    await act(async () => {
      operation = hook.result.current.purchase(plans[0][0])
      await hook.result.current.purchase(plans[1][0])
    })
    expect(hook.result.current.busy).toBe(true)
    expect(bridge.purchase).toHaveBeenCalledTimes(1)
    await act(async () => { resolve({ status: 'purchased', entitlement: active() }); await operation })
    expect(hook.result.current.busy).toBe(false)
    expect(hook.result.current.dailyQuota).toBe(100)
  })

  it('restores Apple rights, not local bonus or used credits, and remains idempotent', async () => {
    const hook = await billing()
    await act(async () => { await hook.result.current.checkIn(); await spend(5) })
    bridge.restore.mockResolvedValue({ entitlement: active(plans[2][0]) })
    await act(async () => { await hook.result.current.restore(); await hook.result.current.restore() })
    expect(bridge.restore).toHaveBeenCalledTimes(2)
    expect(hook.result.current.dailyQuota).toBe(400)
    expect(hook.result.current.balance).toBe(415)
    expect(hook.result.current.canCheckIn).toBe(false)
    expect(await ledger.table('ledger').get('main')).toMatchObject({ used: 5, bonus: 20 })
    bridge.restore.mockResolvedValue({ entitlement: free })
    await act(async () => { await hook.result.current.restore() })
    expect(hook.result.current.balance).toBe(35)
    expect(hook.result.current.dailyQuota).toBe(20)
  })

  it('restores on a clean device without restoring check-in rewards from another device', async () => {
    const hook = await billing()
    bridge.restore.mockResolvedValue({ entitlement: active() })
    await act(async () => { await hook.result.current.restore() })
    expect(hook.result.current.balance).toBe(100)
    expect(hook.result.current.canCheckIn).toBe(true)
    expect(await ledger.table('ledger').get('main')).toMatchObject({ used: 0, bonus: 0, checkedIn: null })
  })

  it('reports failed restore and preserves existing local credits', async () => {
    const hook = await billing()
    await act(async () => { await hook.result.current.checkIn(); await spend(1) })
    bridge.restore.mockRejectedValueOnce(new Error('Apple restore failed'))
    await act(async () => { await hook.result.current.restore() })
    expect(hook.result.current.error).toBe('Apple restore failed')
    expect(hook.result.current.balance).toBe(39)
    expect(hook.result.current.entitlement).toEqual(free)
    expect(hook.result.current.busy).toBe(false)
  })

  it('accepts later approval via entitlementChanged, not via pending purchase', async () => {
    const hook = await billing()
    bridge.purchase.mockResolvedValue({ status: 'pending' })
    await act(async () => { await hook.result.current.purchase(plans[0][0]) })
    expect(hook.result.current.balance).toBe(20)
    await change(active())
    expect(hook.result.current.balance).toBe(100)
    expect(hook.result.current.dailyQuota).toBe(100)
  })

  it('filters unrecognized native products without replacing Apple display prices', async () => {
    bridge.products.mockResolvedValue({ products: [...products, { ...products[0], id: 'unknown.product' }] })
    const hook = await billing()
    expect(hook.result.current.products).toEqual(products)
  })

  it.each(['web', 'android'])('does not invoke Apple purchase or restore on %s', async platform => {
    bridge.platform = platform
    bridge.isNative = platform !== 'web'
    const hook = await billing()
    expect(nativeBillingAvailable()).toBe(false)
    bridge.purchase.mockClear(); bridge.restore.mockClear()
    await expect(hook.result.current.purchase(plans[0][0])).rejects.toThrow('iPhone App')
    await expect(hook.result.current.restore()).rejects.toThrow('iPhone App')
    expect(bridge.purchase).not.toHaveBeenCalled()
    expect(bridge.restore).not.toHaveBeenCalled()
    expect(hook.result.current.entitlement).toEqual(free)
  })
})
