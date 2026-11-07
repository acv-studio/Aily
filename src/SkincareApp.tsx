import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Camera, Check, ChevronLeft, ChevronRight, Moon, Plus, Sun, X, ArrowUp, ArrowDown, Trash2 } from 'lucide-react'
import type { Locale } from './i18n'
import { localToday, personalToolId, isPersonalDate, shiftPersonalMonth, usePersonalItems, PersonalStoreNotice } from './personalToolsStorage'
import { SKIN_RECORD_KEY, SKIN_PLAN_KEY, isSkinRecord, isSkinRoutine, defaultSkinRoutines, skinMonth, hasSkinRoutineRecord, productCount } from './skincareData'
import type { SkinRecord, SkinRoutine } from './skincareData'
import { saveSkincarePhotos, getSkincarePhoto, removeSkincarePhotos } from './skincarePhotos'
import './skincareReference.css'
import { resolvedTheme, useTheme } from './theme'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'

type Copy = (zh: string, en: string) => string
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const conditions = ['稳定', '干燥', '泛红', '敏感', '爆痘']
const conditionEnglish: Record<string, string> = { 稳定: 'Stable', 干燥: 'Dry', 泛红: 'Redness', 敏感: 'Sensitive', 爆痘: 'Breakouts' }
type Editor = { kind: 'plan'; draft: SkinRoutine; baseline: string } | { kind: 'record'; draft: SkinRecord; original: SkinRecord | null } | { kind: 'delete'; original: SkinRecord }

function PhotoPreview({ id, copy }: { id: string; copy: Copy }) {
  const [photo, setPhoto] = useState<{ url: string; name: string } | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true, url: string | undefined
    setPhoto(null); setError(false)
    getSkincarePhoto(id).then(value => {
      if (!active) return
      if (!value) { setError(true); return }
      url = URL.createObjectURL(value.blob)
      setPhoto({ url, name: value.name })
    }).catch(() => { if (active) setError(true) })
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [id])
  return photo ? <img className="sk-photo" src={photo.url} alt={photo.name || copy('肤况照片', 'Skin photo')} /> : <span className="sk-photo-placeholder" role={error ? 'alert' : 'status'}>{error ? copy('照片读取失败或已不存在', 'Photo unavailable or could not be read') : copy('加载照片…', 'Loading photo…')}</span>
}

export default function SkincareApp({ locale, onClose }: { locale: Locale; onClose?: () => void }) {
  const copy: Copy = (zh, en) => locale === 'en' ? en : zh
  const recordStore = usePersonalItems<SkinRecord>(SKIN_RECORD_KEY, isSkinRecord)
  const planStore = usePersonalItems<SkinRoutine>(SKIN_PLAN_KEY, isSkinRoutine)
  const records = recordStore.items
  const templates = defaultSkinRoutines
  const routines = (['morning', 'evening'] as const).map(id => planStore.items.find(item => item.id === id) ?? templates.find(item => item.id === id)!).filter(Boolean)
  const today = localToday()
  const [tab, setTab] = useState<'plans' | 'calendar' | 'diary'>('plans')
  const [month, setMonth] = useState(today.slice(0, 7))
  const [dateFilter, setDateFilter] = useState<string | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [dirty, setDirty] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const { resolved: appTheme } = useTheme()
  const [nightOverride, setNightOverride] = useState<boolean | null>(null)
  const night = nightOverride ?? appTheme === 'dark'
  const setNight = (value: boolean) => setNightOverride(value)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    void StatusBar.setStyle({ style: night ? Style.Dark : Style.Light }).catch(() => {})
    return () => { void StatusBar.setStyle({ style: resolvedTheme() === 'dark' ? Style.Dark : Style.Light }).catch(() => {}) }
  }, [night])
  const busyRef = useRef(false)
  const newPhotos = useRef(new Set<string>())
  const backgroundRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const closeRef = useRef<() => void>(() => {})
  const mountedRef = useRef(true)
  const completingRef = useRef(new Set<string>())
  useEffect(() => { completingRef.current.clear() }, [records])
  const stats = skinMonth(records, month)
  const calendarCells = [...stats.cells]
  // February can fit exactly four weeks; keep the calendar at least five rows.
  while (calendarCells.length < 35) {
    const next = new Date(`${calendarCells[calendarCells.length - 1].date}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    const date = next.toISOString().slice(0, 10)
    const dayRecords = records.filter(record => record.date === date)
    calendarCells.push({ date, inMonth: false, morning: dayRecords.some(record => record.period === '早'), evening: dayRecords.some(record => record.period === '晚'), records: dayRecords })
  }
  const setWorking = (value: boolean) => { busyRef.current = value; setBusy(value) }
  const openEditor = (value: Editor) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setError(''); setNotice(''); setDirty(false); setDiscard(false); newPhotos.current.clear(); setEditor(value)
  }
  const editRecord = (record: SkinRecord) => openEditor({ kind: 'record', original: clone(record), draft: clone(record) })
  const addRecord = () => openEditor({ kind: 'record', original: null, draft: { id: personalToolId(), date: dateFilter ?? today, period: '早', products: '', condition: '稳定', notes: '', photoIds: [] } })
  const finishEditor = () => {
    setEditor(null); setDirty(false); setDiscard(false); setError(''); newPhotos.current.clear()
    requestAnimationFrame(() => returnFocus.current?.focus())
  }
  const cleanupUnreferenced = async (ids: string[]) => {
    if (!ids.length) return
    // Re-read the plain record array before deleting blobs, including references from other tabs.
    const raw = localStorage.getItem(SKIN_RECORD_KEY)
    const all: unknown = raw === null ? [] : JSON.parse(raw)
    if (!Array.isArray(all) || !all.every(isSkinRecord)) throw new Error('Cannot verify photo references')
    const referenced = new Set(all.flatMap(record => record.photoIds ?? []))
    const orphaned = [...new Set(ids)].filter(id => !referenced.has(id))
    if (orphaned.length) await removeSkincarePhotos(orphaned)
  }
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const ids = [...newPhotos.current]
      if (ids.length) void cleanupUnreferenced(ids).catch(error => console.error('Skincare draft photo cleanup failed on unmount', error))
    }
  }, [])
  const cancelEditor = async () => {
    if (busyRef.current) return
    setWorking(true)
    try { await cleanupUnreferenced([...newPhotos.current]); finishEditor() }
    catch { setError(copy('未能清理草稿照片。草稿仍保留，请重试取消；记录未保存。', 'Draft photos could not be removed. The draft is retained; retry canceling. No record was saved.')) }
    finally { setWorking(false) }
  }
  const requestClose = () => {
    if (busyRef.current) return
    if (editor) { if (dirty) setDiscard(true); else void cancelEditor() }
    else onClose?.()
  }
  closeRef.current = requestClose
  useEffect(() => {
    if (!editor) return
    const background = backgroundRef.current
    background?.setAttribute('inert', '')
    const frame = requestAnimationFrame(() => modalRef.current?.querySelector<HTMLElement>('input, button, select, textarea')?.focus())
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      event.stopImmediatePropagation()
      const elements = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter(el => !el.closest('[hidden]'))
      const first = elements[0], last = elements[elements.length - 1]
      if (!first) { event.preventDefault(); modalRef.current?.focus(); return }
      if (!modalRef.current?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) { event.preventDefault(); (event.shiftKey ? last : first).focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', keydown, true)
    return () => { cancelAnimationFrame(frame); background?.removeAttribute('inert'); window.removeEventListener('keydown', keydown, true) }
  }, [!!editor])
  const updateRecord = (change: Partial<SkinRecord>) => { setEditor(prev => prev?.kind === 'record' ? { ...prev, draft: { ...prev.draft, ...change } } : prev); setDirty(true); setError('') }
  const updatePlan = (change: Partial<SkinRoutine>) => { setEditor(prev => prev?.kind === 'plan' ? { ...prev, draft: { ...prev.draft, ...change } } : prev); setDirty(true); setError('') }
  const staleDraft = () => setError(copy('此记录或计划已更改，草稿未覆盖原数据。请保留所需内容，取消后重新打开最新数据。', 'This record or plan changed. The draft did not overwrite it. Keep any needed draft text, cancel, and reopen the latest data.'))
  const savePlan = () => {
    if (busyRef.current || editor?.kind !== 'plan') return
    const draft = editor.draft
    if (!isSkinRoutine(draft)) { setError(copy('请填写计划名称及每一步的名称。产品可以留空。', 'Enter a plan name and every step name. Products may be blank.')); return }
    setWorking(true)
    try {
      if (JSON.stringify(planStore.items) !== editor.baseline) { staleDraft(); return }
      const next = routines.map(routine => routine.id === draft.id ? draft : routine)
      if (planStore.save(next)) { finishEditor(); setNotice(copy('计划已保存。', 'Plan saved.')) }
    } finally { setWorking(false) }
  }
  const completeRoutine = (routine: SkinRoutine) => {
    if (busyRef.current) return
    const existing = records.find(record => record.date === today && record.period === routine.period)
    if (existing) { editRecord(existing); return }
    const completionKey = `${today}:${routine.period}`
    if (!routine.steps.length || recordStore.blocked || completingRef.current.has(completionKey)) return
    completingRef.current.add(completionKey)
    setWorking(true)
    try {
      const record: SkinRecord = { id: personalToolId(), date: today, period: routine.period, products: routine.steps.map(step => [step.name.trim(), step.product.trim()].filter(Boolean).join('：')).join('；'), condition: '稳定', notes: '计划完成' }
      if (recordStore.save([...records, record])) setNotice(copy('今天的计划已记录，可在日记中编辑肤况。', 'Today’s routine is recorded. You can edit the self-reported condition in your diary.'))
      else completingRef.current.delete(completionKey)
    } finally { setWorking(false) }
  }
  const importPhotos = async (files: FileList | null) => {
    if (!files?.length || busyRef.current || editor?.kind !== 'record') return
    const selected = Array.from(files)
    if ((editor.draft.photoIds?.length ?? 0) + selected.length > 3) { setError(copy('每条记录最多 3 张照片。', 'Up to 3 photos per record.')); return }
    if (selected.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024 || file.size === 0)) { setError(copy('请选择 JPEG、PNG 或 WebP，每张不超过 5 MB，且文件不能为空。', 'Choose nonempty JPEG, PNG or WebP files, up to 5 MB each.')); return }
    setWorking(true); setError('')
    try {
      const ids = await saveSkincarePhotos(selected.map(file => ({ blob: file, name: file.name })))
      if (!mountedRef.current) { await cleanupUnreferenced(ids); return }
      ids.forEach(id => newPhotos.current.add(id))
      updateRecord({ photoIds: [...(editor.draft.photoIds ?? []), ...ids] })
    } catch (failure) {
      if (mountedRef.current) setError(copy('照片未能导入，记录尚未保存。请检查本地存储后重试。', 'Photos could not be imported. No record was saved. Check local storage and retry.'))
      else console.error('Skincare photo import or cleanup failed after unmount', failure)
    }
    finally { if (mountedRef.current) setWorking(false) }
  }
  const saveRecord = async () => {
    if (busyRef.current || editor?.kind !== 'record') return
    const { draft, original } = editor
    if (!isPersonalDate(draft.date) || !['早', '晚'].includes(draft.period)) { setError(copy('请选择有效日期与时段。', 'Choose a valid date and period.')); return }
    if (!draft.products.trim() && !draft.notes.trim() && !draft.photoIds?.length) { setError(copy('请填写使用产品、备注或添加照片，至少一项。', 'Enter products or notes, or add a photo. At least one is required.')); return }
    setWorking(true); setError('')
    let saved = false
    try {
      const latest = records.find(record => record.id === draft.id)
      if (original ? JSON.stringify(latest) !== JSON.stringify(original) : !!latest) { staleDraft(); return }
      const next = original ? records.map(record => record.id === draft.id ? draft : record) : [...records, draft]
      if (!recordStore.save(next)) return
      saved = true
      const removed = [...(original?.photoIds ?? []), ...newPhotos.current].filter(id => !draft.photoIds?.includes(id))
      finishEditor(); setNotice(copy('日记已保存。', 'Diary entry saved.'))
      await cleanupUnreferenced(removed)
    } catch { setError(saved ? copy('记录已保存，但部分不再使用的本地照片未清理。没有撤销已保存记录。', 'The record was saved, but unused local photos could not all be removed. The saved record was not rolled back.') : copy('记录未保存，草稿及照片保留，请重试。', 'The record was not saved. Draft and photos are retained; please retry.')) }
    finally { setWorking(false) }
  }
  const deleteRecord = async () => {
    if (busyRef.current || editor?.kind !== 'delete') return
    const original = editor.original
    setWorking(true); setError('')
    let saved = false
    try {
      if (JSON.stringify(records.find(record => record.id === original.id)) !== JSON.stringify(original)) { staleDraft(); return }
      if (!recordStore.save(records.filter(record => record.id !== original.id))) return
      saved = true; finishEditor(); setNotice(copy('已删除这条记录。', 'This record was deleted.'))
      await cleanupUnreferenced(original.photoIds ?? [])
    } catch { setError(saved ? copy('记录已删除，但本地照片清理失败。记录删除没有撤销。', 'The record was deleted, but local photo cleanup failed. The deletion was not rolled back.') : copy('删除失败，原记录保留。', 'Deletion failed. The original record is retained.')) }
    finally { setWorking(false) }
  }
  const selectDay = (date: string) => { setDateFilter(date); setTab('diary') }
  const displayed = records.filter(record => !dateFilter || record.date === dateFilter).slice().sort((a, b) => b.date.localeCompare(a.date) || (a.period === b.period ? 0 : a.period === '晚' ? -1 : 1))
  const periodLabel = (period: string) => period === '早' ? copy('早间', 'Morning') : copy('晚间', 'Evening')
  const formatDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(locale === 'en' ? 'en-US' : 'zh-CN', { month: 'long', day: 'numeric', year: 'numeric' })
  return <section className={`skincare-app${night ? ' sk-night' : ''}`} data-testid="skincare-app" aria-label={copy('护肤记录', 'Skincare')}>
    <div className="sk-background" ref={backgroundRef} aria-hidden={editor ? true : undefined}>
      <header className="sk-header"><button type="button" className="sk-icon-button" onClick={requestClose} aria-label={copy('返回', 'Back')} disabled={!onClose}><ArrowLeft size={21} /></button><div><h1>{copy('护肤时光', 'Skin Rituals')}</h1><p>{copy('简单记录，温柔照顾自己', 'A little ritual, a moment for yourself')}</p></div><button type="button" className="sk-icon-button sk-theme" onClick={() => setNight(!night)} aria-label={night ? copy('切换浅色主题', 'Switch to light theme') : copy('切换夜间主题', 'Switch to night theme')} aria-pressed={night}>{night ? <Sun size={20} /> : <Moon size={20} />}</button></header>
      <main className="sk-content">
        <PersonalStoreNotice store={recordStore} copy={copy} /><PersonalStoreNotice store={planStore} copy={copy} />
        {error && !editor && <p className="sk-error" role="alert">{error}</p>}{notice && <p className="sk-notice" role="status">{notice}</p>}
        {tab === 'plans' && <div className="sk-plans" data-testid="skincare-plans"><div className="sk-section-heading"><span className="sk-eyebrow">DAILY RITUALS</span><h2>{copy('我的护肤计划', 'Your daily rituals')}</h2><p>{copy('从早到晚，为自己留一点时间', 'Make a little space for yourself, morning and night')}</p></div>
          {routines.map(routine => { const done = hasSkinRoutineRecord(records, today, routine.period); return <article className={`sk-routine sk-${routine.id}`} key={routine.id} data-testid={`skincare-plan-${routine.id}`}><button type="button" className="sk-plan-open" onClick={() => openEditor({ kind: 'plan', draft: clone(routine), baseline: JSON.stringify(planStore.items) })} aria-label={`${copy('编辑计划', 'Edit routine')} ${routine.name}`}><span className="sk-icon-tile">{routine.id === 'morning' ? <Sun size={30} /> : <Moon size={30} />}</span><span className="sk-plan-copy"><span className="sk-eyebrow">{routine.id === 'morning' ? 'MORNING ROUTINE' : 'EVENING ROUTINE'}</span><strong>{routine.name}</strong><span>{routine.steps.length} {copy('个步骤', 'steps')} · {productCount(routine)} {copy('款产品', 'products')}</span></span><ChevronRight size={19} /></button><div className="sk-plan-bottom"><span>{done ? copy('今天已记录', 'Recorded today') : copy('跟随自己的节奏', 'At your own pace')}</span><button type="button" className={`sk-complete${done ? ' is-complete' : ''}`} data-testid={`skincare-complete-${routine.id}`} onClick={() => completeRoutine(routine)} disabled={busy || (!done && (recordStore.blocked || !routine.steps.length))} aria-label={done ? `${periodLabel(routine.period)} ${copy('已完成，查看记录', 'completed, view record')}` : `${copy('记录今天', 'Record today’s')} ${periodLabel(routine.period)}`}><Check size={16} />{done ? copy('已完成', 'Completed') : copy('记录完成', 'Mark done')}</button></div></article> })}
          <button type="button" className="sk-diary-card" onClick={() => { setDateFilter(null); setTab('diary') }}><span className="sk-icon-tile"><BookOpen size={29} /></span><span><span className="sk-eyebrow">SKIN DIARY</span><strong>{copy('肌肤日记', 'Skin Diary')}</strong><small>{copy('记下肤况与每一个小变化', 'Your observations, in your own words')}</small></span><ChevronRight size={19} /></button>
          <section className="sk-mini-stats" aria-label={copy('本月记录统计', 'This month’s recording statistics')}><span><strong>{skinMonth(records, today.slice(0, 7)).recordDays}</strong>{copy('本月记录天数', 'Days recorded this month')}</span><span><strong>{skinMonth(records, today.slice(0, 7)).morningCount + skinMonth(records, today.slice(0, 7)).eveningCount}</strong>{copy('已记录时段', 'Periods recorded')}</span></section>
        </div>}
        {tab === 'calendar' && <section className="sk-calendar-section" data-testid="skincare-calendar"><div className="sk-section-heading"><span className="sk-eyebrow">YOUR CONSISTENCY</span><h2>{copy('护肤日历', 'Your skincare calendar')}</h2><p>{copy('蓝色标记代表已保存的记录', 'Blue markers show saved records')}</p></div><div className="sk-calendar-card"><div className="sk-month-controls"><button type="button" className="sk-icon-button" onClick={() => setMonth(shiftPersonalMonth(month, -1))} aria-label={copy('上个月', 'Previous month')}><ChevronLeft size={20} /></button><h3>{new Date(`${month}-01T12:00:00`).toLocaleDateString(locale === 'en' ? 'en-US' : 'zh-CN', { year: 'numeric', month: 'long' })}</h3><button type="button" className="sk-icon-button" onClick={() => setMonth(shiftPersonalMonth(month, 1))} aria-label={copy('下个月', 'Next month')}><ChevronRight size={20} /></button></div><button type="button" className="sk-today-button" onClick={() => { setMonth(today.slice(0, 7)); setDateFilter(today) }}>{copy('回到今天', 'Today')}</button><div className="sk-weekdays">{(locale === 'en' ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['一', '二', '三', '四', '五', '六', '日']).map((day, index) => <span key={index}>{day}</span>)}</div><div className="sk-calendar-grid" style={{ gridTemplateRows: `repeat(${calendarCells.length / 7}, auto)` }}>{calendarCells.map(cell => <button type="button" key={cell.date} className={`sk-day${cell.inMonth ? '' : ' is-adjacent'}${cell.date === today ? ' is-today' : ''}${cell.date === dateFilter ? ' is-selected' : ''}`} onClick={() => selectDay(cell.date)} aria-label={`${cell.date}, ${copy('早间', 'AM')} ${cell.morning ? copy('已记录', 'recorded') : copy('未记录', 'not recorded')}, ${copy('晚间', 'PM')} ${cell.evening ? copy('已记录', 'recorded') : copy('未记录', 'not recorded')}`}><span className="sk-day-number">{Number(cell.date.slice(-2))}</span><span className="sk-day-markers" aria-hidden="true"><span className={`sk-half sk-am${cell.morning ? ' is-filled' : ''}`} /><span className={`sk-half sk-pm${cell.evening ? ' is-filled' : ''}`} /></span></button>)}</div><div className="sk-calendar-legend"><span><i className="sk-half sk-am is-filled" />{copy('早间', 'AM')}</span><span><i className="sk-half sk-pm is-filled" />{copy('晚间', 'PM')}</span><small>{copy('点击日期查看当天日记', 'Select a date to see its diary')}</small></div></div><section className="sk-stats"><div><Sun size={18} /><strong>{stats.morningCount}</strong><span>{copy('早间记录', 'Morning periods')}</span></div><div><Moon size={18} /><strong>{stats.eveningCount}</strong><span>{copy('晚间记录', 'Evening periods')}</span></div><div><BookOpen size={18} /><strong>{stats.recordDays}</strong><span>{copy('记录天数', 'Days recorded')}</span></div></section><p className="sk-muted">{copy('同一日期、时段只计一次；记录次数不代表医疗或护肤效果。', 'Each date and period counts once. Recording frequency is not a measure of medical or skincare effectiveness.')}</p></section>}
        {tab === 'diary' && <section className="sk-diary-section" data-testid="skincare-diary"><div className="sk-section-heading"><span className="sk-eyebrow">SKIN DIARY</span><h2>{copy('肌肤日记', 'Skin Diary')}</h2><p>{copy('真实感受，不必每天都完美', 'Honest observations. No need for perfect days.')}</p></div><div className="sk-diary-controls"><label>{copy('按日期查看', 'Filter by date')}<input type="date" value={dateFilter ?? ''} onChange={event => setDateFilter(event.target.value || null)} /></label>{dateFilter && <button type="button" onClick={() => setDateFilter(null)}>{copy('全部记录', 'All entries')}</button>}<button type="button" className="sk-primary" onClick={addRecord} disabled={recordStore.blocked}><Plus size={17} />{copy('写日记', 'Add entry')}</button></div><p className="sk-muted">{dateFilter ? formatDate(dateFilter) : copy('全部日期', 'All dates')} · {displayed.length} {copy('条记录', 'entries')}</p>{!displayed.length && <div className="sk-empty"><span className="sk-icon-tile"><BookOpen size={28} /></span><h3>{copy('留下一点今天的感受', 'A little note about today')}</h3><p>{copy('还没有记录。你的日记由你来写。', 'No entries yet. Your diary is yours to write.')}</p><button type="button" onClick={addRecord} disabled={recordStore.blocked}>{copy('添加第一条记录', 'Add your first entry')}</button></div>}{displayed.map(record => <article className="sk-record" key={record.id} data-record-id={record.id}><div className="sk-record-heading"><span className={`sk-small-tile ${record.period === '早' ? 'sk-morning' : 'sk-evening'}`}>{record.period === '早' ? <Sun size={19} /> : <Moon size={19} />}</span><div><h3>{formatDate(record.date)}</h3><p>{periodLabel(record.period)} · {locale === 'en' ? conditionEnglish[record.condition] ?? record.condition : record.condition}</p></div><button type="button" onClick={() => editRecord(record)} aria-label={`${copy('编辑记录', 'Edit entry')} ${record.date} ${periodLabel(record.period)}`}>{copy('编辑', 'Edit')}</button></div>{record.products && <p className="sk-record-products"><strong>{copy('使用产品', 'Products / steps')}</strong>{record.products}</p>}{record.notes && <p className="sk-record-notes">{record.notes}</p>}{!!record.photoIds?.length && <div className="sk-photo-grid">{record.photoIds.map(id => <PhotoPreview key={id} id={id} copy={copy} />)}</div>}<button type="button" className="sk-delete-link" onClick={() => openEditor({ kind: 'delete', original: clone(record) })} disabled={recordStore.blocked} aria-label={`${copy('删除记录', 'Delete entry')} ${record.date} ${periodLabel(record.period)}`}><Trash2 size={14} />{copy('删除记录', 'Delete entry')}</button></article>)}</section>}
        <aside className="sk-privacy"><Camera size={17} /><p>{copy('照片仅保存在当前浏览器的独立本地图库，不上传，不进入共享相册、聊天或聊天备份。清除浏览器数据会移除照片；共用设备上的其他人可能看到记录。肤况为你的自我描述，不是诊断。', 'Photos stay in a separate local library in this browser. They are not uploaded or included in shared albums, chat or chat backups. Clearing browser data removes photos; others on a shared device may see records. Skin conditions are your own observations, not diagnoses.')}</p></aside>
      </main><nav className="sk-bottom-nav" aria-label={copy('护肤导航', 'Skincare navigation')}>{([{ id: 'plans', zh: '计划', en: 'Plans', Icon: Sun }, { id: 'calendar', zh: '日历', en: 'Calendar', Icon: Moon }, { id: 'diary', zh: '日记', en: 'Diary', Icon: BookOpen }] as const).map(({ id, zh, en, Icon }) => <button type="button" key={id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined} data-testid={`skincare-tab-${id}`}><Icon size={21} /><span>{copy(zh, en)}</span></button>)}</nav>
    </div>
    {editor && <div className="sk-modal-backdrop"><div className="sk-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="sk-editor-title" tabIndex={-1} data-testid="skincare-editor"><div className="sk-modal-heading"><h2 id="sk-editor-title">{editor.kind === 'plan' ? copy('编辑护肤计划', 'Edit routine') : editor.kind === 'delete' ? copy('删除这条日记？', 'Delete this entry?') : editor.original ? copy('编辑日记', 'Edit entry') : copy('写一篇日记', 'New diary entry')}</h2><button type="button" className="sk-icon-button" onClick={requestClose} disabled={busy} aria-label={copy('关闭编辑器', 'Close editor')}><X size={21} /></button></div><PersonalStoreNotice store={editor.kind === 'plan' ? planStore : recordStore} copy={copy} />{error && <p className="sk-error" role="alert">{error}</p>}
      {discard ? <section className="sk-discard" role="alert"><h3>{copy('放弃未保存的修改？', 'Discard unsaved changes?')}</h3><p>{copy('本次草稿与新添加的照片会被移除。已保存记录不变。', 'This draft and newly added photos will be removed. Saved entries remain unchanged.')}</p><div className="sk-form-actions"><button type="button" onClick={() => setDiscard(false)} disabled={busy}>{copy('继续编辑', 'Keep editing')}</button><button type="button" className="sk-danger" onClick={() => void cancelEditor()} disabled={busy}>{copy('放弃修改', 'Discard changes')}</button></div></section> : editor.kind === 'delete' ? <section><p>{formatDate(editor.original.date)} · {periodLabel(editor.original.period)}</p><p>{editor.original.products || editor.original.notes}</p><p className="sk-muted">{copy('只删除此条记录。没有其他记录引用的照片也会从本地移除，此操作无法撤销。', 'Only this entry will be deleted. Photos not referenced by another entry will also be removed locally. This cannot be undone.')}</p><div className="sk-form-actions"><button type="button" onClick={() => void cancelEditor()} disabled={busy}>{copy('取消', 'Cancel')}</button><button type="button" className="sk-danger" onClick={() => void deleteRecord()} disabled={busy || recordStore.blocked}>{copy('确认删除这条记录', 'Delete this entry')}</button></div></section> : editor.kind === 'plan' ? <form onSubmit={event => { event.preventDefault(); savePlan() }}><label>{copy('计划名称', 'Routine name')}<input value={editor.draft.name} maxLength={120} onChange={event => updatePlan({ name: event.target.value })} required /></label><p className="sk-muted">{copy('默认模板不会自动保存。保存时保留早间与晚间两个计划。', 'Default templates are not saved automatically. Saving retains both morning and evening plans.')}</p><div className="sk-step-list">{editor.draft.steps.map((step, index) => <fieldset key={step.id}><legend>{copy('步骤', 'Step')} {index + 1}</legend><label>{copy('步骤名称', 'Step name')}<input value={step.name} maxLength={120} required onChange={event => updatePlan({ steps: editor.draft.steps.map(item => item.id === step.id ? { ...item, name: event.target.value } : item) })} /></label><label>{copy('使用产品（可选）', 'Product (optional)')}<input value={step.product} maxLength={500} onChange={event => updatePlan({ steps: editor.draft.steps.map(item => item.id === step.id ? { ...item, product: event.target.value } : item) })} /></label><div className="sk-step-actions"><button type="button" aria-label={`${copy('上移步骤', 'Move step up')} ${index + 1}`} disabled={index === 0} onClick={() => { const steps = [...editor.draft.steps]; [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]]; updatePlan({ steps }) }}><ArrowUp size={17} /></button><button type="button" aria-label={`${copy('下移步骤', 'Move step down')} ${index + 1}`} disabled={index === editor.draft.steps.length - 1} onClick={() => { const steps = [...editor.draft.steps]; [steps[index + 1], steps[index]] = [steps[index], steps[index + 1]]; updatePlan({ steps }) }}><ArrowDown size={17} /></button><button type="button" aria-label={`${copy('删除步骤', 'Delete step')} ${index + 1}`} onClick={() => updatePlan({ steps: editor.draft.steps.filter(item => item.id !== step.id) })}><Trash2 size={17} /></button></div></fieldset>)}</div><button type="button" className="sk-add-step" disabled={editor.draft.steps.length >= 20 || busy} onClick={() => updatePlan({ steps: [...editor.draft.steps, { id: personalToolId(), name: '', product: '' }] })}><Plus size={17} />{copy('添加步骤', 'Add step')}</button>{!editor.draft.steps.length && <p className="sk-muted">{copy('空计划可以保存，但不能标记完成。', 'An empty plan can be saved, but cannot be marked complete.')}</p>}<div className="sk-form-actions"><button type="button" onClick={requestClose} disabled={busy}>{copy('取消', 'Cancel')}</button><button type="submit" className="sk-primary" disabled={busy || planStore.blocked}>{copy('保存计划', 'Save routine')}</button></div></form> : <form onSubmit={event => { event.preventDefault(); void saveRecord() }}><div className="sk-form-row"><label>{copy('记录日期', 'Date')}<input type="date" value={editor.draft.date} required onChange={event => updateRecord({ date: event.target.value })} /></label><label>{copy('时段', 'Period')}<select value={editor.draft.period} onChange={event => updateRecord({ period: event.target.value as '早' | '晚' })}><option value="早">{copy('早间 AM', 'Morning AM')}</option><option value="晚">{copy('晚间 PM', 'Evening PM')}</option></select></label></div><label>{copy('使用产品 / 步骤', 'Products / steps')}<textarea value={editor.draft.products} rows={3} onChange={event => updateRecord({ products: event.target.value })} placeholder={copy('写下你实际使用的产品（可选）', 'Products you actually used (optional)')} /></label><label>{copy('自述肤况', 'Self-reported skin condition')}<select value={editor.draft.condition} onChange={event => updateRecord({ condition: event.target.value })}>{!conditions.includes(editor.draft.condition) && <option value={editor.draft.condition}>{editor.draft.condition}</option>}{conditions.map(value => <option key={value} value={value}>{locale === 'en' ? conditionEnglish[value] : value}</option>)}</select></label><label>{copy('备注', 'Notes')}<textarea value={editor.draft.notes} rows={3} onChange={event => updateRecord({ notes: event.target.value })} placeholder={copy('自己的观察与感受，不是诊断', 'Your observations, not a diagnosis')} /></label><div className="sk-photo-grid">{editor.draft.photoIds?.map(id => <div className="sk-draft-photo" key={id}><PhotoPreview id={id} copy={copy} /><button type="button" onClick={() => updateRecord({ photoIds: editor.draft.photoIds?.filter(item => item !== id) })} disabled={busy} aria-label={`${copy('移除照片', 'Remove photo')} ${id}`}><X size={16} /></button></div>)}</div><label className="sk-photo-input"><Camera size={19} />{copy('添加本地照片', 'Add local photos')}<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || (editor.draft.photoIds?.length ?? 0) >= 3} onChange={event => { const files = event.target.files; void importPhotos(files); event.target.value = '' }} /></label><p className="sk-muted">{copy('最多 3 张，每张 5 MB；仅 JPEG / PNG / WebP。照片暂存在草稿，只有保存日记后才会关联到记录。取消会清理新照片。', 'Up to 3 JPEG / PNG / WebP photos, 5 MB each. Imported photos belong to this draft until you save the entry. Canceling removes new photos.')}</p><div className="sk-form-actions"><button type="button" onClick={requestClose} disabled={busy}>{copy('取消', 'Cancel')}</button><button type="submit" className="sk-primary" disabled={busy || recordStore.blocked}>{busy ? copy('处理中…', 'Working…') : copy('保存日记', 'Save entry')}</button></div></form>}
    </div></div>}
  </section>
}
