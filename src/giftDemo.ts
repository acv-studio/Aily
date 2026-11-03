import { t } from './i18n'
import Dexie, { liveQuery, type EntityTable } from 'dexie'
import type { CharacterId } from './data'
import { storyGiftEvents } from './storyGifts'

export interface DemoGift {
  id: string
  name: string
  emoji: string
  /** Integer demo coins only; never a real-money price. */
  cost: number
  description: string
  /** Fixed local demo copy, not an AI-generated response. */
  feedback: string
  /** Unlocks one fixed local story for this recipient, not chat or AI memory. */
  storyEventId?: string
}

export interface DemoRechargePack {
  id: string
  coins: number
}

// Freeze both the array and records: callers cannot change authoritative prices.
export const gifts: readonly Readonly<DemoGift>[] = Object.freeze([
  Object.freeze({ id: 'flower', name: '鲜花', emoji: '🌷', cost: 10, description: '一束轻轻的心意，仅供本地演示。', feedback: '演示反馈：收到鲜花，今天多了一点明亮。此为固定文案，非 AI 生成。' }),
  Object.freeze({ id: 'drink', name: '热饮', emoji: '☕', cost: 20, description: '一杯暖暖的陪伴，仅供本地演示。', feedback: '演示反馈：收到热饮，暖意已经送达。此为固定文案，非 AI 生成。' }),
  Object.freeze({ id: 'lamp', name: '小夜灯', emoji: '🏮', cost: 50, description: '留一盏温柔的灯，仅供本地演示。', feedback: '演示反馈：收到小夜灯，为今晚留一束暖光。此为固定文案，非 AI 生成。' }),
  Object.freeze({ id: 'concert-ticket', name: '演唱会票', emoji: '🎫', cost: 100, storyEventId: 'concert', description: '解锁一起听演唱会的固定剧情，仅供本地演示。', feedback: '演示反馈：演唱会剧情已解锁，可以选择一起度过的方式。此为固定文案，非 AI 生成。' }),
  Object.freeze({ id: 'suitcase', name: '旅行箱', emoji: '🧳', cost: 150, storyEventId: 'travel', description: '解锁周末小旅行的固定剧情，仅供本地演示。', feedback: '演示反馈：旅行剧情已解锁，可以选择目的地。此为固定文案，非 AI 生成。' }),
  Object.freeze({ id: 'camera', name: '相机', emoji: '📷', cost: 120, storyEventId: 'photo', description: '解锁留下这一刻的固定剧情，仅供本地演示。', feedback: '演示反馈：拍照剧情已解锁，可以选择留下怎样的照片。此为固定文案，非 AI 生成。' }),
])

/** Free local demo credits. No checkout, currency, payment provider or network. */
export const rechargePacks: readonly Readonly<DemoRechargePack>[] = Object.freeze([
  Object.freeze({ id: 'demo-100', coins: 100 }),
  Object.freeze({ id: 'demo-300', coins: 300 }),
  Object.freeze({ id: 'demo-1000', coins: 1000 }),
])

export interface DemoTransaction {
  id: string
  kind: 'recharge' | 'gift'
  /** Positive amount: gift entries are debits, recharge entries are credits. */
  coins: number
  createdAt: string
  characterId?: CharacterId
  giftId?: string
  giftName?: string
  quantity?: number
}

export interface DemoWalletSnapshot {
  balance: number
  transactions: DemoTransaction[]
}

export interface DemoStoryEvent {
  id: `${CharacterId}:${string}`
  characterId: CharacterId
  eventId: string
  transactionId: string
  unlockedAt: string
  choiceId?: string
  completedAt?: string
}

type DemoWallet = { id: 'main'; balance: number }

class DemoDatabase extends Dexie {
  wallet!: EntityTable<DemoWallet, 'id'>
  transactions!: EntityTable<DemoTransaction, 'id'>
  storyEvents!: EntityTable<DemoStoryEvent, 'id'>

  constructor() {
    // Deliberately separate from the chat database; never migrate/reset chat data.
    super('aily-gift-demo')
    this.version(1).stores({ wallet: 'id', transactions: 'id, createdAt, kind, characterId' })
    // Add only the demo story store; existing v1 balances and ledger stay intact.
    this.version(2).stores({
      wallet: 'id', transactions: 'id, createdAt, kind, characterId',
      storyEvents: 'id, characterId, eventId, transactionId, unlockedAt, &[characterId+eventId]',
    })
  }
}

export const demoDb = new DemoDatabase()
const recipientIds: readonly CharacterId[] = ['lu', 'chen', 'gu']

function checkedBalance(balance: number): number {
  if (!Number.isSafeInteger(balance) || balance < 0) throw new Error(t('演示余额无效'))
  return balance
}

async function readSnapshot(): Promise<DemoWalletSnapshot> {
  const [wallet, transactions] = await Promise.all([
    demoDb.wallet.get('main'), demoDb.transactions.toArray(),
  ])
  // Deterministic newest-first ledger, including records sharing a timestamp.
  transactions.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  return { balance: checkedBalance(wallet?.balance ?? 0), transactions }
}

/** A missing wallet means zero; merely viewing it does not create ledger entries. */
export async function loadDemoWallet(): Promise<DemoWalletSnapshot> {
  return demoDb.transaction('r', demoDb.wallet, demoDb.transactions, readSnapshot)
}

async function applyTransaction(entry: DemoTransaction, storyEvent?: DemoStoryEvent): Promise<DemoWalletSnapshot> {
  // IndexedDB serializes overlapping read-write store transactions even across
  // connections/tabs. The authoritative read, both writes and returned snapshot
  // share this transaction, so no stale UI balance can overwrite a newer one.
  return demoDb.transaction('rw', demoDb.wallet, demoDb.transactions, demoDb.storyEvents, async () => {
    // Ownership check precedes debit inside the same serialized transaction.
    if (storyEvent && await demoDb.storyEvents.get(storyEvent.id)) {
      throw new Error(t('该角色已拥有此演示剧情，请勿重复赠送'))
    }
    const balance = checkedBalance((await demoDb.wallet.get('main'))?.balance ?? 0)
    if (entry.kind === 'gift' && balance < entry.coins) throw new Error(t('演示币不足，请先免费补充'))
    const nextBalance = entry.kind === 'recharge' ? balance + entry.coins : balance - entry.coins
    if (!Number.isSafeInteger(nextBalance) || nextBalance < 0) throw new Error(t('演示余额超出上限'))
    await demoDb.wallet.put({ id: 'main', balance: nextBalance })
    await demoDb.transactions.add(entry)
    if (storyEvent) await demoDb.storyEvents.add(storyEvent)
    return readSnapshot()
  })
}

export async function rechargeDemo(packId: string): Promise<DemoWalletSnapshot> {
  const pack = rechargePacks.find(item => item.id === packId)
  if (!pack) throw new Error(t('演示充值包无效'))
  return applyTransaction({ id: crypto.randomUUID(), kind: 'recharge', coins: pack.coins, createdAt: new Date().toISOString() })
}

export async function sendDemoGift(giftId: string, characterId: CharacterId, quantity: number): Promise<DemoWalletSnapshot> {
  const gift = gifts.find(item => item.id === giftId)
  if (!gift) throw new Error(t('演示礼物无效'))
  if (!recipientIds.includes(characterId)) throw new Error(t('收礼角色无效'))
  if (gift.storyEventId && quantity !== 1) throw new Error(t('剧情礼物数量只能为 1'))
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error(t('礼物数量须为 1–99 的整数'))
  if (gift.storyEventId && !storyGiftEvents.some(event => event.id === gift.storyEventId)) {
    throw new Error(t('演示剧情无效'))
  }
  const coins = gift.cost * quantity
  if (!Number.isSafeInteger(coins) || coins <= 0) throw new Error(t('演示金额无效'))
  const entry: DemoTransaction = {
    id: crypto.randomUUID(), kind: 'gift', coins, createdAt: new Date().toISOString(),
    characterId, giftId: gift.id, giftName: gift.name, quantity,
  }
  const storyEvent: DemoStoryEvent | undefined = gift.storyEventId ? {
    id: `${characterId}:${gift.storyEventId}`, characterId, eventId: gift.storyEventId,
    transactionId: entry.id, unlockedAt: entry.createdAt,
  } : undefined
  return applyTransaction(entry, storyEvent)
}

/** Owned stories, deterministically newest-first. No chat/memory reads or writes. */
export async function loadDemoStoryEvents(): Promise<DemoStoryEvent[]> {
  const events = await demoDb.storyEvents.toArray()
  return events.sort((a, b) => b.unlockedAt.localeCompare(a.unlockedAt) || b.id.localeCompare(a.id))
}

/** First valid completion wins; repeating its choice returns the saved record. */
export async function completeDemoStoryEvent(
  characterId: CharacterId, eventId: string, choiceId: string,
): Promise<DemoStoryEvent> {
  if (!recipientIds.includes(characterId)) throw new Error(t('剧情角色无效'))
  const event = storyGiftEvents.find(item => item.id === eventId)
  if (!event) throw new Error(t('演示剧情无效'))
  if (!event.choices.some(choice => choice.id === choiceId)) throw new Error(t('演示剧情选项无效'))
  return demoDb.transaction('rw', demoDb.storyEvents, async () => {
    const owned = await demoDb.storyEvents.get(`${characterId}:${eventId}`)
    if (!owned || owned.characterId !== characterId || owned.eventId !== eventId) {
      throw new Error(t('该角色尚未解锁此演示剧情'))
    }
    if (owned.choiceId !== undefined) {
      if (owned.choiceId !== choiceId) throw new Error(t('演示剧情已完成，不能更改选项'))
      return owned
    }
    const completed: DemoStoryEvent = { ...owned, choiceId, completedAt: new Date().toISOString() }
    await demoDb.storyEvents.put(completed)
    return completed
  })
}

/** Observe owned local stories independently of the unchanged wallet snapshot. */
export function subscribeDemoStoryEvents(
  onNext: (events: DemoStoryEvent[]) => void,
  onError: (error: unknown) => void,
): () => void {
  const subscription = liveQuery(loadDemoStoryEvents).subscribe({ next: onNext, error: onError })
  return () => subscription.unsubscribe()
}

/** Observe this demo DB only. Unsubscribe on unmount to stop delivery. */
export function subscribeDemoWallet(
  onNext: (snapshot: DemoWalletSnapshot) => void,
  onError: (error: unknown) => void,
): () => void {
  const subscription = liveQuery(loadDemoWallet).subscribe({ next: onNext, error: onError })
  return () => subscription.unsubscribe()
}
