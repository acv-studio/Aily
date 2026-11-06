import { useEffect, useId, useRef, useState } from 'react'
import { characters, type CharacterId } from './data'
import { creditGifts, type CreditGiftId } from './creditGifts'
import { useBilling } from './billing'
import { useI18n } from './i18n'
import './creditGiftStore.css'

type GiftStorePanelProps = {
  selected: CharacterId
  onSendGift?: (giftId: CreditGiftId) => Promise<void>
  sending?: boolean
  onOpenBilling?: () => void
  /** @deprecated Kept for old consumers' types only; never invoked. */
  onGiftSent?: (characterId: CharacterId, giftName: string, quantity: number) => void | Promise<void>
}

export default function GiftStorePanel({ selected, onSendGift, sending = false, onOpenBilling }: GiftStorePanelProps) {
  const { t, locale } = useI18n()
  const en = locale === 'en'
  const copy = (zh: string, english: string) => en ? english : zh
  const billing = useBilling()
  const headingId = useId()
  const descriptionId = useId()
  const [giftId, setGiftId] = useState<CreditGiftId>(creditGifts[0].id)
  const [operation, setOperation] = useState<'send' | 'checkin' | 'refresh' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<'sent' | 'checked-in' | null>(null)
  const busyRef = useRef(false)
  const mounted = useRef(false)
  const recipientRef = useRef(selected)
  recipientRef.current = selected
  const character = characters.find(item => item.id === selected)!
  const gift = creditGifts.find(item => item.id === giftId)!
  const giftName = en ? gift.englishName : gift.name
  const busy = sending || operation !== null || billing.busy
  const shortfall = billing.ready ? Math.max(0, gift.cost - billing.balance) : 0

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setNotice(null); setError('') }, [selected])

  const run = async (kind: 'send' | 'checkin' | 'refresh') => {
    // The ref closes the gap before React rerenders after a rapid second click.
    if (busyRef.current || busy) return
    if (kind === 'send' && (!onSendGift || !billing.ready || shortfall > 0)) return
    if (kind === 'checkin' && (!billing.ready || !billing.canCheckIn)) return
    const recipient = selected
    busyRef.current = true
    setOperation(kind); setError(''); setNotice(null)
    try {
      // Only the parent reserves and settles gift credits, including one AI reply.
      if (kind === 'send') await onSendGift!(giftId)
      else if (kind === 'checkin') await billing.checkIn()
      else await billing.refresh()
      if (mounted.current && recipientRef.current === recipient) {
        if (kind === 'send') setNotice('sent')
        if (kind === 'checkin') setNotice('checked-in')
      }
    } catch (failure) {
      if (mounted.current && recipientRef.current === recipient) {
        setError(failure instanceof Error ? failure.message : copy('操作失败，请重试。', 'Something went wrong. Please retry.'))
      }
    } finally {
      busyRef.current = false
      if (mounted.current) setOperation(null)
    }
  }

  const checkInButton = <button className="cg-checkin" disabled={busy || !billing.ready || !billing.canCheckIn} onClick={() => void run('checkin')}>
    {operation === 'checkin' ? copy('签到中…', 'Checking in…') : billing.canCheckIn ? copy('签到 +20', 'Check in +20') : copy('今日已签到', 'Checked in today')}
  </button>

  return <section className="credit-gift-store" aria-labelledby={headingId} aria-busy={busy}>
    <header className="cg-header">
      <div className="cg-recipient"><span className="cg-avatar" aria-hidden="true">{t(character.avatar)}</span><div>
        <span className="cg-eyebrow">{copy('给当前聊天的 TA', 'For your current companion')}</span>
        <h2 id={headingId}>{t(character.name)}</h2>
      </div></div>
      <div className="cg-wallet"><span>{copy('可用积分', 'Available credits')}</span><strong data-testid="credit-balance">{billing.ready ? billing.balance.toLocaleString(locale) : '—'}</strong></div>
      {checkInButton}
    </header>

    <div className="cg-content">
      <div className="cg-intro"><h3>{copy('一份小心意', 'A little thought for you')}</h3><p>{copy('选一份礼物，在当前聊天里送出。', 'Choose a gift to send in this chat.')}</p></div>
      {!billing.ready && !billing.error && <p role="status" className="cg-note">{copy('正在读取积分…', 'Loading credits…')}</p>}
      {billing.error && <div className="cg-error" role="alert"><p>{billing.error}</p><button disabled={busy} onClick={() => void run('refresh')}>{copy('重新读取积分', 'Reload credits')}</button></div>}
      <div className="cg-grid" aria-label={copy('选择一份礼物', 'Choose one gift')}>
        {creditGifts.map(item => <button className="cg-card" key={item.id} aria-pressed={giftId === item.id} disabled={busy} onClick={() => { setGiftId(item.id); setError(''); setNotice(null) }}>
          <span className="cg-card-mark" aria-hidden="true">{giftId === item.id ? '✓' : ''}</span>
          <span className="cg-emoji" aria-hidden="true">{item.emoji}</span>
          <strong>{en ? item.englishName : item.name}</strong>
          <span className="cg-cost">{item.cost} {copy('积分', 'credits')}</span>
        </button>)}
      </div>
      <div className="cg-description" id={descriptionId}><strong>{giftName}</strong><p>{en ? gift.englishDescription : gift.description}</p><span>{copy('每次 1 份 · 包含一次 AI 回应 · 成功后扣积分', 'One gift · Includes one AI reply · Charged on success')}</span></div>
      <p className="cg-note">{copy('与聊天共用本机积分，不跨设备同步；模型服务商配置与费用另计。礼物不购买关系提升，也不是基本聊天的条件。', 'Credits are shared with chat on this device, not synced across devices. Model-provider setup and charges are separate. Gifts do not buy relationship boosts or gate basic chat.')}</p>
      {error && <p className="cg-error" role="alert">{error}</p>}
      {notice && <p className="cg-success" role="status">{notice === 'sent' ? copy('礼物已送出，已写入当前聊天。', 'Gift sent. It is now in your current chat.') : copy('签到成功，已领取 20 积分。', 'Checked in. You received 20 credits.')}</p>}
      {!onSendGift && <p className="cg-note">{copy('送礼暂不可用，请返回聊天后重试。', 'Gift sending is unavailable. Return to chat and try again.')}</p>}

    </div>

    <footer className="cg-confirm">
      {shortfall > 0 && <div className="cg-shortfall" role="status"><p>{copy(`还差 ${shortfall} 积分`, `You need ${shortfall} more credits`)}</p><div>{checkInButton}{onOpenBilling && <button className="cg-billing-link" disabled={busy} onClick={onOpenBilling}>{copy('查看 Apple 月卡', 'View Apple monthly pass')}</button>}</div></div>}
      <div className="cg-confirm-row"><div><span>{giftName} × 1</span><strong>{copy(`合计 ${gift.cost} 积分`, `Total: ${gift.cost} credits`)}</strong></div><button className="cg-send" aria-describedby={descriptionId} disabled={busy || !billing.ready || shortfall > 0 || !onSendGift} onClick={() => void run('send')}>{operation === 'send' || sending ? copy('正在送出…', 'Sending…') : copy('送给TA', 'Send gift')}</button></div>
      <p>{copy('点击「送给TA」确认赠送与积分消耗', '“Send gift” confirms this gift and its credit cost')}</p>
    </footer>
  </section>
}
