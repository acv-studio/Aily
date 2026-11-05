import { Bell, ChevronRight } from 'lucide-react'
import { useI18n } from './i18n'
import type { Reminder } from './smartReminders'
import './reminders.css'

export default function RemindersScreen({ openSmartReminders, reminders = [], dueCount = 0 }: {
  openSmartReminders?: () => void
  reminders?: Reminder[]
  dueCount?: number
}) {
  const { t, locale } = useI18n()
  const scheduled = reminders.filter(reminder => reminder.enabled && reminder.status !== 'completed' && (reminder.snoozedUntil || reminder.scheduledAt || reminder.status === 'due')).sort((a, b) => reminderTime(a) - reminderTime(b))
  return <section className="screen reminders-screen" aria-label={t('提醒')}>
    <div className="reminders-intro"><h2>{t('今日提醒')}</h2><p>{t('已设置的提醒会按时间顺序显示。')}</p></div>
    {openSmartReminders && <button className="reminder-settings-card reminder-smart-entry glass" onClick={openSmartReminders} aria-label={t('智能提醒')}>
      <Bell size={20} aria-hidden="true" />
      <span><strong>{t('智能提醒')}{dueCount > 0 && <em className="reminder-count">{dueCount}</em>}</strong><small>{t('喝水、吃饭、天气、心情、地铁与下一步计划')}</small></span>
      <ChevronRight size={18} aria-hidden="true" />
    </button>}
    {scheduled.length > 0 && <div className="reminder-time-list" aria-label={t('按时间排列的提醒')}>{scheduled.map(reminder => <article key={reminder.id} className={`reminder-time-item glass ${reminder.status === 'due' ? 'due' : ''}`}><time dateTime={reminder.snoozedUntil || reminder.scheduledAt || reminder.createdAt}>{formatReminderTime(reminder, locale)}</time><div><strong>{reminder.title}</strong><small>{t(reminder.status === 'due' ? '现在需要处理' : '等待提醒')}</small></div></article>)}</div>}
    <p className="reminders-note">{t('主动提醒默认关闭，仅在应用打开时检查，不提供关闭应用后的系统推送。')}</p>
  </section>
}

function reminderTime(reminder: Reminder) {
  return reminder.status === 'due' && !reminder.snoozedUntil && !reminder.scheduledAt ? Date.now() : Date.parse(reminder.snoozedUntil || reminder.scheduledAt!)
}

function formatReminderTime(reminder: Reminder, locale: string) {
  if (reminder.status === 'due' && !reminder.snoozedUntil && !reminder.scheduledAt) return locale === 'en' ? 'Now' : '现在'
  const date = new Date(reminder.snoozedUntil || reminder.scheduledAt!)
  return date.toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
