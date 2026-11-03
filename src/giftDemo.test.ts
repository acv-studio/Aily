import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import type { CharacterId } from './data'
import { completeDemoStoryEvent, demoDb, gifts, loadDemoStoryEvents, loadDemoWallet, rechargeDemo, rechargePacks, sendDemoGift, subscribeDemoStoryEvents, subscribeDemoWallet } from './giftDemo'
import { storyGiftEvents } from './storyGifts'

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

  it('has immutable integer-price gifts, fixed demo feedback, and coin-only packs', () => {
    expect(gifts.map(gift => gift.id)).toEqual(['flower', 'drink', 'lamp', 'concert-ticket', 'suitcase', 'camera'])
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

describe('fixed local story gifts', () => {
  it('has deeply immutable two-choice stories mapped to the exact demo gift prices', () => {
    expect(gifts.filter(gift => gift.storyEventId).map(gift => [gift.id, gift.cost, gift.storyEventId]))
      .toEqual([['concert-ticket', 100, 'concert'], ['suitcase', 150, 'travel'], ['camera', 120, 'photo']])
    expect(storyGiftEvents.map(event => event.id)).toEqual(['concert', 'travel', 'photo'])
    expect(Object.isFrozen(storyGiftEvents)).toBe(true)
    for (const event of storyGiftEvents) {
      expect(Object.isFrozen(event)).toBe(true)
      expect(event.title).toBeTruthy()
      expect(event.intro).toContain('固定剧情，非 AI 生成')
      expect(Object.isFrozen(event.choices)).toBe(true)
      expect(event.choices).toHaveLength(2)
      expect(new Set(event.choices.map(choice => choice.id)).size).toBe(2)
      for (const choice of event.choices) {
        expect(Object.isFrozen(choice)).toBe(true)
        expect(choice.label).toBeTruthy()
        expect(choice.response).toContain('固定剧情，非 AI 生成')
      }
    }
    expect(() => { (storyGiftEvents[0].choices[0] as { response: string }).response = 'changed' }).toThrow()
  })

  it('migrates a v1 demo DB without changing its wallet or ledger', async () => {
    await demoDb.delete()
    const legacy = new Dexie('aily-gift-demo')
    legacy.version(1).stores({ wallet: 'id', transactions: 'id, createdAt, kind, characterId' })
    const transaction = { id: 'legacy-credit', kind: 'recharge', coins: 300, createdAt: '2026-01-01T00:00:00.000Z' }
    try {
      await legacy.table('wallet').put({ id: 'main', balance: 300 })
      await legacy.table('transactions').add(transaction)
    } finally { legacy.close() }
    await demoDb.open()
    expect(demoDb.verno).toBe(2)
    expect(await loadDemoWallet()).toEqual({ balance: 300, transactions: [transaction] })
    expect(await loadDemoStoryEvents()).toEqual([])
    expect((await sendDemoGift('suitcase', 'chen', 1)).balance).toBe(150)
    expect(await loadDemoStoryEvents()).toHaveLength(1)
  })

  it('debits, records the gift and unlocks exactly one linked story; ordinary gifts do not unlock', async () => {
    await rechargeDemo('demo-1000')
    await sendDemoGift('flower', 'lu', 2)
    expect(await loadDemoStoryEvents()).toEqual([])
    const snapshot = await sendDemoGift('concert-ticket', 'lu', 1)
    expect(Object.keys(snapshot).sort()).toEqual(['balance', 'transactions'])
    expect(snapshot.balance).toBe(880)
    const entry = snapshot.transactions.find(item => item.giftId === 'concert-ticket')!
    expect(entry).toMatchObject({ coins: 100, quantity: 1, characterId: 'lu', kind: 'gift' })
    expect(await loadDemoStoryEvents()).toEqual([{
      id: 'lu:concert', characterId: 'lu', eventId: 'concert',
      transactionId: entry.id, unlockedAt: entry.createdAt,
    }])
  })

  it('rejects every non-one story quantity before any writes', async () => {
    await rechargeDemo('demo-1000')
    const before = await loadDemoWallet()
    for (const giftId of ['concert-ticket', 'suitcase', 'camera']) {
      for (const quantity of [0, -1, 2, 99, 100, 1.5, NaN, Infinity, '1', undefined, null]) {
        await expect(sendDemoGift(giftId, 'lu', quantity as number)).rejects.toThrow('剧情礼物数量只能为 1')
      }
    }
    expect(await loadDemoWallet()).toEqual(before)
    expect(await loadDemoStoryEvents()).toEqual([])
  })

  it('rejects an owned event before checking funds or debiting, even after completion', async () => {
    await rechargeDemo('demo-100')
    await sendDemoGift('concert-ticket', 'lu', 1)
    await completeDemoStoryEvent('lu', 'concert', 'cheer')
    const before = await loadDemoWallet()
    const events = await loadDemoStoryEvents()
    await expect(sendDemoGift('concert-ticket', 'lu', 1)).rejects.toThrow('该角色已拥有此演示剧情')
    expect(await loadDemoWallet()).toEqual(before)
    expect(await loadDemoStoryEvents()).toEqual(events)
  })

  it('rolls back debit and ledger on unlock failure, and never unlocks on ledger or funds failure', async () => {
    await expect(sendDemoGift('camera', 'gu', 1)).rejects.toThrow('演示币不足')
    expect(await loadDemoWallet()).toEqual({ balance: 0, transactions: [] })
    expect(await loadDemoStoryEvents()).toEqual([])
    await rechargeDemo('demo-1000')
    const before = await loadDemoWallet()
    vi.spyOn(demoDb.storyEvents, 'add').mockRejectedValueOnce(new Error('剧情写入失败'))
    await expect(sendDemoGift('camera', 'gu', 1)).rejects.toThrow('剧情写入失败')
    expect(await loadDemoWallet()).toEqual(before)
    expect(await loadDemoStoryEvents()).toEqual([])
    vi.spyOn(demoDb.transactions, 'add').mockRejectedValueOnce(new Error('流水写入失败'))
    await expect(sendDemoGift('suitcase', 'gu', 1)).rejects.toThrow('流水写入失败')
    expect(await loadDemoWallet()).toEqual(before)
    expect(await loadDemoStoryEvents()).toEqual([])
    // Failure after all three writes must roll back the unlock as well.
    vi.spyOn(demoDb.transactions, 'toArray').mockRejectedValueOnce(new Error('快照读取失败'))
    await expect(sendDemoGift('concert-ticket', 'gu', 1)).rejects.toThrow('快照读取失败')
    expect(await loadDemoWallet()).toEqual(before)
    expect(await loadDemoStoryEvents()).toEqual([])
  })

  it('serializes concurrent same-event unlocks across separate connections with only one debit', async () => {
    vi.resetModules()
    const otherTab = await import('./giftDemo')
    try {
      await rechargeDemo('demo-1000')
      const results = await Promise.allSettled([
        sendDemoGift('camera', 'chen', 1), otherTab.sendDemoGift('camera', 'chen', 1),
        sendDemoGift('camera', 'chen', 1), otherTab.sendDemoGift('camera', 'chen', 1),
      ])
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      for (const result of results) {
        if (result.status === 'rejected') expect(result.reason.message).toContain('该角色已拥有此演示剧情')
      }
      expect((await loadDemoWallet()).balance).toBe(880)
      expect((await loadDemoWallet()).transactions).toHaveLength(2)
      expect(await otherTab.loadDemoStoryEvents()).toEqual(await loadDemoStoryEvents())
      expect(await loadDemoStoryEvents()).toHaveLength(1)
    } finally { otherTab.demoDb.close() }
  })

  it('isolates ownership and completion by character and event', async () => {
    await rechargeDemo('demo-1000')
    for (const characterId of ['lu', 'chen', 'gu'] as const) await sendDemoGift('concert-ticket', characterId, 1)
    await sendDemoGift('camera', 'lu', 1)
    expect((await loadDemoWallet()).balance).toBe(580)
    expect(await loadDemoStoryEvents()).toHaveLength(4)
    await completeDemoStoryEvent('lu', 'concert', 'cheer')
    await completeDemoStoryEvent('chen', 'concert', 'listen')
    expect(await demoDb.storyEvents.get('gu:concert')).not.toHaveProperty('choiceId')
    expect(await demoDb.storyEvents.get('lu:photo')).not.toHaveProperty('choiceId')
    await expect(completeDemoStoryEvent('chen', 'photo', 'portrait')).rejects.toThrow('该角色尚未解锁此演示剧情')
    expect(await demoDb.storyEvents.get('lu:concert')).toHaveProperty('choiceId', 'cheer')
    expect(await demoDb.storyEvents.get('chen:concert')).toHaveProperty('choiceId', 'listen')
  })

  it('checks catalog, choices, recipient and ownership without changing any state', async () => {
    await rechargeDemo('demo-300')
    await sendDemoGift('concert-ticket', 'lu', 1)
    const before = await loadDemoWallet()
    const events = await loadDemoStoryEvents()
    for (const eventId of ['', 'unknown', 'CONCERT', undefined, null]) {
      await expect(completeDemoStoryEvent('lu', eventId as string, 'cheer')).rejects.toThrow('演示剧情无效')
    }
    for (const choiceId of ['', 'unknown', 'portrait', 'CHEER', undefined, null]) {
      await expect(completeDemoStoryEvent('lu', 'concert', choiceId as string)).rejects.toThrow('演示剧情选项无效')
    }
    for (const characterId of ['', 'unknown', undefined, null]) {
      await expect(completeDemoStoryEvent(characterId as CharacterId, 'concert', 'cheer')).rejects.toThrow('剧情角色无效')
    }
    await expect(completeDemoStoryEvent('gu', 'concert', 'cheer')).rejects.toThrow('该角色尚未解锁此演示剧情')
    expect(await loadDemoWallet()).toEqual(before)
    expect(await loadDemoStoryEvents()).toEqual(events)
  })

  it('completes once, keeps same-choice repeats idempotent and rejects changes after reload', async () => {
    await rechargeDemo('demo-300')
    await sendDemoGift('suitcase', 'lu', 1)
    const beforeWallet = await loadDemoWallet()
    const beforeEvent = (await loadDemoStoryEvents())[0]
    demoDb.close()
    await demoDb.open()
    expect(await loadDemoStoryEvents()).toEqual([beforeEvent])
    const completed = await completeDemoStoryEvent('lu', 'travel', 'seaside')
    expect(completed).toEqual({ ...beforeEvent, choiceId: 'seaside', completedAt: expect.any(String) })
    expect(Number.isFinite(Date.parse(completed.completedAt!))).toBe(true)
    expect(await completeDemoStoryEvent('lu', 'travel', 'seaside')).toEqual(completed)
    await expect(completeDemoStoryEvent('lu', 'travel', 'mountains')).rejects.toThrow('演示剧情已完成，不能更改选项')
    demoDb.close()
    await demoDb.open()
    expect(await loadDemoStoryEvents()).toEqual([completed])
    expect(await loadDemoWallet()).toEqual(beforeWallet)
    expect(await completeDemoStoryEvent('lu', 'travel', 'seaside')).toEqual(completed)
    await expect(completeDemoStoryEvent('lu', 'travel', 'mountains')).rejects.toThrow('演示剧情已完成')
  })

  it('rolls back a failed completion so a subsequent valid completion can win', async () => {
    await rechargeDemo('demo-300')
    await sendDemoGift('camera', 'gu', 1)
    const events = await loadDemoStoryEvents()
    const wallet = await loadDemoWallet()
    vi.spyOn(demoDb.storyEvents, 'put').mockRejectedValueOnce(new Error('结局写入失败'))
    await expect(completeDemoStoryEvent('gu', 'photo', 'portrait')).rejects.toThrow('结局写入失败')
    expect(await loadDemoStoryEvents()).toEqual(events)
    expect(await loadDemoWallet()).toEqual(wallet)
    expect(await completeDemoStoryEvent('gu', 'photo', 'scenery')).toHaveProperty('choiceId', 'scenery')
  })

  it('serializes concurrent competing completions across connections; first valid choice wins', async () => {
    vi.resetModules()
    const otherTab = await import('./giftDemo')
    try {
      await rechargeDemo('demo-100')
      await sendDemoGift('concert-ticket', 'lu', 1)
      const results = await Promise.allSettled([
        completeDemoStoryEvent('lu', 'concert', 'cheer'),
        otherTab.completeDemoStoryEvent('lu', 'concert', 'listen'),
      ])
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
      const winner = (await loadDemoStoryEvents())[0]
      const repeats = await Promise.all([
        completeDemoStoryEvent('lu', 'concert', winner.choiceId!),
        otherTab.completeDemoStoryEvent('lu', 'concert', winner.choiceId!),
        completeDemoStoryEvent('lu', 'concert', winner.choiceId!),
      ])
      expect(repeats).toEqual([winner, winner, winner])
      expect((await loadDemoWallet()).transactions).toHaveLength(2)
      expect((await loadDemoWallet()).balance).toBe(0)
      const rejected = results.find(result => result.status === 'rejected')
      if (rejected?.status === 'rejected') expect(rejected.reason.message).toContain('演示剧情已完成')
    } finally { otherTab.demoDb.close() }
  })

  it('publishes unlock and completion snapshots and stops delivery on unsubscribe', async () => {
    const onNext = vi.fn()
    const onError = vi.fn()
    const stop = subscribeDemoStoryEvents(onNext, onError)
    try {
      await vi.waitFor(() => expect(onNext).toHaveBeenLastCalledWith([]))
      await rechargeDemo('demo-300')
      await sendDemoGift('camera', 'lu', 1)
      await vi.waitFor(() => expect(onNext).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'lu:photo' })])))
      const completed = await completeDemoStoryEvent('lu', 'photo', 'portrait')
      await vi.waitFor(() => expect(onNext).toHaveBeenLastCalledWith([completed]))
      stop()
      const count = onNext.mock.calls.length
      await sendDemoGift('concert-ticket', 'chen', 1)
      const active = vi.fn()
      const stopActive = subscribeDemoStoryEvents(active, onError)
      try {
        await vi.waitFor(() => expect(active).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'chen:concert' })])))
        expect(onNext).toHaveBeenCalledTimes(count)
        expect(onError).not.toHaveBeenCalled()
      } finally { stopActive() }
    } finally { stop() }
  })

  it('forwards story subscription read failures', async () => {
    vi.spyOn(demoDb.storyEvents, 'toArray').mockRejectedValueOnce(new Error('剧情读取失败'))
    const onNext = vi.fn()
    const onError = vi.fn()
    const stop = subscribeDemoStoryEvents(onNext, onError)
    try {
      await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: '剧情读取失败' })))
      expect(onNext).not.toHaveBeenCalled()
    } finally { stop() }
  })
})
