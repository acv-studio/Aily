import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { characters, type CharacterId } from './data'
import { getDailyEvent } from './dailyEvents'
import { useI18n } from './i18n'
import './dailyEvents.css'

export default function DailyEventCard({ selected, disabled = false, onChat }: {
  selected: CharacterId
  disabled?: boolean
  onChat: (characterId: CharacterId, text: string) => void
}) {
  const { locale, t } = useI18n()
  const en = locale === 'en'
  const [role, setRole] = useState(selected)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => setRole(selected), [selected])
  useEffect(() => {
    // Refresh after midnight, clock changes and returning from a suspended tab.
    const refresh = () => { if (!document.hidden) setNow(new Date()) }
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  const event = getDailyEvent(now, role, locale)
  return <section className="daily-event glass" aria-label={en ? 'Today’s small event' : '今日轻量事件'}>
    <header><span><Sparkles size={15} />{en ? 'Today’s small event' : '今日轻量事件'}</span><time dateTime={event.dateKey}>{now.toLocaleDateString(en ? 'en-US' : 'zh-CN', { month: 'long', day: 'numeric' })}</time></header>
    <small className="daily-event-kind">{event.kind === 'holiday' ? (en ? 'Holiday topic' : '节日话题') : (en ? 'Daily topic' : '日常话题')}</small>
    <h2>{event.title}</h2>
    <label>{en ? 'Chat with' : '一起聊的角色'}<select aria-label={en ? 'Chat with' : '一起聊的角色'} value={role} disabled={disabled} onChange={change => setRole(change.target.value as CharacterId)}>{characters.map(character => <option key={character.id} value={character.id}>{t(character.name)}</option>)}</select></label>
    <p className="daily-event-invitation">{event.invitation}</p>
    <div className="daily-event-choices">{event.choices.map((choice, index) => <button key={choice} disabled={disabled} onClick={() => onChat(role, event.prompts[index])}>{choice}</button>)}</div>
    <p className="daily-event-note">{en ? 'Curated local topics, not AI-generated. Choose to open an editable chat draft; nothing is sent or saved as a memory automatically. One topic per device-local day; skip freely, no streaks or catch-up.' : '本机编写话题，非 AI 生成。选择后仅打开可编辑的聊天草稿，不自动发送或保存回忆。按设备本地日期每日一题，可自由跳过，不计连续天数、不补发。'}</p>
  </section>
}
