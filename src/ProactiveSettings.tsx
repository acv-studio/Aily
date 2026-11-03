import { useEffect, useRef, useState } from 'react'
import type { CharacterId } from './data'
import {
  claimReminder, createLocalReminder, DEFAULT_PROACTIVE_CONFIG, GENERIC_NOTIFICATION_BODY,
  isReminderDue, parseProactiveConfig, PROACTIVE_SETTINGS_KEY, reminderLedgerKey,
  validateProactiveConfig, type ProactiveConfig,
} from './proactive'

export interface ProactiveSettingsProps {
  /** Insert a local message only. Do not connect this callback to AI/network generation. */
  onMessage: (characterId: CharacterId, text: string) => Promise<void>
  selected: CharacterId
  busy: boolean
  latestUserText?: string
}

function readSettings(): ProactiveConfig {
  try { return parseProactiveConfig(window.localStorage.getItem(PROACTIVE_SETTINGS_KEY)) }
  catch { return { ...DEFAULT_PROACTIVE_CONFIG } }
}

function notificationPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

export default function ProactiveSettings(props: ProactiveSettingsProps) {
  const [config, setConfig] = useState(readSettings)
  const [status, setStatus] = useState('')
  const [permission, setPermission] = useState(notificationPermission)
  const [requesting, setRequesting] = useState(false)
  const current = useRef({ ...props, config })
  current.current = { ...props, config }
  const inFlight = useRef(false)
  const mounted = useRef(false)

  function update(patch: Partial<ProactiveConfig>) {
    const next = validateProactiveConfig({ ...current.current.config, ...patch })
    // Update the guard immediately: a queued timer cannot race an opt-out click.
    current.current.config = next
    setConfig(next)
    try {
      window.localStorage.setItem(PROACTIVE_SETTINGS_KEY, JSON.stringify(next))
      setStatus('设置已保存在此浏览器。')
    } catch {
      const disabled = { ...next, enabled: false }
      current.current.config = disabled
      setConfig(disabled)
      setStatus('无法保存本地设置，提醒已停用。')
    }
  }

  useEffect(() => {
    mounted.current = true
    const receive = (event: StorageEvent) => {
      if (event.key !== PROACTIVE_SETTINGS_KEY && event.key !== null) return
      const next = readSettings()
      current.current.config = next
      setConfig(next)
    }
    window.addEventListener('storage', receive)

    const tick = async () => {
      if (inFlight.current || !mounted.current) return
      const snapshot = current.current
      const now = new Date()
      if (!isReminderDue(snapshot.config, now, false, snapshot.busy)) return
      inFlight.current = true
      try {
        const deliver = async () => {
          const active = current.current
          const deliveryTime = new Date()
          // Recheck after waiting for another tab's lock. Never replay a past minute.
          if (!mounted.current || active.selected !== snapshot.selected
            || !isReminderDue(active.config, deliveryTime, false, active.busy)) return
          let storage: Storage
          try {
            storage = window.localStorage
            // Respect another tab's opt-out, schedule and DND changes even if
            // its storage event is still queued.
            const persisted = parseProactiveConfig(storage.getItem(PROACTIVE_SETTINGS_KEY))
            if (!isReminderDue(persisted, deliveryTime, false, active.busy)) return
          } catch {
            if (mounted.current) setStatus('本地存储不可用，未发送提醒。')
            return
          }
          const token = `${Date.now()}:${Math.random()}`
          if (!claimReminder(storage, deliveryTime, active.selected, token)) return
          const text = createLocalReminder(active.config.kind, active.latestUserText)
          // Ledger first: failed callbacks are not retried automatically.
          await active.onMessage(active.selected, text)
          if (!mounted.current) return
          setStatus('已添加本地提醒；今日此角色不再重复。')
          const latest = current.current
          if (latest.config.enabled && latest.config.notifications
            && !latest.busy && notificationPermission() === 'granted') {
            try {
              new Notification('Aily 本地提醒', { body: GENERIC_NOTIFICATION_BODY, tag: reminderLedgerKey(deliveryTime, active.selected) })
            } catch { setStatus('本地消息已添加，但系统通知不可用。') }
          }
        }
        if (typeof navigator !== 'undefined' && navigator.locks?.request) {
          await navigator.locks.request('aily.proactive.delivery.v1', deliver)
        } else {
          await deliver()
        }
      } catch {
        if (mounted.current) setStatus('添加提醒失败；为避免重复，今日不自动重试。')
      } finally { inFlight.current = false }
    }
    void tick()
    const timer = window.setInterval(() => { void tick() }, 15_000)
    return () => {
      mounted.current = false
      window.clearInterval(timer)
      window.removeEventListener('storage', receive)
    }
  }, [])

  async function enableNotifications() {
    // The only permission request site; invoked solely by this explicit button.
    if (requesting || typeof Notification === 'undefined') return
    setRequesting(true)
    try {
      const result = await Notification.requestPermission()
      if (!mounted.current) return
      setPermission(result)
      update({ notifications: result === 'granted' })
      if (result !== 'granted') setStatus('未获通知权限；本地聊天提醒不受影响。')
    } catch {
      if (mounted.current) setStatus('无法申请系统通知权限。')
    } finally { if (mounted.current) setRequesting(false) }
  }

  return <section className="proactive-settings glass" aria-labelledby="proactive-heading">
    <h3 id="proactive-heading">主动陪伴 · 本地定时提醒</h3>
    <p><strong>仅在应用打开且此功能保持运行时生效；关闭应用后无法送达通知。</strong></p>
    <p>默认关闭，不自动调用 AI 或付费网络服务。问候与跟进均为标明来源的本地固定文案。</p>
    <label><input type="checkbox" checked={config.enabled} onChange={event => update({ enabled: event.target.checked })} />开启本地定时提醒</label>
    <fieldset>
      <legend>时间与频率（设备本地时间）</legend>
      <p>每天每个角色最多一次，仅提醒当前选中的角色；错过该分钟不补发。</p>
      <label>提醒时间 <input type="time" required value={config.schedule} onChange={event => update({ schedule: event.target.value })} /></label>
      <label>提醒内容 <select value={config.kind} onChange={event => update({ kind: event.target.value as ProactiveConfig['kind'] })}>
        <option value="greeting">定时问候</option><option value="followup">话题跟进（不引用聊天内容）</option>
      </select></label>
    </fieldset>
    <fieldset>
      <legend>免打扰</legend>
      <label><input type="checkbox" checked={config.dndEnabled} onChange={event => update({ dndEnabled: event.target.checked })} />启用免打扰</label>
      <label>免打扰开始 <input type="time" required value={config.dndStart} onChange={event => update({ dndStart: event.target.value })} /></label>
      <label>免打扰结束 <input type="time" required value={config.dndEnd} onChange={event => update({ dndEnd: event.target.value })} /></label>
      <p>支持跨午夜；开始与结束相同代表全天免打扰。免打扰或聊天忙碌时跳过，不延后补发。</p>
    </fieldset>
    <fieldset>
      <legend>系统通知（可选）</legend>
      <p>通知可能出现在锁屏上；标题与正文仅显示通用提醒，不包含角色名、话题或聊天内容。系统通知也仅在应用打开时触发。</p>
      <p>通知权限：{permission === 'unsupported' ? '浏览器不支持' : permission === 'granted' ? '已允许' : permission === 'denied' ? '已拒绝（请在浏览器设置修改）' : '尚未申请'}</p>
      {config.notifications
        ? <button type="button" onClick={() => update({ notifications: false })}>关闭系统通知</button>
        : <button type="button" disabled={requesting || permission === 'unsupported' || permission === 'denied'} onClick={() => { void enableNotifications() }}>启用系统通知（申请权限）</button>}
    </fieldset>
    <p role="status" aria-live="polite">{status}</p>
  </section>
}
