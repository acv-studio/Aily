import { Bell, ChevronRight } from 'lucide-react'
import { useEffect } from 'react'
import { useI18n } from './i18n'
import type { Reminder } from './smartReminders'
import { ReminderItem } from './SmartReminderPanel'
import type { SmartReminderController } from './useSmartReminders'
import './reminders.css'

export default function RemindersScreen({ openSmartReminders, reminders = [], controller, dueCount = 0 }: {
  openSmartReminders?: () => void
  reminders?: Reminder[]
  controller?: SmartReminderController
  dueCount?: number
}) {
  const { t, locale } = useI18n()
  useEffect(() => {
    const id = controller?.openedNotificationId
    if (id && /^[A-Za-z0-9_-]{1,100}$/.test(id)) document.querySelector<HTMLElement>(`[data-reminder-id="${id}"]`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [controller?.openedNotificationId])
  const scheduled = reminders.filter(reminder => reminder.enabled && reminder.status !== 'completed').sort((a, b) => reminderTime(a) - reminderTime(b))
  return <section className="screen reminders-screen" aria-label={t('提醒')}>
    <div className="reminders-intro"><h2>{t('今日提醒')}</h2><p>{t('已设置的提醒会按时间顺序显示。')}</p></div>
    {openSmartReminders && <button className="reminder-settings-card reminder-smart-entry glass" onClick={openSmartReminders} aria-label={t('智能提醒')}>
      <Bell size={20} aria-hidden="true" />
      <span><strong>{t('智能提醒')}{dueCount > 0 && <em className="reminder-count">{dueCount}</em>}</strong><small>{t('喝水、吃饭、天气、心情、地铁与下一步计划')}</small></span>
      <ChevronRight size={18} aria-hidden="true" />
    </button>}
    <section className="my-reminders"><div className="section-title"><h3>{t('我的提醒')}</h3><span>{scheduled.length}</span></div>{scheduled.length > 0 && <div className="reminder-list" aria-label={t('按时间排列的提醒')}>{scheduled.map(reminder => controller ? <ReminderItem key={reminder.id} reminder={reminder} controller={controller} /> : <article key={reminder.id} className={`reminder-time-item glass ${reminder.status === 'due' ? 'due' : ''}`}><time dateTime={reminder.snoozedUntil || reminder.scheduledAt || reminder.createdAt}>{formatReminderTime(reminder, locale)}</time><div><strong>{reminder.title}</strong><small>{t(reminder.status === 'due' ? '现在需要处理' : '等待提醒')}</small></div></article>)}</div>}{!scheduled.length && <p className="reminder-empty-copy">{t('还没有提醒，从一杯水开始吧。')}</p>}</section>
    <p className="reminders-note">{locale === 'en' ? 'System local notifications are off by default. Enable them in Smart reminders for saved timed reminders; conditional reminders still require the app to detect the condition.' : '系统本地通知默认关闭。可在“智能提醒”中为已保存的定时提醒开启；条件提醒仍需要应用打开并检测条件。'}</p>
  </section>
}

function reminderTime(reminder: Reminder) {
  return reminder.snoozedUntil || reminder.scheduledAt ? Date.parse(reminder.snoozedUntil || reminder.scheduledAt!) : reminder.status === 'due' ? Date.now() : Number.MAX_SAFE_INTEGER
}

function formatReminderTime(reminder: Reminder, locale: string) {
  if (!reminder.snoozedUntil && !reminder.scheduledAt) return reminder.status === 'due' ? (locale === 'en' ? 'Now' : '现在') : (locale === 'en' ? 'When triggered' : '等待触发')
  const date = new Date(reminder.snoozedUntil || reminder.scheduledAt!)
  return date.toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
