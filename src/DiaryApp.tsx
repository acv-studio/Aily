import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { isPersonalDate, isPersonalMonth, isPersonalRecord, localToday, personalToolId, PersonalJsonExport, PersonalLocalNotice, PersonalStoreNotice, shiftPersonalMonth, usePersonalItems } from './personalToolsStorage'
import type { PersonalToolCopy } from './personalToolsStorage'
import './personalTools.css'

export type DiaryMood = 'great' | 'good' | 'okay' | 'low' | 'rough'
export type DiaryEntry = { id: string; date: string; text: string; mood?: DiaryMood }
export const DIARY_STORAGE_KEY = 'aily-desktop-diary'
const moods: { value: DiaryMood; symbol: string; zh: string; en: string }[] = [
  { value: 'great', symbol: '☀', zh: '很棒', en: 'Great' }, { value: 'good', symbol: '☺', zh: '不错', en: 'Good' }, { value: 'okay', symbol: '◯', zh: '平静', en: 'Okay' }, { value: 'low', symbol: '☁', zh: '低落', en: 'Low' }, { value: 'rough', symbol: '☂', zh: '难熬', en: 'Rough' },
]
export const isDiaryEntry = (value: unknown): value is DiaryEntry => isPersonalRecord(value) && typeof value.id === 'string' && isPersonalDate(value.date) && typeof value.text === 'string' && (value.mood === undefined || moods.some(mood => mood.value === value.mood))

export function DiaryApp({ copy }: { copy: PersonalToolCopy }) {
  const store = usePersonalItems(DIARY_STORAGE_KEY, isDiaryEntry)
  const [date, setDate] = useState(localToday), [text, setText] = useState(''), [mood, setMood] = useState<DiaryMood | ''>('')
  const [query, setQuery] = useState(''), [month, setMonth] = useState(''), [browseDate, setBrowseDate] = useState(''), [moodFilter, setMoodFilter] = useState<DiaryMood | 'all' | 'none'>('all')
  const [editing, setEditing] = useState<DiaryEntry | null>(null), [deleting, setDeleting] = useState<DiaryEntry | null>(null), [error, setError] = useState(''), [saved, setSaved] = useState('')
  const textarea = useRef<HTMLTextAreaElement>(null)
  const moodLabel = (value: DiaryMood) => { const entry = moods.find(item => item.value === value)!; return `${entry.symbol} ${copy(entry.zh, entry.en)}` }
  const needle = query.trim().toLocaleLowerCase()
  const visible = store.items.filter(item => (!month || item.date.startsWith(`${month}-`)) && (!browseDate || browseDate === item.date) && (moodFilter === 'all' || (moodFilter === 'none' ? !item.mood : item.mood === moodFilter)) && (!needle || `${item.text} ${item.date} ${item.mood ? moodLabel(item.mood) : ''}`.toLocaleLowerCase().includes(needle))).sort((a, b) => b.date.localeCompare(a.date))
  const reset = () => { setEditing(null); setText(''); setMood(''); setDate(localToday()); setError('') }
  const edit = (entry: DiaryEntry) => {
    if (editing || text || mood) { setError(copy('请先保存或取消当前草稿，再编辑其他日记。', 'Save or cancel your current draft before editing another diary entry.')); return }
    setEditing(entry); setDate(entry.date); setText(entry.text); setMood(entry.mood ?? ''); setError(''); setSaved('')
    textarea.current?.focus(); textarea.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }
  const submit = (event: FormEvent) => {
    event.preventDefault(); setSaved('')
    if (!text.trim() || !isPersonalDate(date) || text.length > Math.max(10000, editing?.text.length ?? 0)) { setError(copy('请填写有效日期和日记内容（最多 10000 字）。', 'Enter a valid date and diary text (up to 10,000 characters).')); return }
    const current = editing && store.items.find(item => item.id === editing.id)
    if (editing && (!current || JSON.stringify(current) !== JSON.stringify(editing))) { setError(copy('这篇日记在重新读取后已被更改或删除。草稿未保存；请保留所需内容，取消编辑后重新打开日记。', 'This diary entry changed or was deleted after reloading. Your draft was not saved. Keep any needed text, cancel editing, then reopen the entry.')); return }
    const entry: DiaryEntry = { ...(current || {}), id: editing?.id ?? personalToolId(), date, text: text.trim() }
    if (mood) entry.mood = mood; else delete entry.mood
    if (store.save(editing ? store.items.map(item => item.id === editing.id ? entry : item) : [entry, ...store.items])) { reset(); setSaved(copy('日记已保存。', 'Diary entry saved.')) } else setError('')
  }
  const remove = () => {
    if (!deleting) return
    const current = store.items.find(item => item.id === deleting.id)
    if (!current || JSON.stringify(current) !== JSON.stringify(deleting)) { setError(copy('待删除日记已更改，请取消后重新选择。', 'The diary entry selected for deletion changed. Cancel and select it again.')); return }
    if (store.save(store.items.filter(item => item.id !== deleting.id))) { setDeleting(null); setSaved(copy('日记已删除。', 'Diary entry deleted.')) }
  }
  const browseMonth = (next: string) => { setMonth(next); setBrowseDate('') }
  return <section className="personal-tools diary-app" aria-label={copy('日记记录', 'Diary records')}>
    <div className="personal-heading"><div><span className="personal-eyebrow">{copy('生活片刻', 'LITTLE MOMENTS')}</span><h3>{copy('留一点今天的痕迹', 'Keep a little of today')}</h3></div><PersonalJsonExport items={store.items} name="diary" blocked={store.blocked} isCurrent={store.isCurrent} copy={copy} /></div>
    <PersonalLocalNotice copy={copy} /><PersonalStoreNotice store={store} copy={copy} />
    <form className="personal-editor personal-diary-editor" onSubmit={submit}><h4>{editing ? copy('编辑日记', 'Edit diary entry') : copy('今天想记下什么', 'What would you like to remember?')}</h4><fieldset disabled={store.blocked}>
      <label>{copy('日记日期', 'Diary date')}<input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label>
      <label>{copy('心情（可选）', 'Mood (optional)')}<select value={mood} onChange={event => setMood(event.target.value as DiaryMood | '')}><option value="">{copy('不记录心情', 'No mood')}</option>{moods.map(item => <option value={item.value} key={item.value}>{moodLabel(item.value)}</option>)}</select></label>
      <label className="personal-wide">{copy('日记内容', 'Diary text')}<textarea ref={textarea} required rows={7} maxLength={Math.max(10000, editing?.text.length ?? 0)} value={text} onChange={event => setText(event.target.value)} placeholder={copy('一件小事、一个念头，或此刻的心情……', 'A small moment, a thought, or how you feel right now…')} /></label>
      <small className="personal-help personal-wide">{copy(`${text.length} / ${Math.max(10000, editing?.text.length ?? 0)} 字 · 只有点击保存才会写入本地`, `${text.length} / ${Math.max(10000, editing?.text.length ?? 0)} characters · Saved locally only when you press Save`)}</small>
      <button type="submit" className="personal-primary">{editing ? copy('保存修改', 'Save changes') : copy('保存日记', 'Save diary entry')}</button>
    </fieldset>{(editing || text || mood) && <button type="button" className="personal-cancel" onClick={reset}>{copy('取消草稿', 'Cancel draft')}</button>}</form>
    {error && <p className="personal-error" role="alert">{error}</p>}{saved && <p className="personal-status" role="status">{saved}</p>}
    <div className="personal-month-nav"><button type="button" aria-label={copy('上个月', 'Previous month')} onClick={() => browseMonth(shiftPersonalMonth(month || localToday().slice(0, 7), -1))}>‹</button><label>{copy('浏览月份', 'Browse month')}<input type="month" value={month} onChange={event => { if (!event.target.value || isPersonalMonth(event.target.value)) browseMonth(event.target.value) }} /></label><button type="button" aria-label={copy('下个月', 'Next month')} onClick={() => browseMonth(shiftPersonalMonth(month || localToday().slice(0, 7), 1))}>›</button><button type="button" onClick={() => browseMonth(localToday().slice(0, 7))}>{copy('本月', 'This month')}</button><button type="button" onClick={() => browseMonth('')}>{copy('全部日期', 'All dates')}</button></div>
    <div className="personal-filters"><label className="personal-search">{copy('搜索日记', 'Search diary')}<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={copy('内容、日期或心情', 'Text, date or mood')} /></label><label>{copy('心情筛选', 'Filter mood')}<select value={moodFilter} onChange={event => setMoodFilter(event.target.value as typeof moodFilter)}><option value="all">{copy('全部心情', 'All moods')}</option><option value="none">{copy('未记录心情', 'No recorded mood')}</option>{moods.map(item => <option value={item.value} key={item.value}>{moodLabel(item.value)}</option>)}</select></label><label>{copy('具体日期', 'Filter date')}<input type="date" value={browseDate} onChange={event => { setBrowseDate(event.target.value); if (event.target.value) setMonth(event.target.value.slice(0, 7)) }} /></label><button type="button" onClick={() => { setQuery(''); setMoodFilter('all'); setBrowseDate('') }}>{copy('清除筛选', 'Clear filters')}</button></div>
    <p className="personal-help" aria-live="polite">{copy(`显示 ${visible.length} / ${store.items.length} 篇日记`, `${visible.length} / ${store.items.length} diary entries shown`)}</p>
    {deleting && <div className="personal-delete-confirm" role="group" aria-label={copy('确认删除日记', 'Confirm diary deletion')}><p>{copy(`删除 ${deleting.date} 的这篇日记？此操作无法撤销。`, `Delete this diary entry from ${deleting.date}? This cannot be undone.`)}</p><button type="button" className="personal-danger" disabled={store.blocked} onClick={remove}>{copy('确认删除', 'Confirm delete')}</button><button type="button" onClick={() => setDeleting(null)}>{copy('取消删除', 'Cancel deletion')}</button></div>}
    <ul className="personal-entry-list personal-diary-list">{visible.map(item => <li key={item.id}><article className="personal-diary-card"><header><time dateTime={item.date}>{item.date}</time>{item.mood && <span className="personal-mood">{moodLabel(item.mood)}</span>}<div className="personal-row-actions"><button type="button" disabled={store.blocked || !!deleting} aria-label={copy(`编辑日记：${item.date}`, `Edit diary entry: ${item.date}`)} onClick={() => edit(item)}>{copy('编辑', 'Edit')}</button><button type="button" disabled={store.blocked || !!editing} aria-label={copy(`删除日记：${item.date}`, `Delete diary entry: ${item.date}`)} onClick={() => setDeleting(item)}>{copy('删除', 'Delete')}</button></div></header><p>{item.text}</p></article></li>)}</ul>
    {!visible.length && !store.blocked && <div className="personal-empty"><span aria-hidden="true">☀</span><h4>{store.items.length ? copy('没有匹配日记', 'No matching diary entries') : copy('这一页，留给今天', 'This page is yours')}</h4><p>{store.items.length ? copy('试试其他月份，或清除搜索和筛选。', 'Try another month, or clear your search and filters.') : copy('不必写得完整，一句话也值得记住。', 'It does not need to be perfect. Even one sentence is worth remembering.')}</p></div>}
  </section>
}
export default DiaryApp
