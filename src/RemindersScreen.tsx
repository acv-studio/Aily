import { Bell, ChevronRight } from 'lucide-react'
import type { CharacterId } from './data'
import DailyEventCard from './DailyEventCard'
import { useI18n } from './i18n'
import './reminders.css'

export default function RemindersScreen({ selected, onChat, openSettings, openSmartReminders, dueCount = 0 }: {
  selected: CharacterId
  onChat: (characterId: CharacterId, text: string) => void
  openSettings: () => void
  openSmartReminders?: () => void
  dueCount?: number
}) {
  const { t } = useI18n()
  return <section className="screen reminders-screen" aria-label={t('提醒')}>
    <div className="reminders-intro"><h2>{t('今日提醒')}</h2><p>{t('节日与日常小事，想聊的时候再聊。')}</p></div>
    {openSmartReminders && <button className="reminder-settings-card reminder-smart-entry glass" onClick={openSmartReminders} aria-label={t('智能提醒')}>
      <Bell size={20} aria-hidden="true" />
      <span><strong>{t('智能提醒')}{dueCount > 0 && <em className="reminder-count">{dueCount}</em>}</strong><small>{t('喝水、吃饭、天气、心情、地铁与下一步计划')}</small></span>
      <ChevronRight size={18} aria-hidden="true" />
    </button>}
    <DailyEventCard selected={selected} onChat={onChat} />
    <button className="reminder-settings-card glass" onClick={openSettings}>
      <Bell size={20} aria-hidden="true" />
      <span><strong>{t('主动提醒设置')}</strong><small>{t('按角色设置问候频率与免打扰时段')}</small></span>
      <ChevronRight size={18} aria-hidden="true" />
    </button>
    <p className="reminders-note">{t('主动提醒默认关闭，仅在应用打开时检查，不提供关闭应用后的系统推送。')}</p>
  </section>
}
