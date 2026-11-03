import { useEffect, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import { chapters, chapterIntro, chapterEnding, completeStoryChapter, loadStoryProgress, localDate, storyTitle, type StoryProgress } from './sevenDayStory'
import './sevenDayStory.css'

type Props = { temporary: boolean; onSaved: () => void; onClose: () => void }
export default function SevenDayStory({ temporary, onSaved, onClose }: Props) {
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
  const show = (index: number | null) => { setView(index); setStarted(false); setChoice(null); setNotice(''); setError('') }
  const save = async (index: number) => {
    if (choice === null || busy.current) return
    busy.current = true; setSaving(true); setError('')
    try {
      const saved = await completeStoryChapter(index, choice)
      setProgress(saved); setView(index); setChoice(saved.choices[index]); setNotice('已保存选择与回忆'); onSaved()
    } catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败，请重试') }
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
    <header><div><small>陆听澜 · 七日主线 · 本机剧情</small><h2 id="seven-day-title">{storyTitle}</h2></div><button aria-label="关闭故事" disabled={saving} onClick={onClose}>×</button></header>
    {temporary ? <p>临时会话不读取或保存故事进度。结束临时会话后再来续写吧。</p> : !progress ? <><p>{error || '正在读取故事进度…'}</p></> : <>
      <p className="story-progress">已完成 {count} / 7 章 · 每个设备本地日续写一章，错过也不重置</p>
      <nav aria-label="七日章节" className="story-days">{chapters.map((item, i) => <button key={item.title} disabled={saving || i > count} aria-current={i === index ? 'step' : undefined} aria-label={i < count ? `回看第 ${i + 1} 天：${item.title}` : `第 ${i + 1} 天：${item.title}`} onClick={() => show(i)}><span>{i < count ? '✓' : i + 1}</span><small>{item.title}</small></button>)}</nav>
      {count === 7 && <p className="story-complete">七天篇章已完成</p>}
      <h3 className="story-chapter">第 {index + 1} 天</h3><h2>{chapter.title}</h2>
      <div className="story-art"><span>{chapter.art}</span><p>{chapterIntro(index, history!)}</p></div>
      {locked ? <><p>明天再续写下一章</p><p>不必连续签到，你们的故事会在这里等你。</p></> : picked !== null ? <div className="story-ending"><p>你的选择：{chapter.choices[picked].label}</p><h3>{index === 6 ? '把这一周，写成我们' : '这一刻，被好好记住了'}</h3><p>{chapterEnding(index, picked, history!)}</p>{!completed && <><p>确认后将选择与本章回忆保存在本机，可在回忆页管理；剧情选择不是你的真实个人资料。</p><button className="story-next" disabled={saving} onClick={() => void save(index)}>{saving ? '正在保存…' : '确认保存选择与回忆'}</button><button className="story-back" disabled={saving} onClick={() => setChoice(null)}>重新选择</button></>}{completed && count < 7 && <button className="story-next" onClick={() => show(null)}>查看下一章</button>}</div> : started ? <div className="story-choices">{chapter.choices.map((item, i) => <button key={item.label} onClick={() => setChoice(i)}><strong>{item.label}</strong><span>{item.line}</span></button>)}</div> : <button className="story-next" onClick={() => setStarted(true)}>开始这一章</button>}
      {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
      <footer>与 AI 角色的固定本机故事 · 不调用模型 · 不付费、不惩罚选择<br/>进度不随聊天备份导出；导入或清空聊天会重置进度</footer>
    </>}
  </section></div>
}
