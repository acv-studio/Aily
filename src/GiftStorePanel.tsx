import { useEffect, useRef, useState } from 'react'
import { characters, type CharacterId } from './data'
import { gifts, rechargePacks, rechargeDemo, sendDemoGift, subscribeDemoWallet, type DemoWalletSnapshot } from './giftDemo'
import { subscribeDemoStoryEvents, type DemoStoryEvent } from './giftDemo'
import { storyGiftEvents } from './storyGifts'
import StoryGiftPanel from './StoryGiftPanel'
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
  const [events, setEvents] = useState<DemoStoryEvent[] | null>(null)
  const [eventError, setEventError] = useState('')
  const [activeEventId, setActiveEventId] = useState<string | null>(null)
  const eventButtonId = useRef<string | null>(null)
  const library = useRef<HTMLElement>(null)
  const gift = gifts.find(item => item.id === giftId)!
  const owned = events?.some(item => item.characterId === recipient && item.eventId === gift.storyEventId)
  const activeEvent = events?.find(item => item.id === activeEventId)
  const count = Number(quantity)
  const validQuantity = quantity.trim() !== '' && Number.isInteger(count) && count >= 1 && count <= (gift.storyEventId ? 1 : 99)
  const total = validQuantity ? gift.cost * count : 0

  useEffect(() => {
    mounted.current = true
    const unsubscribe = subscribeDemoWallet(value => { setWallet(value); setError('') }, () => setError('无法读取演示余额，请重试。'))
    return () => { mounted.current = false; unsubscribe() }
  }, [attempt])
  useEffect(() => subscribeDemoStoryEvents(value => { setEvents(value); setEventError('') }, () => { setEvents(null); setEventError('无法读取剧情事件，请重试。') }), [attempt])
  useEffect(() => {
    if (!activeEventId && eventButtonId.current) {
      const button = Array.from(library.current?.querySelectorAll<HTMLButtonElement>('button[data-event-id]') || []).find(item => item.dataset.eventId === eventButtonId.current)
      button?.focus({ preventScroll: true }); button?.scrollIntoView({ block: 'center', inline: 'nearest' })
      eventButtonId.current = null
    }
  }, [activeEventId])
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

  if (activeEvent) return <StoryGiftPanel key={activeEvent.id} record={activeEvent} close={() => setActiveEventId(null)} />
  return <section className="screen gift-store" aria-label="商城演示">
    <div className="demo-banner"><strong>不扣款演示</strong><p>充值和礼物仅供体验，不接入真实支付。演示币无现金价值，不可提现；送礼不是获得基本回应的条件。</p></div>
    <section className="demo-wallet glass" aria-label="演示钱包"><span>演示币余额</span><strong data-testid="demo-balance">{wallet ? wallet.balance.toLocaleString('zh-CN') : '—'}</strong><small>仅保存在本机浏览器，不跨设备同步</small></section>
    {error && <div role="alert" className="store-error">{error}<button disabled={busy} onClick={() => { setError(''); setAttempt(value => value + 1) }}>重新读取余额</button></div>}
    {!wallet && !error && <p role="status">正在读取演示钱包…</p>}
    <section aria-labelledby="recharge-heading"><h2 id="recharge-heading">模拟充值</h2><div className="recharge-packs">{rechargePacks.map(pack => <button key={pack.id} aria-label={`+${pack.coins.toLocaleString('zh-CN')} 演示币 · 不扣款`} disabled={!wallet || busy || !!confirmation} onClick={event => requestConfirmation({ kind: 'recharge', packId: pack.id, coins: pack.coins }, event.currentTarget)}><strong>+{pack.coins.toLocaleString('zh-CN')}</strong><span>演示币 · 不扣款</span></button>)}</div></section>
    <section aria-labelledby="gift-heading"><h2 id="gift-heading">给 TA 一份小心意</h2>
      <label className="recipient-label">赠送给<select aria-label="礼物接收角色" value={recipient} disabled={busy || !!confirmation} onChange={event => setRecipient(event.target.value as CharacterId)}>{characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
      <div className="gift-catalog">{gifts.map(item => <button key={item.id} aria-pressed={giftId === item.id} disabled={busy || !!confirmation} onClick={() => { setGiftId(item.id); if (item.storyEventId) setQuantity('1'); setNotice('') }}><span className="gift-emoji" aria-hidden="true">{item.emoji}</span><strong>{item.name}</strong><span>{item.cost} 演示币{item.storyEventId ? ' · 剧情' : ''}</span></button>)}</div>
      <p className="gift-description">{gift.description}</p>
      {gift.storyEventId && <p className="gift-description">解锁《{storyGiftEvents.find(item => item.id === gift.storyEventId)!.title}》 · 每位角色只需赠送一次，数量固定为 1，之后可免费继续和回看。</p>}
      <div className="gift-quantity"><label>数量<input aria-label="礼物数量" type="number" min="1" max={gift.storyEventId ? 1 : 99} step="1" value={quantity} disabled={busy || !!confirmation || !!gift.storyEventId} onChange={event => setQuantity(event.target.value)} /></label><strong>合计 {total} 演示币</strong></div>
      {!validQuantity && <p className="store-error">请输入 1–99 的整数数量。</p>}
      <button className="primary" disabled={!wallet || !validQuantity || busy || !!confirmation || !!owned || (!!gift.storyEventId && !events)} onClick={event => requestConfirmation({ kind: 'gift', giftId, characterId: recipient, quantity: count }, event.currentTarget)}>{owned ? '此角色已解锁，无需重复赠送' : '赠送礼物（演示）'}</button>
      {wallet && validQuantity && wallet.balance < total && <p className="gift-description">演示币不足，可先免费模拟充值。</p>}
    </section>
    {confirmation && <div className="store-confirm glass" role="group" aria-label="确认演示操作" tabIndex={-1} ref={confirmationRef}>
      <h2>{confirmation.kind === 'recharge' ? '确认模拟充值' : '确认赠送'}</h2>
      <p>{confirmation.kind === 'recharge' ? `增加 ${confirmation.coins} 演示币，不会扣取任何真实费用。` : `向${characters.find(item => item.id === confirmation.characterId)!.name}赠送${gifts.find(item => item.id === confirmation.giftId)!.name} × ${confirmation.quantity}，消耗 ${gifts.find(item => item.id === confirmation.giftId)!.cost * confirmation.quantity} 演示币。`}</p>
      <div><button disabled={busy} onClick={() => setConfirmation(null)}>取消</button><button disabled={busy} onClick={() => void confirm()}>{busy ? '正在保存…' : confirmation.kind === 'recharge' ? '确认模拟充值' : '确认赠送（演示）'}</button></div>
    </div>}
    {notice && <div role="status" className="gift-feedback"><p>{notice}</p><small>回应与剧情为固定本机文案，不调用 AI。剧情礼物解锁下方对应事件，不自动写入聊天或记忆。</small></div>}
    <section ref={library} className="story-gift-library" aria-labelledby="events-heading"><h2 id="events-heading">与{characters.find(item => item.id === recipient)!.name}的剧情事件</h2>
      <p className="gift-description">演唱会票、旅行箱、相机分别解锁对应互动。基本聊天与免费主线不受送礼影响。</p>
      {eventError && <p role="alert" className="store-error">{eventError}<button onClick={() => setAttempt(value => value + 1)}>重新读取事件</button></p>}
      {!events && !eventError && <p role="status">正在读取剧情事件…</p>}
      {storyGiftEvents.map(item => {
        const record = events?.find(value => value.characterId === recipient && value.eventId === item.id)
        return <article className="story-gift-card glass" key={item.id}><h3>{item.title}</h3><p>{record ? record.choiceId ? '已完成 · 可回看' : '已解锁 · 待体验' : '尚未解锁'}</p>{record && <button data-event-id={record.id} disabled={busy || !!confirmation} onClick={() => { eventButtonId.current = record.id; setActiveEventId(record.id) }}>{record.choiceId ? '回看' : '进入'}《{item.title}》</button>}</article>
      })}
      <p className="gift-description">事件与选择随演示钱包保存，不随聊天备份导出；清空聊天不删除。删除本机使用资料或清除站点数据会删除。</p>
    </section>
    <section className="demo-ledger" aria-labelledby="ledger-heading"><h2 id="ledger-heading">本机演示记录</h2>{wallet && wallet.transactions.length === 0 && <p>还没有记录，试试免费模拟充值。</p>}
      <ul>{wallet?.transactions.slice(0, visibleCount).map(transaction => <li key={transaction.id}><div><strong>{transaction.kind === 'recharge' ? '模拟充值' : `${characters.find(item => item.id === transaction.characterId)?.name} · ${transaction.giftName} × ${transaction.quantity}`}</strong><time dateTime={transaction.createdAt}>{new Date(transaction.createdAt).toLocaleString('zh-CN')}</time></div><span>{transaction.kind === 'recharge' ? '+' : '−'}{transaction.coins}</span></li>)}</ul>
      {wallet && wallet.transactions.length > visibleCount && <button onClick={() => setVisibleCount(value => value + 10)}>显示更多记录</button>}
      <p className="gift-description">演示记录不包含在聊天备份中；清除站点数据会删除余额与记录。</p>
    </section>
  </section>
}
