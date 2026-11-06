import { useEffect, useId, useRef, useState } from 'react'
import { ArrowLeft, Check, ExternalLink, Gift, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import { nativeBillingAvailable, useBilling, type PlanId } from './billing'
import { useI18n } from './i18n'
import './billing.css'

export type BillingPanelProps = { close: () => void; openPrivacy?: () => void }

type Operation = PlanId | 'checkIn' | 'restore' | 'refresh'
const tiers: { id: PlanId; multiplier: number; intendedRmb: number }[] = [
  { id: 'com.aily.app.monthly.5x', multiplier: 5, intendedRmb: 30 },
  { id: 'com.aily.app.monthly.10x', multiplier: 10, intendedRmb: 60 },
  { id: 'com.aily.app.monthly.20x', multiplier: 20, intendedRmb: 90 },
  { id: 'com.aily.app.monthly.50x', multiplier: 50, intendedRmb: 200 },
]

/** All balances, entitlements and transactions come from billing; this UI never grants points. */
export default function BillingPanel({ close, openPrivacy }: BillingPanelProps) {
  const billing = useBilling()
  const { locale } = useI18n()
  const text = (zh: string, en: string) => locale === 'en' ? en : zh
  const number = (value: number) => value.toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN')
  const native = nativeBillingAvailable()
  const headingId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const running = useRef(false)
  const [operation, setOperation] = useState<Operation | null>(null)
  const [localError, setLocalError] = useState('')
  const [notice, setNotice] = useState('')
  const blocked = billing.busy || operation !== null

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])

  const run = async (kind: Operation, action: () => Promise<void>) => {
    if (running.current || billing.busy || (!billing.ready && kind !== 'refresh')) return
    if (kind !== 'checkIn' && kind !== 'refresh' && !native) return
    running.current = true
    setOperation(kind)
    setLocalError('')
    setNotice('')
    try {
      await action()
      // A resolved purchase request is not proof of payment or an active entitlement.
      setNotice(kind === 'checkIn'
        ? text('签到请求已完成，积分以当前余额为准。', 'Check-in request completed. Your current balance is shown above.')
        : kind === 'refresh'
          ? text('已刷新，请查看当前余额与订阅状态。', 'Refreshed. Review your current balance and subscription status.')
          : kind === 'restore'
            ? text('恢复请求已完成，以显示的 Apple 订阅状态为准；本机积分不会跨设备恢复。', 'Restore request completed. Review the Apple subscription status above; local points are not restored across devices.')
            : text('购买请求已返回，请查看订阅状态。若正在等待 Apple 或家长批准，批准前不会开通；稍后可刷新。', 'Purchase request returned. Review your subscription status. If Apple or family approval is pending, access is not granted until approval; refresh later.'))
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : text('操作未完成，请重试。', 'The action could not be completed. Please try again.'))
    } finally {
      running.current = false
      setOperation(null)
    }
  }

  const expiry = (() => {
    if (!billing.entitlement.expiresAt) return null
    const date = new Date(billing.entitlement.expiresAt)
    return Number.isNaN(date.getTime()) ? billing.entitlement.expiresAt : date.toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN')
  })()
  const error = localError || billing.error

  return <section className="billing-panel" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={headingId}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
      if (event.key !== 'Tab') return
      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]') ?? [])
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
    <header className="billing-header">
      <button type="button" className="billing-back" ref={closeRef} onClick={close} aria-label={text('关闭积分与订阅', 'Close points and subscriptions')}><ArrowLeft size={20} aria-hidden="true" /></button>
      <div><p>Aily Plus</p><h1 id={headingId}>{text('积分与订阅', 'Points & subscriptions')}</h1></div>
      <Sparkles className="billing-header-sparkle" aria-hidden="true" />
    </header>

    <div className="billing-content">
      <article className="billing-balance" aria-labelledby={`${headingId}-balance`}>
        <div className="billing-balance-top"><h2 id={`${headingId}-balance`}>{text('剩余积分', 'Remaining points')}</h2><span className="billing-badge">{text('仅限本机', 'This device only')}</span></div>
        <div className="billing-balance-value">{billing.ready ? number(billing.balance) : '—'}<span>{text('积分', 'points')}</span></div>
        <p>{text('当前每日额度', 'Current daily quota')} <strong>{billing.ready ? number(billing.dailyQuota) : '—'}</strong> {text('积分 / 天', 'points / day')}</p>
        <div className="billing-checkin">
          <div><Gift size={20} aria-hidden="true" /><span><strong>{text('每日签到 +20 积分', 'Daily check-in +20 points')}</strong><small>{text('每天一次，签到奖励固定为 20 积分，不随订阅倍增。', 'Once per day. The 20-point check-in reward is not multiplied by a subscription.')}</small></span></div>
          <button type="button" className="billing-button billing-button-primary" disabled={!billing.ready || !billing.canCheckIn || blocked}
            onClick={() => void run('checkIn', billing.checkIn)}>{operation === 'checkIn' ? text('签到中…', 'Checking in…') : !billing.ready ? text('加载中…', 'Loading…') : billing.canCheckIn ? text('签到领取', 'Check in') : text('今日已签到', 'Checked in today')}</button>
        </div>
      </article>

      <div className="billing-entitlement" aria-live="polite">
        <ShieldCheck size={20} aria-hidden="true" />
        <div><strong>{!billing.ready ? text('正在读取订阅状态…', 'Loading subscription status…') : billing.entitlement.productId
          ? text(`当前订阅 · ${billing.entitlement.multiplier}×`, `Current subscription · ${billing.entitlement.multiplier}×`)
          : text('当前为免费基础额度 · 1×', 'Free base quota · 1×')}</strong>
          {billing.ready && billing.entitlement.productId && <small>{expiry ? text(`当前权益到期时间：${expiry}`, `Current entitlement expires: ${expiry}`) : text('到期时间暂不可用，请在 Apple 订阅中确认。', 'Expiry is unavailable; check Apple subscriptions.')}</small>}
        </div>
      </div>

      {!native && <p className="billing-notice">{text('此环境不支持 Apple 内购。可查看档位与本机积分，但无法购买或恢复订阅；请使用支持 StoreKit 的 iOS App。', 'Apple in-app purchases are unavailable here. You can view tiers and local points, but cannot purchase or restore subscriptions. Use the StoreKit-enabled iOS app.')}</p>}
      {!billing.ready && <p className="billing-status" role="status">{text('正在加载本机积分和商店商品…', 'Loading local points and store products…')}</p>}
      {error && <p className="billing-error" role="alert">{error}</p>}
      {blocked && <p className="billing-status" role="status">{operation && operation.startsWith('com.aily.')
        ? text('正在等待 Apple 购买结果。请在系统窗口完成操作；待批准订单不会提前开通。', 'Waiting for Apple. Complete the system purchase prompt; pending approval does not grant access.')
        : text('正在处理，请稍候…', 'Processing, please wait…')}</p>}
      {notice && <p className="billing-status" role="status">{notice}</p>}

      <section className="billing-plans" aria-labelledby={`${headingId}-plans`}>
        <div className="billing-section-heading"><h2 id={`${headingId}-plans`}>{text('让每天的陪伴更充裕', 'More room for everyday connection')}</h2><p>{text('基础额度 20 积分 / 天 · 按月自动续订', 'Base quota: 20 points / day · Monthly auto-renewal')}</p></div>
        <div className="billing-tier-grid">{tiers.map(tier => {
          const product = billing.products.find(item => item.id === tier.id)
          const realPrice = product?.displayPrice.trim()
          const current = billing.entitlement.productId === tier.id
          const purchasable = native && billing.ready && !!realPrice
          return <article className={`billing-tier${current ? ' billing-tier-current' : ''}`} key={tier.id}>
            <div className="billing-tier-top"><span className="billing-tier-multiplier">{tier.multiplier}×</span>{current && <span className="billing-badge"><Check size={12} aria-hidden="true" />{text('当前订阅', 'Current')}</span>}</div>
            <h3>{product?.displayName || `Aily Plus ${tier.multiplier}×`}</h3>
            <p className="billing-tier-quota"><strong>{number(20 * tier.multiplier)}</strong> {text('积分 / 天', 'points / day')}</p>
            {realPrice ? <p className="billing-tier-price"><strong>{realPrice}</strong><span>{text('/ 月', '/ month')}</span></p>
              : <div className="billing-intended-price"><p>{text(`意向定价：人民币 ${tier.intendedRmb} 元 / 月`, `Intended tier: RMB ${tier.intendedRmb} / month`)}</p><small>{text('非已配置的商店价格 · 商品未就绪，不可购买', 'Not a configured store price · Product unavailable, not purchasable')}</small></div>}
            {product?.description && <p className="billing-tier-description">{product.description}</p>}
            <button type="button" className="billing-button billing-button-tier" disabled={!purchasable || blocked || current}
              onClick={() => void run(tier.id, () => billing.purchase(tier.id))}>
              {operation === tier.id ? text('等待 Apple…', 'Waiting for Apple…') : current ? text('当前订阅', 'Current subscription') : !native ? text('仅限 iOS 内购', 'iOS purchase only') : !realPrice ? text('暂不可购买', 'Not purchasable') : !billing.ready ? text('加载中…', 'Loading…') : text('订阅此档位', 'Subscribe')}
            </button>
          </article>
        })}</div>
        <p className="billing-price-note">{text('实际售价与币种仅以 Apple 商店返回的价格和付款确认页为准。意向定价不代表 App Store 已配置或可购买价格。', 'Actual price and currency are determined only by Apple’s returned store price and payment confirmation. Intended prices do not mean an App Store price is configured or purchasable.')}</p>
      </section>

      <div className="billing-actions">
        <button type="button" className="billing-button billing-button-secondary" disabled={!native || !billing.ready || blocked} onClick={() => void run('restore', billing.restore)}>{text('恢复 Apple 购买', 'Restore Apple purchases')}</button>
        <button type="button" className="billing-button billing-button-secondary" disabled={blocked} onClick={() => void run('refresh', billing.refresh)}><RefreshCw size={16} aria-hidden="true" />{text('刷新状态', 'Refresh status')}</button>
        <a className="billing-manage" href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noopener noreferrer">{text('管理 Apple 订阅', 'Manage Apple subscriptions')}<ExternalLink size={15} aria-hidden="true" /></a>
      </div>

      <footer className="billing-disclosures">
        <p><a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" target="_blank" rel="noopener noreferrer">{text('Apple 标准许可协议（EULA）', 'Apple standard license agreement (EULA)')}</a></p>
        {openPrivacy && <button type="button" className="billing-button billing-button-secondary" onClick={openPrivacy}>{text('安全与隐私', 'Safety & privacy')}</button>}
        <p>{text('每日基础额度按设备本地日期重置，未使用的基础额度不累积；签到奖励可在本机累积。月卡提升的是 App 内使用额度，模型服务仍需单独配置，第三方模型费用不包含在月卡内。', 'The base quota resets by the device’s local date and does not roll over; check-in rewards accumulate on this device. Monthly passes increase in-app usage limits. Model service configuration and third-party model fees are separate and are not included in the pass.')}</p>
        <h2>{text('订阅与积分说明', 'Subscription & points details')}</h2>
        <p>{text('每个档位均为 1 个月自动续订订阅。确认购买时向 Apple 账户收费；除非在当前订阅期结束至少 24 小时前取消，否则会自动续订，并在到期前 24 小时内收取续订费用。购买后可在 Apple 订阅设置中管理或取消。', 'Each tier is a one-month auto-renewable subscription. Payment is charged to your Apple account at confirmation. It renews automatically unless canceled at least 24 hours before the current period ends; renewal is charged within 24 hours before expiry. Manage or cancel in Apple subscription settings after purchase.')}</p>
        <p>{text('倍数仅作用于基础每日额度（20 × 5 / 10 / 20 / 50）。剩余积分与每日额度以本页读取的实际状态为准；签到固定奖励 20 积分。', 'Multipliers apply only to the base daily quota (20 × 5 / 10 / 20 / 50). Remaining points and daily quota reflect the actual state shown here; check-in always awards 20 points.')}</p>
        <p>{text('纯客户端，无账户服务器。积分余额与签到记录仅保存在当前设备，不跨设备同步；清除 App / 浏览器数据、卸载或换机可能丢失本机积分。恢复购买只检查 Apple 订阅权益，不恢复本机积分。', 'Client-only, with no account server. Points and check-in records are stored on this device, not synchronized across devices. Clearing app/browser data, uninstalling, or changing devices may lose local points. Restore purchases checks Apple subscription entitlements only, not local points.')}</p>
        <p>{text('购买取消、失败或待批准时不会模拟付款或提前发放订阅权益。请以 Apple 的交易结果与本页刷新后的订阅状态为准。', 'Canceled, failed, or approval-pending purchases never simulate payment or grant subscription access in advance. Rely on Apple’s transaction result and the refreshed subscription state.')}</p>
      </footer>
    </div>
  </section>
}
