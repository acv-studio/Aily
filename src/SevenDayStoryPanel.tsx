import { useEffect, useRef, useState } from 'react'
import { useI18n } from './i18n'
import { storyEnglish } from './locales/storyEnglish'
import { liveQuery } from 'dexie'
import { chapters, chapterIntro, chapterEnding, completeStoryChapter, loadStoryProgress, localDate, storyTitle, type StoryProgress } from './sevenDayStory'
import './sevenDayStory.css'

const storyProsePattern = new RegExp(Object.keys(storyEnglish).filter(key => !key.includes('{')).sort((a, b) => b.length - a.length).map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
const storyErrorKeys = ['七日故事进度损坏，请保留数据后检查', '无效日期', '无效章节', '无效选择', '请先完成前面的章节', '下一章将在下一个本地日历日解锁', '此类记忆已关闭，请在记忆设置中启用关系记忆后重试']

type Props = { temporary: boolean; onSaved: () => void; onClose: () => void }
export default function SevenDayStory({ temporary, onSaved, onClose }: Props) {
  const { t, locale } = useI18n()
  const [progress, setProgress] = useState<StoryProgress>()
  const [error, setError] = useState('')
  const [day, setDay] = useState(() => localDate(new Date()))
  const [view, setView] = useState<number | null>(null)
  const [started, setStarted] = useState(false)
  const [choice, setChoice] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const busy = useRef(false)
  const sheet = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    sheet.current?.focus()
    return () => previous?.focus()
  }, [])
  useEffect(() => {
    if (temporary) return
    const subscription = liveQuery(loadStoryProgress).subscribe({ next: setProgress, error: () => setError('无法读取故事进度。请关闭后重试；未覆盖任何记录。') })
    const tick = () => setDay(localDate(new Date()))
    const timer = window.setInterval(tick, 30_000)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => { subscription.unsubscribe(); window.clearInterval(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick) }
  }, [temporary])
  // This input is generated exclusively from static story data and numeric choice IDs.
  // Do not use this helper on saved memories, profile values, or user-authored messages.
  const localizeGeneratedProse = (source: string) => source.replace(storyProsePattern, key => t(key))
    .replace(/第(\d+)章「([^」]+)」：/g, (_, count: string, title: string) => t('第{count}章「{title}」：', { count, title: t(title) }))
    .replace(/《([^》]+)》共同回顾：/g, (_, title: string) => t('《{title}》共同回顾：', { title: t(title) }))
    .replace(locale === 'en' ? /([.!?”])(?=[A-Z])/g : /$^/g, '$1 ')
  const show = (index: number | null) => { setView(index); setStarted(false); setChoice(null); setNotice(''); setError('') }
  const save = async (index: number) => {
    if (choice === null || busy.current) return
    busy.current = true; setSaving(true); setError('')
    try {
      const saved = await completeStoryChapter(index, choice)
      setProgress(saved); setView(index); setChoice(saved.choices[index]); setNotice('已保存选择与回忆'); onSaved()
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '保存失败，请重试'
      setError(storyErrorKeys.find(key => key === message || t(key) === message) || message)
    }
    finally { busy.current = false; setSaving(false) }
  }
  const count = progress?.choices.length ?? 0
  const index = view ?? Math.min(count, 6)
  const chapter = chapters[index]
  const completed = !!progress && index < count
  const locked = !completed && count > 0 && day <= progress!.completedDates[count - 1]
  const picked = completed ? progress!.choices[index] : choice
  const history = progress ? { choices: progress.choices.slice(0, index), completedDates: progress.completedDates.slice(0, index) } : undefined
  return <div className="game-overlay" onKeyDown={event => {
    if (event.key === 'Escape' && !busy.current) onClose()
    if (event.key === 'Tab') {
      const buttons = Array.from(sheet.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      const first = buttons[0], last = buttons.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}><section ref={sheet} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="seven-day-title" className="story-sheet seven-day-sheet glass">
    <header><div><small>{t('陆听澜 · 七日主线 · 本机剧情')}</small><h2 id="seven-day-title">{t(storyTitle)}</h2></div><button aria-label={t('关闭故事')} disabled={saving} onClick={onClose}>×</button></header>
    {temporary ? <p>{t('临时会话不读取或保存故事进度。结束临时会话后再来续写吧。')}</p> : !progress ? <><p>{t(error || '正在读取故事进度…')}</p></> : <>
      <p className="story-progress">{t('已完成 {count} / 7 章 · 每个设备本地日续写一章，错过也不重置', { count })}</p>
      <nav aria-label={t('七日章节')} className="story-days">{chapters.map((item, i) => <button key={item.title} disabled={saving || i > count} aria-current={i === index ? 'step' : undefined} aria-label={t(i < count ? '回看第 {count} 天：{title}' : '第 {count} 天：{title}', { count: i + 1, title: t(item.title) })} onClick={() => show(i)}><span>{i < count ? '✓' : i + 1}</span><small>{t(item.title)}</small></button>)}</nav>
      {count === 7 && <p className="story-complete">{t('七天篇章已完成')}</p>}
      <h3 className="story-chapter">{t('第 {count} 天', { count: index + 1 })}</h3><h2>{t(chapter.title)}</h2>
      <div className="story-art"><span>{chapter.art}</span><p>{localizeGeneratedProse(chapterIntro(index, history!))}</p></div>
      {locked ? <><p>{t('明天再续写下一章')}</p><p>{t('不必连续签到，你们的故事会在这里等你。')}</p></> : picked !== null ? <div className="story-ending"><p>{t('你的选择：{choice}', { choice: t(chapter.choices[picked].label) })}</p><h3>{t(index === 6 ? '把这一周，写成我们' : '这一刻，被好好记住了')}</h3><p>{localizeGeneratedProse(chapterEnding(index, picked, history!))}</p>{!completed && <><p>{t('确认后将选择与本章回忆保存在本机，可在回忆页管理；剧情选择不是你的真实个人资料。')}</p><button className="story-next" disabled={saving} onClick={() => void save(index)}>{t(saving ? '正在保存…' : '确认保存选择与回忆')}</button><button className="story-back" disabled={saving} onClick={() => setChoice(null)}>{t('重新选择')}</button></>}{completed && count < 7 && <button className="story-next" onClick={() => show(null)}>{t('查看下一章')}</button>}</div> : started ? <div className="story-choices">{chapter.choices.map((item, i) => <button key={item.label} onClick={() => setChoice(i)}><strong>{t(item.label)}</strong><span>{t(item.line)}</span></button>)}</div> : <button className="story-next" onClick={() => setStarted(true)}>{t('开始这一章')}</button>}
      {notice && <p role="status">{t(notice)}</p>}{error && <p role="alert">{t(error)}</p>}
      <footer>{t('与 AI 角色的固定本机故事 · 不调用模型 · 不付费、不惩罚选择')}<br/>{t('进度不随聊天备份导出；导入或清空聊天会重置进度')}</footer>
    </>}
  </section></div>
}
