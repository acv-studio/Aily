import { useState } from 'react'
import { Bell, RefreshCw } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { useI18n } from './i18n'
import type { SmartReminderController } from './useSmartReminders'
import './reminderNotificationSettings.css'

export default function ReminderNotificationSettings({ controller }: { controller: SmartReminderController }) {
  const { locale } = useI18n(), en = locale === 'en', text = (zh: string, english: string) => en ? english : zh
  const [result, setResult] = useState('')
  const info = controller.notifications
  if (!info) return null // Older embedded/test controllers remain application-only.
  const busy = controller.busy || info.busy || !controller.state
  return <section className="reminder-card reminder-notification-settings glass" aria-label={text('系统本地通知设置', 'System local notification settings')}>
    <h3><Bell size={18}/>{text('系统本地通知', 'System local notifications')}</h3>
    <p>{text('不需要后端。授权后，已安排的定时提醒由 iOS / Android 系统触发，应用未运行时也可显示；是否展示仍取决于系统设置。', 'No server needed. Once authorized and scheduled, iOS / Android can show timed reminders even while the app is not running. Display still depends on system settings.')}</p>
    {!info.available && <p className="reminder-notification-note">{text('当前浏览器或旧客户端不支持原生本地通知，仍保留应用内提醒。请使用已更新的 iOS / Android 客户端。', 'This browser or older client does not support native notifications. In-app reminders remain available; use the updated iOS / Android app.')}</p>}
    <label className="reminder-check"><input type="checkbox" checked={info.enabled} disabled={busy || !info.available} onChange={event => { setResult(''); void controller.enableNotifications(event.target.checked).finally(() => window.dispatchEvent(new Event('aily-open-reminder-notification'))) }}/>{text('开启系统通知', 'Enable system notifications')}</label>
    <label className="reminder-check"><input type="checkbox" checked={info.showDetails} disabled={busy || !info.available} onChange={event => { setResult(''); void controller.showNotificationDetails(event.target.checked) }}/>{text('在通知中显示具体内容', 'Show reminder details in notifications')}</label>
    <small>{text('默认只显示“你有一条 Aily 提醒”，不展示提醒正文、心情、车站或出口；打开具体内容后可能出现在锁屏，锁屏预览仍由系统控制。', 'By default only a generic Aily reminder is shown, without its message, mood, station or exit. Opting into details may expose them on the lock screen; previews are controlled by the OS.')}</small>
    {info.enabled && info.permission !== 'granted' && <p role="status" className="reminder-notification-note">{text('系统通知权限未允许。请到系统设置 → Aily → 通知中开启，然后返回并重新同步。', 'Notifications are not allowed. Enable them in system settings for Aily, then return and sync again.')}</p>}
    {info.enabled && info.permission === 'granted' && <p role="status">{text(`已登记 ${info.scheduledCount} 条系统通知（不代表已送达）。`, `${info.scheduledCount} system notifications queued, not delivery receipts.`)}</p>}
    {info.deferredCount > 0 && <p className="reminder-notification-note">{text(`还有 ${info.deferredCount} 条因系统队列容量暂未登记；打开应用时会滚动补排。当前未登记的提醒不保证关闭应用后触发。`, `${info.deferredCount} more exceed the system queue capacity. Opening the app replenishes the queue; unqueued reminders cannot be promised after closing it.`)}</p>}
    {info.contextOnlyCount > 0 && <p className="reminder-notification-note">{text(`有 ${info.contextOnlyCount} 条天气/心情等条件提醒，需要应用打开并检测到条件后再触发。`, `${info.contextOnlyCount} conditional reminders need the app open to detect their conditions.`)}</p>}
    {Capacitor.getPlatform() === 'android' && <p className="reminder-notification-note">{text('当前使用普通定时，不额外申请精准闹钟权限；安卓省电、Doze 和厂商策略可能导致延迟，不适合依赖秒级精度的紧急提醒。', 'Uses ordinary timing without extra exact-alarm permission. Android battery saving, Doze and vendor policies may delay delivery; do not rely on it for second-precise emergencies.')}</p>}
    <div className="reminder-notification-buttons"><button disabled={busy || !info.available} onClick={() => { setResult(''); void controller.syncNotifications() }}><RefreshCw size={15}/>{text('重新同步通知', 'Sync notifications')}</button><button disabled={busy || !info.available || !info.enabled || info.permission !== 'granted'} onClick={() => { setResult(''); void controller.testNotification().then(saved => { if (saved) setResult(text('测试通知已安排，约 3 秒后触发；可锁屏或切到后台检查。安卓可能延迟。', 'Test notification scheduled for about 3 seconds. Lock the device or background the app to check; Android may delay it.')) }) }}>{text('发送测试通知', 'Send test notification')}</button></div>
    {result && <p role="status" className="reminder-result">{result}</p>}
    {info.error && <div role="alert" className="chat-error">{info.error}<button disabled={busy} onClick={() => void controller.syncNotifications()}>{text('重试通知同步', 'Retry notification sync')}</button></div>}
    <small>{text('修改、暂停、完成、稍后提醒或删除后会同步更新系统队列。重复提醒完成本次后才安排下一次。免打扰按设备当地时间，改时区后请打开应用重新同步；地铁提醒仍按已有规则绕过免打扰。', 'Changes, pause, completion, snooze and deletion update the system queue. Repeats re-arm after completing the current occurrence. Quiet hours use device local time; reopen after timezone changes to resync. Metro reminders retain their existing quiet-hours exception.')}</small>
  </section>
}
