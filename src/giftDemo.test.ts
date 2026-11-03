import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CharacterId } from './data'
import { demoDb, gifts, loadDemoWallet, rechargeDemo, rechargePacks, sendDemoGift, subscribeDemoWallet } from './giftDemo'

beforeEach(async () => {
  vi.restoreAllMocks()
  // Only this suite's fake-indexeddb demo DB; never the chat DB or localStorage.
  await demoDb.delete()
  await demoDb.open()
})

describe('noncharging local demo wallet', () => {
  it('starts at zero in its separate DB and persists through reopening', async () => {
    expect(demoDb.name).toBe('aily-gift-demo')
    expect(await loadDemoWallet()).toEqual({ balance: 0, transactions: [] })
    expect(await demoDb.wallet.count()).toBe(0)
    await rechargeDemo('demo-100')
    const saved = await sendDemoGift('flower', 'lu', 2)
    demoDb.close()
    await demoDb.open()
    expect(await loadDemoWallet()).toEqual(saved)
    expect(saved.balance).toBe(80)
  })

  it('has three immutable integer-price gifts, fixed demo feedback, and coin-only packs', () => {
    expect(gifts.map(gift => gift.id)).toEqual(['flower', 'drink', 'lamp'])
    for (const gift of gifts) {
      expect(Number.isSafeInteger(gift.cost) && gift.cost > 0).toBe(true)
      expect(gift.name).toBeTruthy()
      expect(gift.emoji).toBeTruthy()
      expect(gift.description).toContain('演示')
      expect(gift.feedback).toContain('固定文案，非 AI 生成')
      expect(Object.isFrozen(gift)).toBe(true)
    }
    expect(Object.isFrozen(gifts)).toBe(true)
    expect(Object.isFrozen(rechargePacks)).toBe(true)
    for (const pack of rechargePacks) {
      expect(Object.keys(pack).sort()).toEqual(['coins', 'id'])
      expect(Number.isSafeInteger(pack.coins) && pack.coins > 0).toBe(true)
      expect(Object.isFrozen(pack)).toBe(true)
    }
    expect(() => { (gifts[0] as { cost: number }).cost = 1 }).toThrow()
  })

  it('recharges every allowed pack with positive credit ledger entries and no recipient', async () => {
    let total = 0
    for (const pack of rechargePacks) {
      total += pack.coins
      const snapshot = await rechargeDemo(pack.id)
      expect(snapshot.balance).toBe(total)
    }
    const snapshot = await loadDemoWallet()
    expect(snapshot.transactions).toHaveLength(rechargePacks.length)
    expect(new Set(snapshot.transactions.map(entry => entry.id)).size).toBe(rechargePacks.length)
    for (const entry of snapshot.transactions) {
      expect(entry.kind).toBe('recharge')
      expect(Number.isSafeInteger(entry.coins) && entry.coins > 0).toBe(true)
      expect(Number.isFinite(Date.parse(entry.createdAt))).toBe(true)
      expect(Object.keys(entry).sort()).toEqual(['coins', 'createdAt', 'id', 'kind'])
    }
  })

  it('gifts quantities to all valid recipients using authoritative catalog fields', async () => {
    await rechargeDemo('demo-1000')
    let expectedBalance = 1000
    for (const [index, characterId] of (['lu', 'chen', 'gu'] as const).entries()) {
      const gift = gifts[index]
      const quantity = index + 2
      expectedBalance -= gift.cost * quantity
      const snapshot = await sendDemoGift(gift.id, characterId, quantity)
      expect(snapshot.balance).toBe(expectedBalance)
      const ledger = snapshot.transactions.find(entry => entry.characterId === characterId)
      expect(ledger).toMatchObject({ kind: 'gift', coins: gift.cost * quantity, characterId, giftId: gift.id, giftName: gift.name, quantity })
      expect(ledger?.id).toEqual(expect.any(String))
      expect(Number.isFinite(Date.parse(ledger!.createdAt))).toBe(true)
    }
    expect((await loadDemoWallet()).transactions).toHaveLength(4)
  })

  it('allows quantity 99 and spending the exact balance down to zero', async () => {
    await rechargeDemo('demo-1000')
    expect((await sendDemoGift('flower', 'gu', 99)).balance).toBe(10)
    expect((await sendDemoGift('flower', 'gu', 1)).balance).toBe(0)
  })

  it('rejects insufficient funds without creating a wallet or ledger entry', async () => {
    await expect(sendDemoGift('flower', 'lu', 1)).rejects.toThrow('演示币不足')
    expect(await demoDb.wallet.count()).toBe(0)
    expect(await demoDb.transactions.count()).toBe(0)
    await rechargeDemo('demo-100')
    const before = await loadDemoWallet()
    await expect(sendDemoGift('lamp', 'chen', 3)).rejects.toThrow('演示币不足')
    expect(await loadDemoWallet()).toEqual(before)
  })

  it('rejects invalid IDs, recipients and quantities without any writes', async () => {
    await rechargeDemo('demo-1000')
    const before = await loadDemoWallet()
    for (const id of ['', 'unknown', 'DEMO-100', '100', undefined, null, 100]) {
      await expect(rechargeDemo(id as string)).rejects.toThrow('演示充值包无效')
    }
    for (const id of ['', 'unknown', 'FLOWER', undefined, null, 10]) {
      await expect(sendDemoGift(id as string, 'lu', 1)).rejects.toThrow('演示礼物无效')
    }
    for (const recipient of ['', 'unknown', 'LU', undefined, null, 1]) {
      await expect(sendDemoGift('flower', recipient as CharacterId, 1)).rejects.toThrow('收礼角色无效')
    }
    for (const quantity of [0, -1, 100, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, '2', undefined, null]) {
      await expect(sendDemoGift('flower', 'lu', quantity as number)).rejects.toThrow('礼物数量须为 1–99 的整数')
    }
    expect(await loadDemoWallet()).toEqual(before)
  })

  it('rejects safe-integer overflow without balance or ledger writes', async () => {
    await demoDb.wallet.put({ id: 'main', balance: Number.MAX_SAFE_INTEGER - 99 })
    const before = await loadDemoWallet()
    await expect(rechargeDemo('demo-100')).rejects.toThrow('演示余额超出上限')
    expect(await loadDemoWallet()).toEqual(before)
    await sendDemoGift('flower', 'lu', 1)
    expect((await loadDemoWallet()).balance).toBe(Number.MAX_SAFE_INTEGER - 109)
  })

  it('rolls back the balance write if the ledger write fails', async () => {
    await rechargeDemo('demo-100')
    const before = await loadDemoWallet()
    vi.spyOn(demoDb.transactions, 'add').mockRejectedValueOnce(new Error('写入失败'))
    await expect(sendDemoGift('flower', 'lu', 1)).rejects.toThrow('写入失败')
    expect(await loadDemoWallet()).toEqual(before)
  })

  it('serializes concurrent gifts so only affordable operations commit', async () => {
    await rechargeDemo('demo-100')
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => sendDemoGift('flower', 'lu', 1)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(10)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(2)
    const snapshot = await loadDemoWallet()
    expect(snapshot.balance).toBe(0)
    expect(snapshot.transactions.filter(entry => entry.kind === 'gift')).toHaveLength(10)
    expect(new Set(snapshot.transactions.map(entry => entry.id)).size).toBe(11)
  })

  it('serializes concurrent recharges and gifts with no lost balance or ledger updates', async () => {
    await rechargeDemo('demo-1000')
    await Promise.all([
      ...Array.from({ length: 15 }, () => rechargeDemo('demo-100')),
      ...Array.from({ length: 15 }, () => sendDemoGift('flower', 'chen', 2)),
    ])
    const snapshot = await loadDemoWallet()
    expect(snapshot.balance).toBe(2200)
    expect(snapshot.transactions).toHaveLength(31)
    const ledgerBalance = snapshot.transactions.reduce((sum, entry) => sum + (entry.kind === 'recharge' ? entry.coins : -entry.coins), 0)
    expect(snapshot.balance).toBe(ledgerBalance)
  })

  it('serializes operations across independent database connections like separate tabs', async () => {
    vi.resetModules()
    const otherTab = await import('./giftDemo')
    try {
      expect(otherTab.demoDb).not.toBe(demoDb)
      await rechargeDemo('demo-100')
      const results = await Promise.allSettled([
        sendDemoGift('lamp', 'lu', 1),
        otherTab.sendDemoGift('lamp', 'chen', 1),
        otherTab.sendDemoGift('lamp', 'gu', 1),
      ])
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2)
      expect((await loadDemoWallet()).balance).toBe(0)
      await Promise.all([rechargeDemo('demo-100'), otherTab.rechargeDemo('demo-300')])
      expect((await otherTab.loadDemoWallet()).balance).toBe(400)
      expect((await loadDemoWallet()).transactions).toHaveLength(5)
    } finally {
      otherTab.demoDb.close()
    }
  })

  it('publishes liveQuery snapshots and stops delivery after unsubscribe', async () => {
    const onNext = vi.fn()
    const onError = vi.fn()
    const unsubscribe = subscribeDemoWallet(onNext, onError)
    try {
      await vi.waitFor(() => expect(onNext).toHaveBeenLastCalledWith({ balance: 0, transactions: [] }))
      const next = await rechargeDemo('demo-100')
      await vi.waitFor(() => expect(onNext).toHaveBeenLastCalledWith(next))
      unsubscribe()
      const count = onNext.mock.calls.length
      await sendDemoGift('flower', 'lu', 1)
      // Wait for another active observer, not an arbitrary sleep, to prove the
      // mutation has been observed while the removed observer stays silent.
      const active = vi.fn()
      const stop = subscribeDemoWallet(active, onError)
      try {
        await vi.waitFor(() => expect(active).toHaveBeenCalled())
        expect(onNext).toHaveBeenCalledTimes(count)
        expect(onError).not.toHaveBeenCalled()
      } finally { stop() }
    } finally { unsubscribe() }
  })

  it('forwards subscription errors rather than silently replacing invalid balances', async () => {
    await demoDb.wallet.put({ id: 'main', balance: -1 })
    const onNext = vi.fn()
    const onError = vi.fn()
    const unsubscribe = subscribeDemoWallet(onNext, onError)
    try {
      await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: '演示余额无效' })))
      expect(onNext).not.toHaveBeenCalled()
      await expect(rechargeDemo('demo-100')).rejects.toThrow('演示余额无效')
      expect(await demoDb.transactions.count()).toBe(0)
      expect((await demoDb.wallet.get('main'))?.balance).toBe(-1)
    } finally { unsubscribe() }
  })
})
