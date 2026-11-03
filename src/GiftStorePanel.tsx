import { useI18n } from './i18n'
import { useEffect, useRef, useState } from 'react'
import { characters, type CharacterId } from './data'
import { gifts, rechargePacks, rechargeDemo, sendDemoGift, subscribeDemoWallet, type DemoWalletSnapshot } from './giftDemo'
import './giftStore.css'

type Confirmation = { kind: 'recharge'; packId: string; coins: number } | { kind: 'gift'; giftId: string; characterId: CharacterId; quantity: number }
const giftErrorKeys = ['演示余额无效', '演示币不足，请先免费补充', '演示余额超出上限', '演示充值包无效', '演示礼物无效', '收礼角色无效', '礼物数量须为 1–99 的整数', '演示金额无效']

export default function GiftStorePanel({ selected }: { selected: CharacterId }) {
  const { t, locale } = useI18n()
  const [wallet, setWallet] = useState<DemoWalletSnapshot | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [recipient, setRecipient] = useState(selected)
  const [giftId, setGiftId] = useState(gifts[0].id)
  const [quantity, setQuantity] = useState('1')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const mounted = useRef(false)
  const confirmationRef = useRef<HTMLDivElement>(null)
  const initiatingButton = useRef<HTMLButtonElement | null>(null)
  const [notice, setNotice] = useState<Confirmation | null>(null)
  const [visibleCount, setVisibleCount] = useState(10)
  const gift = gifts.find(item => item.id === giftId)!
  const count = Number(quantity)
  const validQuantity = quantity.trim() !== '' && Number.isInteger(count) && count >= 1 && count <= 99
  const total = validQuantity ? gift.cost * count : 0

  useEffect(() => {
    mounted.current = true
    const unsubscribe = subscribeDemoWallet(value => { setWallet(value); setError(current => current === '无法读取演示余额，请重试。' ? '' : current) }, () => setError('无法读取演示余额，请重试。'))
    return () => { mounted.current = false; unsubscribe() }
  }, [attempt])
  useEffect(() => {
    if (confirmation) confirmationRef.current?.focus()
    else if (initiatingButton.current) { initiatingButton.current.focus(); initiatingButton.current = null }
  }, [confirmation])

  const requestConfirmation = (value: Confirmation, button: HTMLButtonElement) => {
    initiatingButton.current = button
    setNotice(null)
    setConfirmation(value)
  }

  const confirm = async () => {
    if (!confirmation || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setNotice(null)
    try {
      if (confirmation.kind === 'recharge') {
        const result = await rechargeDemo(confirmation.packId)
        if (mounted.current) { setWallet(result); setNotice(confirmation) }
      } else {
        const result = await sendDemoGift(confirmation.giftId, confirmation.characterId, confirmation.quantity)
        if (mounted.current) { setWallet(result); setNotice(confirmation) }
      }
      if (mounted.current) setConfirmation(null)
    } catch (failure) {
      if (mounted.current) {
        const message = failure instanceof Error ? failure.message : '操作失败，请重试。'
        // Keep known service errors as stable keys so an open error follows locale changes.
        setError(giftErrorKeys.find(key => key === message || t(key) === message) || message)
        setConfirmation(null)
      }
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return <section className="screen gift-store" aria-label={t('商城演示')}>
    <div className="demo-banner"><strong>{t('不扣款演示')}</strong><p>{t('充值和礼物仅供体验，不接入真实支付。演示币无现金价值，不可提现；送礼不是获得基本回应的条件。')}</p></div>
    <section className="demo-wallet glass" aria-label={t('演示钱包')}><span>{t('演示币余额')}</span><strong data-testid="demo-balance">{wallet ? wallet.balance.toLocaleString(locale) : '—'}</strong><small>{t('仅保存在本机浏览器，不跨设备同步')}</small></section>
    {error && <div role="alert" className="store-error">{t(error)}<button disabled={busy} onClick={() => { setError(''); setAttempt(value => value + 1) }}>{t('重新读取余额')}</button></div>}
    {!wallet && !error && <p role="status">{t('正在读取演示钱包…')}</p>}
    <section aria-labelledby="recharge-heading"><h2 id="recharge-heading">{t('模拟充值')}</h2><div className="recharge-packs">{rechargePacks.map(pack => <button key={pack.id} aria-label={t('+{count} 演示币 · 不扣款', { count: pack.coins.toLocaleString(locale) })} disabled={!wallet || busy || !!confirmation} onClick={event => requestConfirmation({ kind: 'recharge', packId: pack.id, coins: pack.coins }, event.currentTarget)}><strong>+{pack.coins.toLocaleString(locale)}</strong><span>{t('演示币 · 不扣款')}</span></button>)}</div></section>
    <section aria-labelledby="gift-heading"><h2 id="gift-heading">{t('给 TA 一份小心意')}</h2>
      <label className="recipient-label">{t('赠送给')}<select aria-label={t('礼物接收角色')} value={recipient} disabled={busy || !!confirmation} onChange={event => setRecipient(event.target.value as CharacterId)}>{characters.map(character => <option key={character.id} value={character.id}>{t(character.name)}</option>)}</select></label>
      <div className="gift-catalog">{gifts.map(item => <button key={item.id} aria-pressed={giftId === item.id} disabled={busy || !!confirmation} onClick={() => { setGiftId(item.id); setNotice(null) }}><span className="gift-emoji" aria-hidden="true">{item.emoji}</span><strong>{t(item.name)}</strong><span>{t('{count} 演示币', { count: item.cost })}</span></button>)}</div>
      <p className="gift-description">{t(gift.description)}</p>
      <div className="gift-quantity"><label>{t('数量')}<input aria-label={t('礼物数量')} type="number" min="1" max="99" step="1" value={quantity} disabled={busy || !!confirmation} onChange={event => setQuantity(event.target.value)} /></label><strong>{t('合计 {count} 演示币', { count: total })}</strong></div>
      {!validQuantity && <p className="store-error">{t('请输入 1–99 的整数数量。')}</p>}
      <button className="primary" disabled={!wallet || !validQuantity || busy || !!confirmation} onClick={event => requestConfirmation({ kind: 'gift', giftId, characterId: recipient, quantity: count }, event.currentTarget)}>{t('赠送礼物（演示）')}</button>
      {wallet && validQuantity && wallet.balance < total && <p className="gift-description">{t('演示币不足，可先免费模拟充值。')}</p>}
    </section>
    {confirmation && <div className="store-confirm glass" role="group" aria-label={t('确认演示操作')} tabIndex={-1} ref={confirmationRef}>
      <h2>{t(confirmation.kind === 'recharge' ? '确认模拟充值' : '确认赠送')}</h2>
      <p>{confirmation.kind === 'recharge' ? t('增加 {count} 演示币，不会扣取任何真实费用。', { count: confirmation.coins }) : t('向{name}赠送{gift} × {count}，消耗 {coins} 演示币。', { name: t(characters.find(item => item.id === confirmation.characterId)!.name), gift: t(gifts.find(item => item.id === confirmation.giftId)!.name), count: confirmation.quantity, coins: gifts.find(item => item.id === confirmation.giftId)!.cost * confirmation.quantity })}</p>
      <div><button disabled={busy} onClick={() => setConfirmation(null)}>{t('取消')}</button><button disabled={busy} onClick={() => void confirm()}>{t(busy ? '正在保存…' : confirmation.kind === 'recharge' ? '确认模拟充值' : '确认赠送（演示）')}</button></div>
    </div>}
    {notice && <div role="status" className="gift-feedback" data-glass-motion={notice.kind === 'gift' ? 'gift' : undefined}><p>{notice.kind === 'recharge' ? t('已模拟充值 {count} 演示币，未真实扣款。', { count: notice.coins }) : t('已向{name}赠送{gift} × {count}。{feedback}', { name: t(characters.find(item => item.id === notice.characterId)!.name), gift: t(gifts.find(item => item.id === notice.giftId)!.name), count: notice.quantity, feedback: t(gifts.find(item => item.id === notice.giftId)!.feedback) })}</p><small>{t('礼物回应为固定演示文案，不调用 AI，不影响聊天、记忆或剧情权益。')}</small></div>}
    <section className="demo-ledger" aria-labelledby="ledger-heading"><h2 id="ledger-heading">{t('本机演示记录')}</h2>{wallet && wallet.transactions.length === 0 && <p>{t('还没有记录，试试免费模拟充值。')}</p>}
      <ul>{wallet?.transactions.slice(0, visibleCount).map(transaction => <li key={transaction.id}><div><strong>{transaction.kind === 'recharge' ? t('模拟充值') : `${t(characters.find(item => item.id === transaction.characterId)?.name || '')} · ${t(transaction.giftName || '')} × ${transaction.quantity}`}</strong><time dateTime={transaction.createdAt}>{new Date(transaction.createdAt).toLocaleString(locale)}</time></div><span>{transaction.kind === 'recharge' ? '+' : '−'}{transaction.coins}</span></li>)}</ul>
      {wallet && wallet.transactions.length > visibleCount && <button onClick={() => setVisibleCount(value => value + 10)}>{t('显示更多记录')}</button>}
      <p className="gift-description">{t('演示记录不包含在聊天备份中；清除站点数据会删除余额与记录。')}</p>
    </section>
  </section>
}
