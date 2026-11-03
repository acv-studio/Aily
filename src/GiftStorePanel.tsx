import { useEffect, useRef, useState } from 'react'
import { characters, type CharacterId } from './data'
import { gifts, rechargePacks, rechargeDemo, sendDemoGift, subscribeDemoWallet, type DemoWalletSnapshot } from './giftDemo'
import './giftStore.css'

type Confirmation = { kind: 'recharge'; packId: string; coins: number } | { kind: 'gift'; giftId: string; characterId: CharacterId; quantity: number }

export default function GiftStorePanel({ selected }: { selected: CharacterId }) {
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
  const [notice, setNotice] = useState('')
  const [visibleCount, setVisibleCount] = useState(10)
  const gift = gifts.find(item => item.id === giftId)!
  const count = Number(quantity)
  const validQuantity = quantity.trim() !== '' && Number.isInteger(count) && count >= 1 && count <= 99
  const total = validQuantity ? gift.cost * count : 0

  useEffect(() => {
    mounted.current = true
    const unsubscribe = subscribeDemoWallet(value => { setWallet(value); setError('') }, () => setError('无法读取演示余额，请重试。'))
    return () => { mounted.current = false; unsubscribe() }
  }, [attempt])
  useEffect(() => {
    if (confirmation) confirmationRef.current?.focus()
    else if (initiatingButton.current) { initiatingButton.current.focus(); initiatingButton.current = null }
  }, [confirmation])

  const requestConfirmation = (value: Confirmation, button: HTMLButtonElement) => {
    initiatingButton.current = button
    setNotice('')
    setConfirmation(value)
  }

  const confirm = async () => {
    if (!confirmation || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (confirmation.kind === 'recharge') {
        const result = await rechargeDemo(confirmation.packId)
        if (mounted.current) { setWallet(result); setNotice(`已模拟充值 ${confirmation.coins} 演示币，未真实扣款。`) }
      } else {
        const result = await sendDemoGift(confirmation.giftId, confirmation.characterId, confirmation.quantity)
        const sentGift = gifts.find(item => item.id === confirmation.giftId)!
        const name = characters.find(item => item.id === confirmation.characterId)!.name
        if (mounted.current) { setWallet(result); setNotice(`已向${name}赠送${sentGift.name} × ${confirmation.quantity}。${sentGift.feedback}`) }
      }
      if (mounted.current) setConfirmation(null)
    } catch (failure) {
      if (mounted.current) { setError(failure instanceof Error ? failure.message : '操作失败，请重试。'); setConfirmation(null) }
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return <section className="screen gift-store" aria-label="商城演示">
    <div className="demo-banner"><strong>不扣款演示</strong><p>充值和礼物仅供体验，不接入真实支付。演示币无现金价值，不可提现；送礼不是获得基本回应的条件。</p></div>
    <section className="demo-wallet glass" aria-label="演示钱包"><span>演示币余额</span><strong data-testid="demo-balance">{wallet ? wallet.balance.toLocaleString('zh-CN') : '—'}</strong><small>仅保存在本机浏览器，不跨设备同步</small></section>
    {error && <div role="alert" className="store-error">{error}<button disabled={busy} onClick={() => { setError(''); setAttempt(value => value + 1) }}>重新读取余额</button></div>}
    {!wallet && !error && <p role="status">正在读取演示钱包…</p>}
    <section aria-labelledby="recharge-heading"><h2 id="recharge-heading">模拟充值</h2><div className="recharge-packs">{rechargePacks.map(pack => <button key={pack.id} aria-label={`+${pack.coins.toLocaleString('zh-CN')} 演示币 · 不扣款`} disabled={!wallet || busy || !!confirmation} onClick={event => requestConfirmation({ kind: 'recharge', packId: pack.id, coins: pack.coins }, event.currentTarget)}><strong>+{pack.coins.toLocaleString('zh-CN')}</strong><span>演示币 · 不扣款</span></button>)}</div></section>
    <section aria-labelledby="gift-heading"><h2 id="gift-heading">给 TA 一份小心意</h2>
      <label className="recipient-label">赠送给<select aria-label="礼物接收角色" value={recipient} disabled={busy || !!confirmation} onChange={event => setRecipient(event.target.value as CharacterId)}>{characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
      <div className="gift-catalog">{gifts.map(item => <button key={item.id} aria-pressed={giftId === item.id} disabled={busy || !!confirmation} onClick={() => { setGiftId(item.id); setNotice('') }}><span className="gift-emoji" aria-hidden="true">{item.emoji}</span><strong>{item.name}</strong><span>{item.cost} 演示币</span></button>)}</div>
      <p className="gift-description">{gift.description}</p>
      <div className="gift-quantity"><label>数量<input aria-label="礼物数量" type="number" min="1" max="99" step="1" value={quantity} disabled={busy || !!confirmation} onChange={event => setQuantity(event.target.value)} /></label><strong>合计 {total} 演示币</strong></div>
      {!validQuantity && <p className="store-error">请输入 1–99 的整数数量。</p>}
      <button className="primary" disabled={!wallet || !validQuantity || busy || !!confirmation} onClick={event => requestConfirmation({ kind: 'gift', giftId, characterId: recipient, quantity: count }, event.currentTarget)}>赠送礼物（演示）</button>
      {wallet && validQuantity && wallet.balance < total && <p className="gift-description">演示币不足，可先免费模拟充值。</p>}
    </section>
    {confirmation && <div className="store-confirm glass" role="group" aria-label="确认演示操作" tabIndex={-1} ref={confirmationRef}>
      <h2>{confirmation.kind === 'recharge' ? '确认模拟充值' : '确认赠送'}</h2>
      <p>{confirmation.kind === 'recharge' ? `增加 ${confirmation.coins} 演示币，不会扣取任何真实费用。` : `向${characters.find(item => item.id === confirmation.characterId)!.name}赠送${gifts.find(item => item.id === confirmation.giftId)!.name} × ${confirmation.quantity}，消耗 ${gifts.find(item => item.id === confirmation.giftId)!.cost * confirmation.quantity} 演示币。`}</p>
      <div><button disabled={busy} onClick={() => setConfirmation(null)}>取消</button><button disabled={busy} onClick={() => void confirm()}>{busy ? '正在保存…' : confirmation.kind === 'recharge' ? '确认模拟充值' : '确认赠送（演示）'}</button></div>
    </div>}
    {notice && <div role="status" className="gift-feedback"><p>{notice}</p><small>礼物回应为固定演示文案，不调用 AI，不影响聊天、记忆或剧情权益。</small></div>}
    <section className="demo-ledger" aria-labelledby="ledger-heading"><h2 id="ledger-heading">本机演示记录</h2>{wallet && wallet.transactions.length === 0 && <p>还没有记录，试试免费模拟充值。</p>}
      <ul>{wallet?.transactions.slice(0, visibleCount).map(transaction => <li key={transaction.id}><div><strong>{transaction.kind === 'recharge' ? '模拟充值' : `${characters.find(item => item.id === transaction.characterId)?.name} · ${transaction.giftName} × ${transaction.quantity}`}</strong><time dateTime={transaction.createdAt}>{new Date(transaction.createdAt).toLocaleString('zh-CN')}</time></div><span>{transaction.kind === 'recharge' ? '+' : '−'}{transaction.coins}</span></li>)}</ul>
      {wallet && wallet.transactions.length > visibleCount && <button onClick={() => setVisibleCount(value => value + 10)}>显示更多记录</button>}
      <p className="gift-description">演示记录不包含在聊天备份中；清除站点数据会删除余额与记录。</p>
    </section>
  </section>
}
