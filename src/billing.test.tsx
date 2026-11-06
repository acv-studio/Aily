import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshBilling, reservePoints, useBilling } from './billing'
import { interpretDivination, streamReply } from './chatService'

// Use the existing fake-indexeddb setup and the real ledger, not a billing mock.
const ledger = new Dexie('aily-billing-v1')
ledger.version(1).stores({ ledger: 'id' })
const at = (day: number, hour = 12, minute = 0) => new Date(2026, 0, day, hour, minute)
beforeEach(async () => {
  // IndexedDB uses real asynchronous tasks; fake only Date to cross local midnight.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at(2))
  await ledger.table('ledger').clear()
  await refreshBilling()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })
async function billing() {
  const hook = renderHook(() => useBilling())
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  return hook
}
async function spend(cost: 1 | 5) { const hold = await reservePoints(cost); await hold.commit() }

describe('real local points ledger', () => {
  it('shares credits across subscribers and awards exactly one fixed check-in bonus', async () => {
    const first = await billing(), second = await billing()
    expect(first.result.current.balance).toBe(20)
    await act(async () => { await first.result.current.checkIn() })
    expect(first.result.current.balance).toBe(40)
    expect(second.result.current.balance).toBe(40)
    expect(second.result.current.canCheckIn).toBe(false)
    await act(async () => { await expect(second.result.current.checkIn()).rejects.toThrow('今天已签到') })
    expect(second.result.current.balance).toBe(40)
  })

  it('spends daily allowance before bonus and carries only unspent bonus into the next local day', async () => {
    const hook = await billing()
    await act(async () => {
      await hook.result.current.checkIn()
      for (let i = 0; i < 5; i++) await spend(5)
    })
    expect(hook.result.current.balance).toBe(15)
    expect(await ledger.table('ledger').get('main')).toMatchObject({ used: 20, bonus: 15, checkedIn: '2026-01-02' })
    vi.setSystemTime(at(3))
    await act(async () => { await refreshBilling() })
    expect(hook.result.current.balance).toBe(35)
    expect(hook.result.current.dailyQuota).toBe(20)
    expect(hook.result.current.canCheckIn).toBe(true)
    await act(async () => { await hook.result.current.checkIn() })
    expect(hook.result.current.balance).toBe(55)
    // Neither repeated refresh nor a remount should mint another daily allowance.
    await act(async () => { await refreshBilling(); await refreshBilling() })
    hook.unmount()
    const remount = await billing()
    expect(remount.result.current.balance).toBe(55)
  })

  it('uses device-local midnight rather than UTC elapsed time to reset usage and stale holds', async () => {
    vi.setSystemTime(at(2, 23, 59))
    const hook = await billing()
    let old!: Awaited<ReturnType<typeof reservePoints>>
    await act(async () => { await spend(5); old = await reservePoints(5) })
    expect(hook.result.current.balance).toBe(10)
    vi.setSystemTime(at(3, 0, 0))
    await act(async () => { await refreshBilling() })
    expect(hook.result.current.balance).toBe(20)
    expect(await ledger.table('ledger').get('main')).toMatchObject({ day: '2026-01-03', used: 0, holds: {} })
    await act(async () => { await expect(old.commit()).rejects.toThrow('请求已过期'); await old.release() })
    expect(hook.result.current.balance).toBe(20)
  })

  it('releases failed reservations without spending and settles sequential commit/release exactly once', async () => {
    const hook = await billing()
    let hold!: Awaited<ReturnType<typeof reservePoints>>
    await act(async () => { hold = await reservePoints(5) })
    expect(hook.result.current.balance).toBe(15)
    await act(async () => { await hold.release(); await hold.release(); await hold.commit() })
    expect(hook.result.current.balance).toBe(20)
    await act(async () => { hold = await reservePoints(5); await hold.commit(); await hold.commit(); await hold.release() })
    expect(hook.result.current.balance).toBe(15)
    expect(await ledger.table('ledger').get('main')).toMatchObject({ used: 5, holds: {} })
  })

  it('makes concurrent commits and a competing release on the same reservation settle only once', async () => {
    const hook = await billing()
    let hold!: Awaited<ReturnType<typeof reservePoints>>
    await act(async () => { hold = await reservePoints(5) })
    await act(async () => {
      await Promise.all([hold.commit(), hold.commit(), hold.release(), hold.commit()])
    })
    expect(hook.result.current.balance).toBe(15)
    expect(await ledger.table('ledger').get('main')).toMatchObject({ used: 5, bonus: 0, holds: {} })
    await act(async () => { await hold.release(); await hold.commit() })
    expect(hook.result.current.balance).toBe(15)
  })

  it('lets the first concurrent release refund a reservation without a competing commit charging it', async () => {
    const hook = await billing()
    let hold!: Awaited<ReturnType<typeof reservePoints>>
    await act(async () => { hold = await reservePoints(5) })
    await act(async () => {
      await Promise.all([hold.release(), hold.commit(), hold.release(), hold.commit()])
    })
    expect(hook.result.current.balance).toBe(20)
    expect(await ledger.table('ledger').get('main')).toMatchObject({ used: 0, bonus: 0, holds: {} })
  })

  it('cleans expired reservations after two minutes without charging their late completion', async () => {
    const hook = await billing()
    let hold!: Awaited<ReturnType<typeof reservePoints>>
    await act(async () => { hold = await reservePoints(5) })
    vi.setSystemTime(new Date(at(2).getTime() + 120_000))
    await act(async () => { await refreshBilling() })
    expect(hook.result.current.balance).toBe(15)
    vi.setSystemTime(new Date(at(2).getTime() + 120_001))
    await act(async () => { await refreshBilling() })
    expect(hook.result.current.balance).toBe(20)
    await act(async () => { await expect(hold.commit()).rejects.toThrow('请求已过期'); await hold.release() })
    expect(await ledger.table('ledger').get('main')).toMatchObject({ used: 0, holds: {} })
  })

  it('serializes concurrent reservations so oversubscription never spends below zero', async () => {
    const hook = await billing()
    let results!: PromiseSettledResult<Awaited<ReturnType<typeof reservePoints>>>[]
    await act(async () => { results = await Promise.allSettled(Array.from({ length: 8 }, () => reservePoints(5))) })
    const accepted = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof reservePoints>>> => result.status === 'fulfilled')
    expect(accepted).toHaveLength(4)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(4)
    expect(hook.result.current.balance).toBe(0)
    await act(async () => { await Promise.all(accepted.map(result => result.value.commit())) })
    expect(await ledger.table('ledger').get('main')).toMatchObject({ used: 20, bonus: 0, holds: {} })
    await act(async () => { await expect(reservePoints(1)).rejects.toThrow('积分不足') })
    expect(hook.result.current.balance).toBe(0)
  })

  it('serializes simultaneous check-ins without awarding duplicate bonuses', async () => {
    const hook = await billing()
    let results!: PromiseSettledResult<void>[]
    await act(async () => { results = await Promise.allSettled([hook.result.current.checkIn(), hook.result.current.checkIn()]) })
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(hook.result.current.balance).toBe(40)
    expect(await ledger.table('ledger').get('main')).toMatchObject({ bonus: 20, checkedIn: '2026-01-02' })
  })

  it.each([0, -1, 2, 7, 1.5, NaN, Infinity])('rejects invalid point cost %s without creating a reservation', async cost => {
    await expect(reservePoints(cost)).rejects.toThrow('无效的积分消耗')
    expect(await ledger.table('ledger').get('main')).toMatchObject({ used: 0, holds: {} })
  })
})

describe('real ledger model metering integration', () => {
  const endpoint = 'http://127.0.0.1:3425/v1/messages'
  const request = { characterId: 'lu' as const, messages: [{ id: 1, from: 'user' as const, text: 'Hi', time: '' }], memories: [], apiKey: 'test', endpoint, model: 'test', onDelta: vi.fn() }
  it('charges spoken chat and divination from the same persisted pool and refunds provider failures', async () => {
    const hook = await billing()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: [{ type: 'text', text: 'Hello there.' }] })))
      .mockResolvedValueOnce(new Response('failed', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: [{ type: 'text', text: 'Reflect on the change.' }] })))
    await act(async () => { await streamReply({ ...request, billingCost: 5 }) })
    expect(hook.result.current.balance).toBe(15)
    await act(async () => { await expect(streamReply(request)).rejects.toThrow() })
    expect(hook.result.current.balance).toBe(15)
    await act(async () => { await interpretDivination({ apiKey: 'test', endpoint, model: 'test', question: 'reflection', original: '乾', nuclear: '乾', changed: '坤', movingLine: 1 }) })
    expect(hook.result.current.balance).toBe(14)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(await ledger.table('ledger').get('main')).toMatchObject({ used: 6, holds: {} })
  })

  it('does not contact the provider after other consumers exhaust the pool', async () => {
    const hook = await billing()
    await act(async () => { for (let i = 0; i < 4; i++) await spend(5) })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await act(async () => { await expect(streamReply(request)).rejects.toThrow('积分不足') })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(hook.result.current.balance).toBe(0)
  })
})
