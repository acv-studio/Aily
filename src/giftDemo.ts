import { t } from './i18n'
import Dexie, { liveQuery, type EntityTable } from 'dexie'
import type { CharacterId } from './data'

export interface DemoGift {
  id: string
  name: string
  emoji: string
  /** Integer demo coins only; never a real-money price. */
  cost: number
  description: string
  /** Fixed local demo copy, not an AI-generated response. */
  feedback: string
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

type DemoWallet = { id: 'main'; balance: number }

class DemoDatabase extends Dexie {
  wallet!: EntityTable<DemoWallet, 'id'>
  transactions!: EntityTable<DemoTransaction, 'id'>

  constructor() {
    // Deliberately separate from the chat database; never migrate/reset chat data.
    super('aily-gift-demo')
    this.version(1).stores({ wallet: 'id', transactions: 'id, createdAt, kind, characterId' })
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

async function applyTransaction(entry: DemoTransaction): Promise<DemoWalletSnapshot> {
  // IndexedDB serializes overlapping read-write store transactions even across
  // connections/tabs. The authoritative read, both writes and returned snapshot
  // share this transaction, so no stale UI balance can overwrite a newer one.
  return demoDb.transaction('rw', demoDb.wallet, demoDb.transactions, async () => {
    const balance = checkedBalance((await demoDb.wallet.get('main'))?.balance ?? 0)
    if (entry.kind === 'gift' && balance < entry.coins) throw new Error(t('演示币不足，请先免费补充'))
    const nextBalance = entry.kind === 'recharge' ? balance + entry.coins : balance - entry.coins
    if (!Number.isSafeInteger(nextBalance) || nextBalance < 0) throw new Error(t('演示余额超出上限'))
    await demoDb.wallet.put({ id: 'main', balance: nextBalance })
    await demoDb.transactions.add(entry)
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
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error(t('礼物数量须为 1–99 的整数'))
  const coins = gift.cost * quantity
  if (!Number.isSafeInteger(coins) || coins <= 0) throw new Error(t('演示金额无效'))
  return applyTransaction({
    id: crypto.randomUUID(), kind: 'gift', coins, createdAt: new Date().toISOString(),
    characterId, giftId: gift.id, giftName: gift.name, quantity,
  })
}

/** Observe this demo DB only. Unsubscribe on unmount to stop delivery. */
export function subscribeDemoWallet(
  onNext: (snapshot: DemoWalletSnapshot) => void,
  onError: (error: unknown) => void,
): () => void {
  const subscription = liveQuery(loadDemoWallet).subscribe({ next: onNext, error: onError })
  return () => subscription.unsubscribe()
}
