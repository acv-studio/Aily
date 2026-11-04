import { useEffect, useId, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from './i18n'
import './desktopTools.css'

export type DesktopTool = 'ledger' | 'album' | 'contacts' | 'music' | 'diary' | 'divination'
type Copy = (zh: string, en: string) => string
const titles: Record<DesktopTool, [string, string]> = { ledger: ['记账', 'Ledger'], album: ['相册', 'Album'], contacts: ['通讯录', 'Contacts'], music: ['音乐', 'Music'], diary: ['日记', 'Diary'], divination: ['梅花易数', 'Plum Blossom Divination'] }
const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` }
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
const baseValid = (value: unknown): value is Record<string, unknown> => isRecord(value) && typeof value.id === 'string'
const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function useLocalItems<T>(key: string, valid: (value: unknown) => boolean, copy: Copy) {
  const load = (): { items: T[]; failed: boolean; raw: string | null } => {
    try {
      const raw = localStorage.getItem(key)
      const parsed: unknown = raw === null ? [] : JSON.parse(raw)
      if (!Array.isArray(parsed) || !parsed.every(valid)) throw new Error('Invalid local data')
      return { items: parsed as T[], failed: false, raw }
    } catch { return { items: [], failed: true, raw: null } }
  }
  const [state, setState] = useState(load)
  const [writeFailed, setWriteFailed] = useState(false), [stale, setStale] = useState(false)
  const reload = () => { setState(load()); setWriteFailed(false); setStale(false) }
  const save = (items: T[]) => {
    if (state.failed || stale) return false
    try {
      // Best-effort stale-snapshot protection; localStorage offers no atomic compare-and-swap.
      if (localStorage.getItem(key) !== state.raw) { setStale(true); setWriteFailed(false); return false }
      const raw = JSON.stringify(items)
      localStorage.setItem(key, raw); setState({ items, failed: false, raw }); setWriteFailed(false); return true
    } catch { setWriteFailed(true); return false }
  }
  return { items: state.items, save, blocked: state.failed || stale, notice: <>{stale && <div className="desktop-error" role="alert">{copy('本地数据已在其他页面或操作中更改。本次修改未保存，请重新读取后重试；表单草稿会保留。', 'Local data changed in another page or action. This change was not saved. Reload before retrying; your form draft will be kept.')} <button type="button" onClick={reload}>{copy('重新读取', 'Reload data')}</button></div>}{state.failed && <div className="desktop-error" role="alert">{copy('本地数据读取失败。为避免覆盖原数据，暂时不能修改；请检查浏览器存储后重试。', 'Local data could not be read. Changes are blocked to protect existing data. Check browser storage, then retry.')} <button type="button" onClick={reload}>{copy('重试读取', 'Retry loading')}</button></div>}{writeFailed && <p className="desktop-error" role="alert">{copy('保存失败（存储不可用或已满）。本次修改未保存，原数据保持不变，请重试。', 'Save failed (storage unavailable or full). This change was not saved; existing data is unchanged. Please retry.')}</p>}</> }
}

export default function DesktopTools({ tool, onClose }: { tool: DesktopTool; onClose: () => void }) {
  const { locale } = useI18n()
  const copy: Copy = (zh, en) => locale === 'en' ? en : zh
  const titleId = useId()
  const dialog = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose); closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const node = dialog.current
    node?.focus()
    const focusable = () => Array.from(node?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), audio[controls], [tabindex="0"]') ?? []).filter(element => !element.hidden)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const elements = focusable(), first = elements[0], last = elements.at(-1)
      if (!first) { event.preventDefault(); node?.focus(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node || !node?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === node || !node?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    const guardFocus = (event: FocusEvent) => { if (event.target instanceof Node && !node?.contains(event.target)) node?.focus() }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('focusin', guardFocus)
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', onKey, true); document.removeEventListener('focusin', guardFocus); if (previous?.isConnected) previous.focus() }
  }, [])
  return createPortal(<div className="desktop-tools-overlay"><section ref={dialog} className="desktop-tools-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
    <header className="desktop-tools-header"><div><small>{copy('AILY · 本地生活工具', 'AILY · Local tools')}</small><h2 id={titleId}>{copy(...titles[tool])}</h2></div><button type="button" className="desktop-close" onClick={onClose} aria-label={copy('关闭工具', 'Close tool')}>×</button></header>
    <div className="desktop-tools-content" key={tool}>{tool === 'ledger' ? <Ledger copy={copy} /> : tool === 'contacts' ? <Contacts copy={copy} /> : tool === 'diary' ? <Diary copy={copy} /> : tool === 'album' ? <LocalMedia kind="album" copy={copy} /> : tool === 'music' ? <LocalMedia kind="music" copy={copy} /> : <Divination copy={copy} />}</div>
  </section></div>, document.body)
}

function LocalNotice({ copy }: { copy: Copy }) { return <p className="desktop-note">{copy('仅保存在当前浏览器，不上传、不同步，不包含在聊天加密备份中。清除浏览器数据会移除这些记录；共用设备上的其他使用者可能看到它们。', 'Saved only in this browser, never uploaded or synced, and not included in encrypted chat backups. Clearing browser data removes these records; other users of a shared device may see them.')}</p> }
type LedgerEntry = { id: string; kind: 'income' | 'expense'; cents: number; note: string; date: string }
function Ledger({ copy }: { copy: Copy }) {
  const store = useLocalItems<LedgerEntry>('aily-desktop-ledger', value => baseValid(value) && (value.kind === 'income' || value.kind === 'expense') && Number.isSafeInteger(value.cents) && Number(value.cents) > 0 && typeof value.note === 'string' && validDate(value.date), copy)
  const [kind, setKind] = useState<'income' | 'expense'>('expense'), [amount, setAmount] = useState(''), [note, setNote] = useState(''), [date, setDate] = useState(today), [error, setError] = useState('')
  const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`
  const income = store.items.filter(item => item.kind === 'income').reduce((sum, item) => sum + item.cents, 0)
  const expense = store.items.filter(item => item.kind === 'expense').reduce((sum, item) => sum + item.cents, 0)
  const add = (event: FormEvent) => {
    event.preventDefault()
    const cents = Math.round(Number(amount) * 100)
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || !Number.isSafeInteger(cents) || cents <= 0 || cents > 100000000000 || !validDate(date)) { setError(copy('请输入有效日期和正数金额（最多两位小数）。', 'Enter a valid date and positive amount (up to two decimal places).')); return }
    setError('')
    if (store.save([{ id: newId(), kind, cents, note: note.trim(), date }, ...store.items])) { setAmount(''); setNote('') }
  }
  return <><LocalNotice copy={copy} />{store.notice}<div className="desktop-totals"><div>{copy('总收入', 'Income')}<strong>{money(income)}</strong></div><div>{copy('总支出', 'Expenses')}<strong>{money(expense)}</strong></div><div>{copy('结余', 'Balance')}<strong>{money(income - expense)}</strong></div></div>
    <form className="desktop-form" onSubmit={add}><fieldset disabled={store.blocked}><label>{copy('收支类型', 'Entry type')}<select value={kind} onChange={event => setKind(event.target.value as 'income' | 'expense')}><option value="expense">{copy('支出', 'Expense')}</option><option value="income">{copy('收入', 'Income')}</option></select></label><label>{copy('金额（元）', 'Amount (CNY)')}<input type="number" inputMode="decimal" min="0.01" max="1000000000" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} /></label><label>{copy('日期', 'Date')}<input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label><label>{copy('备注', 'Note')}<input maxLength={200} value={note} onChange={event => setNote(event.target.value)} /></label><button className="desktop-primary" type="submit">{copy('添加记录', 'Add entry')}</button></fieldset></form>{error && <p role="alert" className="desktop-error">{error}</p>}
    <ul className="desktop-list">{store.items.map(item => <li key={item.id}><div><strong>{item.note || copy(item.kind === 'income' ? '收入' : '支出', item.kind === 'income' ? 'Income' : 'Expense')}</strong><small>{item.date} · {copy(item.kind === 'income' ? '收入' : '支出', item.kind === 'income' ? 'Income' : 'Expense')}</small></div><b className={item.kind === 'income' ? 'desktop-positive' : ''}>{item.kind === 'income' ? '+' : '−'}{money(item.cents)}</b><button type="button" aria-label={copy(`删除记录：${item.note || item.date}`, `Delete entry: ${item.note || item.date}`)} disabled={store.blocked} onClick={() => store.save(store.items.filter(row => row.id !== item.id))}>{copy('删除', 'Delete')}</button></li>)}</ul>{!store.items.length && !store.blocked && <p className="desktop-empty">{copy('还没有记录，记下第一笔吧。', 'No entries yet. Add your first one.')}</p>}</>
}

type Contact = { id: string; name: string; phone: string; email: string }
function Contacts({ copy }: { copy: Copy }) {
  const store = useLocalItems<Contact>('aily-desktop-contacts', value => baseValid(value) && typeof value.name === 'string' && typeof value.phone === 'string' && typeof value.email === 'string', copy)
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [email, setEmail] = useState('')
  const add = (event: FormEvent) => { event.preventDefault(); if (!name.trim()) return; if (store.save([{ id: newId(), name: name.trim(), phone: phone.trim(), email: email.trim() }, ...store.items])) { setName(''); setPhone(''); setEmail('') } }
  return <><LocalNotice copy={copy} /><p className="desktop-note">{copy('这是你手动建立的通讯录，不会读取手机或系统联系人。', 'This is your manually created address book. It does not access phone or system contacts.')}</p>{store.notice}<form className="desktop-form" onSubmit={add}><fieldset disabled={store.blocked}><label>{copy('姓名', 'Name')}<input required maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label><label>{copy('电话', 'Phone')}<input type="tel" maxLength={60} value={phone} onChange={event => setPhone(event.target.value)} /></label><label>{copy('邮箱', 'Email')}<input type="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></label><button type="submit" className="desktop-primary">{copy('添加联系人', 'Add contact')}</button></fieldset></form><ul className="desktop-list">{store.items.map(item => <li key={item.id}><div><strong>{item.name}</strong>{item.phone && <small>{item.phone}</small>}{item.email && <small>{item.email}</small>}</div><button type="button" aria-label={copy(`删除联系人：${item.name}`, `Delete contact: ${item.name}`)} disabled={store.blocked} onClick={() => store.save(store.items.filter(row => row.id !== item.id))}>{copy('删除', 'Delete')}</button></li>)}</ul>{!store.items.length && !store.blocked && <p className="desktop-empty">{copy('还没有联系人。', 'No contacts yet.')}</p>}</>
}

type DiaryEntry = { id: string; date: string; text: string }
function Diary({ copy }: { copy: Copy }) {
  const store = useLocalItems<DiaryEntry>('aily-desktop-diary', value => baseValid(value) && validDate(value.date) && typeof value.text === 'string', copy)
  const [date, setDate] = useState(today), [text, setText] = useState('')
  const add = (event: FormEvent) => { event.preventDefault(); if (!text.trim() || !validDate(date)) return; if (store.save([{ id: newId(), date, text: text.trim() }, ...store.items])) setText('') }
  return <><LocalNotice copy={copy} />{store.notice}<form className="desktop-form" onSubmit={add}><fieldset disabled={store.blocked}><label>{copy('日记日期', 'Diary date')}<input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label><label className="desktop-wide">{copy('今天想记下什么', 'What would you like to remember?')}<textarea required rows={5} maxLength={10000} value={text} onChange={event => setText(event.target.value)} /></label><button type="submit" className="desktop-primary">{copy('保存日记', 'Save diary entry')}</button></fieldset></form><ul className="desktop-list desktop-diary-list">{store.items.map(item => <li key={item.id}><div><strong>{item.date}</strong><p>{item.text}</p></div><button type="button" aria-label={copy(`删除日记：${item.date}`, `Delete diary entry: ${item.date}`)} disabled={store.blocked} onClick={() => store.save(store.items.filter(row => row.id !== item.id))}>{copy('删除', 'Delete')}</button></li>)}</ul>{!store.items.length && !store.blocked && <p className="desktop-empty">{copy('还没有日记。留一点今天的痕迹。', 'No diary entries yet. Save a little of today.')}</p>}</>
}

type MediaItem = { id: string; name: string; url: string }
function LocalMedia({ kind, copy }: { kind: 'album' | 'music'; copy: Copy }) {
  const [items, setItems] = useState<MediaItem[]>([]), [error, setError] = useState('')
  const urls = useRef(new Set<string>())
  useEffect(() => () => { urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current.clear() }, [])
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []), added: MediaItem[] = []
    let rejected = false
    files.forEach(file => {
      if (!file.type.startsWith(kind === 'album' ? 'image/' : 'audio/')) { rejected = true; return }
      try { const url = URL.createObjectURL(file); urls.current.add(url); added.push({ id: newId(), name: file.name, url }) } catch { rejected = true }
    })
    setItems(previous => [...previous, ...added])
    setError(rejected ? copy('部分文件无法打开，请选择有效的图片或音频文件。', 'Some files could not be opened. Choose valid image or audio files.') : '')
    event.target.value = ''
  }
  const remove = (item: MediaItem) => { URL.revokeObjectURL(item.url); urls.current.delete(item.url); setItems(previous => previous.filter(row => row.id !== item.id)) }
  return <><p className="desktop-note">{copy('选择你自己的本地文件，不上传、不永久保存。关闭此工具或切换工具后需重新选择。', 'Choose your own local files. Nothing is uploaded or permanently saved. Re-select files after closing or switching tools.')}</p><label className="desktop-file-label">{copy(kind === 'album' ? '选择图片' : '选择音频', kind === 'album' ? 'Choose images' : 'Choose audio')}<input type="file" multiple accept={kind === 'album' ? 'image/*' : 'audio/*'} onChange={choose} /></label>{error && <p role="alert" className="desktop-error">{error}</p>}<div className={kind === 'album' ? 'desktop-album-grid' : 'desktop-music-list'}>{items.map(item => <article key={item.id}>{kind === 'album' ? <img src={item.url} alt={item.name} onError={() => setError(copy('图片预览失败，文件可能损坏或格式不支持。', 'Image preview failed; the file may be damaged or unsupported.'))} /> : <audio controls preload="metadata" src={item.url} aria-label={item.name} onError={() => setError(copy('音频播放失败，文件可能损坏或格式不支持。', 'Audio playback failed; the file may be damaged or unsupported.'))} />}<div><span>{item.name}</span><button type="button" aria-label={copy(`移除：${item.name}`, `Remove: ${item.name}`)} onClick={() => remove(item)}>{copy('移除', 'Remove')}</button></div></article>)}</div>{!items.length && <p className="desktop-empty">{copy(kind === 'album' ? '没有预置照片，选择图片后即可预览。' : '没有预置歌曲，选择音频后即可播放。', kind === 'album' ? 'No sample photos. Choose an image to preview it.' : 'No sample tracks. Choose audio to play it.')}</p>}</>
}

// Earlier-heaven numbering: 乾1、兑2、离3、震4、巽5、坎6、艮7、坤8.
// Bits run from the bottom line upward; 1 = yang, 0 = yin.
const trigrams = [{ name: '乾', symbol: '☰', bits: 7 }, { name: '兑', symbol: '☱', bits: 3 }, { name: '离', symbol: '☲', bits: 5 }, { name: '震', symbol: '☳', bits: 1 }, { name: '巽', symbol: '☴', bits: 6 }, { name: '坎', symbol: '☵', bits: 2 }, { name: '艮', symbol: '☶', bits: 4 }, { name: '坤', symbol: '☷', bits: 0 }]
const hexagramNames = [['乾', '履', '同人', '无妄', '姤', '讼', '遁', '否'], ['夬', '兑', '革', '随', '大过', '困', '咸', '萃'], ['大有', '睽', '离', '噬嗑', '鼎', '未济', '旅', '晋'], ['大壮', '归妹', '丰', '震', '恒', '解', '小过', '豫'], ['小畜', '中孚', '家人', '益', '巽', '涣', '渐', '观'], ['需', '节', '既济', '屯', '井', '坎', '蹇', '比'], ['大畜', '损', '贲', '颐', '蛊', '蒙', '艮', '剥'], ['泰', '临', '明夷', '复', '升', '师', '谦', '坤']]
export function calculatePlumBlossom(first: number, second: number, movingSeed = first + second) {
  if (![first, second, movingSeed].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Positive safe integers required')
  const upperIndex = (first - 1) % 8, lowerIndex = (second - 1) % 8, movingLine = (movingSeed - 1) % 6 + 1
  const bits = trigrams[lowerIndex].bits | (trigrams[upperIndex].bits << 3), changedBits = bits ^ (1 << (movingLine - 1))
  const changedUpper = trigrams.findIndex(trigram => trigram.bits === (changedBits >> 3)), changedLower = trigrams.findIndex(trigram => trigram.bits === (changedBits & 7))
  return { upper: trigrams[upperIndex], lower: trigrams[lowerIndex], movingLine, name: hexagramNames[upperIndex][lowerIndex], changedName: hexagramNames[changedUpper][changedLower], bits }
}
function Divination({ copy }: { copy: Copy }) {
  const [mode, setMode] = useState<'number' | 'time'>('number'), [first, setFirst] = useState('1'), [second, setSecond] = useState('1'), [time, setTime] = useState(`${today()}T12:00`)
  const [result, setResult] = useState<ReturnType<typeof calculatePlumBlossom> | null>(null), [error, setError] = useState(''), [method, setMethod] = useState('')
  const calculate = (event: FormEvent) => {
    event.preventDefault()
    try {
      if (mode === 'number') { const a = Number(first), b = Number(second); if (a > 1000000000 || b > 1000000000) throw new Error('Out of range'); setResult(calculatePlumBlossom(a, b)); setMethod(copy(`上卦取 ${a} 除以8余数，下卦取 ${b} 除以8余数；动爻取两数之和除以6余数（余0取8或6）。`, `Upper: ${a} modulo 8; lower: ${b} modulo 8; moving line: sum modulo 6 (zero means 8 or 6).`)) }
      else {
        const date = new Date(time); if (!time || !Number.isFinite(date.getTime())) throw new Error('Invalid date')
        const sum = date.getFullYear() + date.getMonth() + 1 + date.getDate(), hourBranch = Math.floor((date.getHours() + 1) / 2) % 12 + 1
        setResult(calculatePlumBlossom(sum, sum + hourBranch, sum + hourBranch)); setMethod(copy(`公历时间简化法（非农历法），使用设备本地时区：年月日之和 ${sum} 取上卦，加时辰序数 ${hourBranch} 取下卦与动爻；分别除以8、8、6取余。`, `Simplified Gregorian method (not lunar), in the device's local timezone: year + month + day = ${sum} for upper; add double-hour index ${hourBranch} for lower and moving line; modulo 8, 8, 6.`))
      }
      setError('')
    } catch { setError(copy('请输入1至10亿的整数，或有效本地日期时间。', 'Enter integers from 1 to one billion, or a valid local date and time.')); setResult(null) }
  }
  return <><p className="desktop-entertainment">{copy('传统文化体验 · 仅供娱乐。不是预测，不提供财务、投资或健康建议，不应用于重要决策。', 'Traditional cultural recreation · Entertainment only. Not a prediction; no financial, investment or health advice. Do not use for important decisions.')}</p><form className="desktop-form" onSubmit={calculate}><fieldset><label>{copy('起卦方式', 'Method')}<select value={mode} onChange={event => { setMode(event.target.value as 'number' | 'time'); setResult(null) }}><option value="number">{copy('数字起卦', 'Two-number method')}</option><option value="time">{copy('公历时间简化起卦', 'Simplified Gregorian time')}</option></select></label>{mode === 'number' ? <><label>{copy('第一个数', 'First number')}<input type="number" min="1" max="1000000000" step="1" required value={first} onChange={event => setFirst(event.target.value)} /></label><label>{copy('第二个数', 'Second number')}<input type="number" min="1" max="1000000000" step="1" required value={second} onChange={event => setSecond(event.target.value)} /></label></> : <label>{copy('本地日期时间', 'Local date and time')}<input type="datetime-local" required value={time} onChange={event => setTime(event.target.value)} /></label>}<button type="submit" className="desktop-primary">{copy('起卦', 'Calculate hexagram')}</button></fieldset></form>{error && <p role="alert" className="desktop-error">{error}</p>}{result && <div className="desktop-divination-result" aria-live="polite"><h3>{copy('本卦', 'Original hexagram')} · {result.name}</h3><p>{copy('上卦', 'Upper trigram')}：{result.upper.symbol} {result.upper.name} · {copy('下卦', 'Lower trigram')}：{result.lower.symbol} {result.lower.name}</p><div className="desktop-hexagram" aria-label={copy('六爻自下而上编号', 'Six lines numbered from bottom to top')}>{[5, 4, 3, 2, 1, 0].map(line => <div key={line} className={result.movingLine === line + 1 ? 'moving' : ''}><span>{line + 1}</span><b>{result.bits & (1 << line) ? '━━━━━━' : '━━  ━━'}</b>{result.movingLine === line + 1 && <small>{copy('动爻', 'Moving')}</small>}</div>)}</div><p>{copy('动爻', 'Moving line')}：{result.movingLine}（{copy('自下往上数', 'counted from bottom')}） · {copy('变卦', 'Changed hexagram')}：{result.changedName}</p><p className="desktop-note">{method}</p><p className="desktop-note">{copy('采用先天八卦序：乾1、兑2、离3、震4、巽5、坎6、艮7、坤8。动爻阴阳翻转形成变卦；相同输入得到相同结果。', 'Earlier-heaven order: 乾1, 兑2, 离3, 震4, 巽5, 坎6, 艮7, 坤8. The moving line flips yin/yang to form the changed hexagram. Identical inputs give identical results.')}</p></div>}</>
}
