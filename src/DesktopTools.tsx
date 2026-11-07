import { useEffect, useId, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Camera, MediaTypeSelection } from '@capacitor/camera'
import { Capacitor } from '@capacitor/core'
import { useI18n } from './i18n'
import { interpretDivination } from './chatService'
import ExtensionStore, { ExtensionAppView } from './ExtensionStore'
import { extensionApps, type ExtensionAppId } from './extensionApps'
import './desktopTools.css'
import MediaLibraryApp from './MediaLibraryApp'
import ContactsApp from './ContactsApp'
import LedgerApp from './LedgerApp'
import DiaryApp from './DiaryApp'
import PhotoOrganizerApp from './PhotoOrganizerApp'

export type DesktopTool = 'ledger' | 'album' | 'contacts' | 'music' | 'diary' | 'divination' | 'app-store' | ExtensionAppId
type Copy = (zh: string, en: string) => string
const titles: Partial<Record<DesktopTool, [string, string]>> = { ledger: ['记账', 'Ledger'], album: ['相册', 'Album'], contacts: ['通讯录', 'Contacts'], music: ['音乐', 'Music'], diary: ['日记', 'Diary'], divination: ['易之书 · 梅花易数', 'Yizhishu Divination'], 'app-store':['应用商店','App Store'], 'photo-organizer':['相册整理','Photo Organizer'], 'laughter-collector':['笑声收集器','Laughter Collector'], 'meal-planner':['吃什么','What to Eat'], 'focus-timer':['专注时钟','Focus Timer'], 'skincare-diary':['护肤日记','Skincare Diary'], wardrobe:['穿搭衣橱','Wardrobe'], anniversary:['纪念日助手','Anniversary'], gomoku:['五子棋','Gomoku'], 'game-2048':['2048','2048'] }
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

export default function DesktopTools({ tool, onClose, modelConfig, onOpenTool }: { tool: DesktopTool; onClose: () => void; modelConfig?: { apiKey: string; endpoint: string; model: string }; onOpenTool?: (tool: DesktopTool) => void }) {
  const { locale } = useI18n()
  const copy: Copy = (zh, en) => locale === 'en' ? en : zh
  const titleId = useId()
  const registeredApp = extensionApps.find(app => app.id === tool)
  const title: [string, string] = titles[tool] || (registeredApp ? [registeredApp.name, registeredApp.english] : ['应用暂不可用', 'App unavailable'])
  const dialog = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose); closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const node = dialog.current
    node?.focus()
    const focusable = () => Array.from((node?.querySelector<HTMLElement>('.media-photo-viewer, .organizer-expanded, .organizer-delete-confirm') || node)?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), audio[controls], a[href], [tabindex="0"]') ?? []).filter(element => !element.closest('[hidden]') && element.getAttribute('tabindex') !== '-1')
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { if (node?.querySelector('.media-photo-viewer, .organizer-expanded, .organizer-delete-confirm')) return; event.preventDefault(); event.stopPropagation(); closeRef.current(); return }
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
  return createPortal(<div className="desktop-tools-overlay"><section ref={dialog} className={`desktop-tools-dialog tools-surface${tool === 'photo-organizer' ? ' photo-organizer-shell' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
    <header className="desktop-tools-header" hidden={tool === 'photo-organizer'}><button type="button" className="desktop-close" onClick={onClose} aria-label={copy('返回', 'Back')}>{'<'}</button><div><h2 id={titleId}>{copy(...title)}</h2></div></header>
    <div className="desktop-tools-content" key={tool}>{tool === 'ledger' ? <LedgerApp copy={copy} /> : tool === 'contacts' ? <ContactsApp locale={locale} /> : tool === 'diary' ? <DiaryApp copy={copy} /> : tool === 'album' ? <MediaLibraryApp kind="album" copy={copy} /> : tool === 'music' ? <MediaLibraryApp kind="music" copy={copy} /> : tool === 'divination' ? <Divination copy={copy} modelConfig={modelConfig} /> : tool === 'photo-organizer' ? <PhotoOrganizerApp locale={locale} onClose={onClose} /> : tool === 'app-store' ? <ExtensionStore locale={locale} openApp={id=>onOpenTool?.(id)} /> : <ExtensionAppView id={tool as ExtensionAppId} locale={locale} />}</div>
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
  const choosePhotos = async () => {
    setError('')
    try {
      const result = await Camera.chooseFromGallery({ mediaType: MediaTypeSelection.Photo, allowMultipleSelection: true, limit: 20 })
      const selected = result.results.flatMap((media, index) => media.webPath ? [{ id: newId(), name: copy(`照片 ${index + 1}`, `Photo ${index + 1}`), url: media.webPath }] : [])
      if (!selected.length) { setError(copy('没有读取到可用照片，请重新选择。', 'No usable photos were selected. Please try again.')); return }
      setItems(previous => [...previous, ...selected])
    } catch { setError(copy('无法打开系统相册。请允许照片访问后重试。', 'Unable to open Photos. Allow photo access and try again.')) }
  }
  const remove = (item: MediaItem) => { if (urls.current.has(item.url)) URL.revokeObjectURL(item.url); urls.current.delete(item.url); setItems(previous => previous.filter(row => row.id !== item.id)) }
  const nativeAlbum = kind === 'album' && Capacitor.isNativePlatform()
  const note = nativeAlbum
    ? copy('从系统相册选择照片，仅用于本次预览；不上传、不永久保存。', 'Choose photos from your system library for this preview only. Nothing is uploaded or permanently saved.')
    : copy(kind === 'music' ? '从“文件”中选择可播放的本地音频，不上传、不永久保存。Apple Music 受保护歌曲不能作为文件读取。' : '选择你自己的本地文件，不上传、不永久保存。关闭此工具或切换工具后需重新选择。', kind === 'music' ? 'Choose playable local audio from Files. Protected Apple Music songs cannot be read as files.' : 'Choose your own local files. Nothing is uploaded or permanently saved. Re-select files after closing or switching tools.')
  return <><p className="desktop-note">{note}</p>{nativeAlbum ? <button type="button" className="desktop-file-label" onClick={() => void choosePhotos()}>{copy('从系统相册选择', 'Choose from Photos')}</button> : <label className="desktop-file-label">{copy(kind === 'album' ? '选择图片' : '选择音频', kind === 'album' ? 'Choose images' : 'Choose audio from Files')}<input type="file" multiple accept={kind === 'album' ? 'image/*' : 'audio/*'} onChange={choose} /></label>}{error && <p role="alert" className="desktop-error">{error}</p>}<div className={kind === 'album' ? 'desktop-album-grid' : 'desktop-music-list'}>{items.map(item => <article key={item.id}>{kind === 'album' ? <img src={item.url} alt={item.name} onError={() => setError(copy('图片预览失败，文件可能损坏或格式不支持。', 'Image preview failed; the file may be damaged or unsupported.'))} /> : <audio controls preload="metadata" src={item.url} aria-label={item.name} onError={() => setError(copy('音频播放失败，文件可能损坏或格式不支持。', 'Audio playback failed; the file may be damaged or unsupported.'))} />}<div><span>{item.name}</span><button type="button" aria-label={copy(`移除：${item.name}`, `Remove: ${item.name}`)} onClick={() => remove(item)}>{copy('移除', 'Remove')}</button></div></article>)}</div>{!items.length && <p className="desktop-empty">{copy(kind === 'album' ? '尚未选择照片。' : '尚未选择音频文件。', kind === 'album' ? 'No photos selected yet.' : 'No audio files selected yet.')}</p>}</>
}

// Retained for backward-compatible local data/tests; the UI below uses the Yizhishu skill contract.
const legacyTrigrams = [{ name: '乾', symbol: '☰', bits: 7 }, { name: '兑', symbol: '☱', bits: 3 }, { name: '离', symbol: '☲', bits: 5 }, { name: '震', symbol: '☳', bits: 1 }, { name: '巽', symbol: '☴', bits: 6 }, { name: '坎', symbol: '☵', bits: 2 }, { name: '艮', symbol: '☶', bits: 4 }, { name: '坤', symbol: '☷', bits: 0 }]
const legacyNames = [['乾', '履', '同人', '无妄', '姤', '讼', '遁', '否'], ['夬', '兑', '革', '随', '大过', '困', '咸', '萃'], ['大有', '睽', '离', '噬嗑', '鼎', '未济', '旅', '晋'], ['大壮', '归妹', '丰', '震', '恒', '解', '小过', '豫'], ['小畜', '中孚', '家人', '益', '巽', '涣', '渐', '观'], ['需', '节', '既济', '屯', '井', '坎', '蹇', '比'], ['大畜', '损', '贲', '颐', '蛊', '蒙', '艮', '剥'], ['泰', '临', '明夷', '复', '升', '师', '谦', '坤']]
export function calculatePlumBlossom(first: number, second: number, movingSeed = first + second) {
  if (![first, second, movingSeed].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Positive safe integers required')
  const upperIndex = (first - 1) % 8, lowerIndex = (second - 1) % 8, movingLine = (movingSeed - 1) % 6 + 1
  const bits = legacyTrigrams[lowerIndex].bits | (legacyTrigrams[upperIndex].bits << 3), changedBits = bits ^ (1 << (movingLine - 1))
  const changedUpper = legacyTrigrams.findIndex(trigram => trigram.bits === (changedBits >> 3)), changedLower = legacyTrigrams.findIndex(trigram => trigram.bits === (changedBits & 7))
  return { upper: legacyTrigrams[upperIndex], lower: legacyTrigrams[lowerIndex], movingLine, name: legacyNames[upperIndex][lowerIndex], changedName: legacyNames[changedUpper][changedLower], bits }
}

// Implements the yizhishu-divination skill contract. Every cast generates fresh random numbers.
const guaMap = ['111', '110', '101', '100', '011', '010', '001', '000'] as const
const guaNames = [
  '坤为地', '山地剥', '水地比', '风地观', '雷地豫', '火地晋', '泽地萃', '天地否',
  '地山谦', '艮为山', '水山蹇', '风山渐', '雷山小过', '火山旅', '泽山咸', '天山遁',
  '地水师', '山水蒙', '坎为水', '风水涣', '雷水解', '火水未济', '泽水困', '天水讼',
  '地风升', '山风蛊', '水风井', '巽为风', '雷风恒', '火风鼎', '泽风大过', '天风姤',
  '地雷复', '山雷颐', '水雷屯', '风雷益', '震为雷', '火雷噬嗑', '泽雷随', '天雷无妄',
  '地火明夷', '山火贲', '水火既济', '风火家人', '雷火丰', '离为火', '泽火革', '天火同人',
  '地泽临', '山泽损', '水泽节', '风泽中孚', '雷泽归妹', '火泽睽', '兑为泽', '天泽履',
  '地天泰', '山天大畜', '水天需', '风天小畜', '雷天大壮', '火天大有', '泽天夬', '乾为天',
] as const
const guaThemes = [
  '顺势承载，重在包容与积累','旧结构正在剥落，宜先稳住根基','寻求同伴与协作，也要辨别关系','先观察全局，再决定是否行动','借势而动，但避免过度乐观','逐步显现成果，保持清醒','资源汇聚，重在共同目标','沟通受阻，宜减少对抗',
  '保持谦逊，循序推进','适合止步审视，守住边界','前路有阻，绕行胜于硬闯','渐进最稳，不求立刻见效','小事可成，大事宜谨慎','处于过渡阶段，轻装前行','相互感应，真诚沟通','适时退让，以保存力量',
  '需要组织与纪律，先明确规则','信息不足，先学习再判断','面对反复与不确定，守住节奏','分散后重新连接，化解隔阂','困难开始松动，把握出口','事情未完，最后阶段仍需谨慎','受限之中寻找可用资源','争议明显，宜求证并止争',
  '稳步上升，靠长期积累','处理积弊，先修复根本','资源有限但可持续滋养','顺势而入，保持柔韧','关系或计划贵在持久','更新结构，调和不同要素','压力较大，避免过度负担','新机会突然出现，先辨风险',
  '重新开始，从小处恢复','重视养护与输入，注意长期习惯','起步艰难，先建立秩序','投入可带来增益，也要互惠','行动力强，避免急躁','需要明确规则与代价','跟随变化，但别失去判断','减少妄动，以真实为准',
  '光明暂受遮蔽，低调保护自己','外在改善之外也要充实内在','阶段完成，注意维护成果','经营内部关系，明确分工','能量旺盛，防止情绪过热','保持清晰与洞察，也防消耗','变革时机出现，先取得共识','寻找共同点，公开沟通',
  '主动靠近机会，但要保持边界','做减法，交换更重要的价值','节制资源，建立可持续规则','以内在诚信建立连接','关系节奏不一致，慎重承诺','差异明显，求同存异','通过交流获得愉悦，避免讨好','谨慎履行，每一步都要稳',
  '上下通达，适合合作推进','蓄积实力，等待成熟时机','耐心等待条件齐备','小步积累，柔性推进','力量增强，切勿逞强','资源充足，懂得分享与节制','需要果断处理，但避免过激','主动创造，持续行动',
] as const
function secureRandom(min: number, max: number) {
  const range = max - min + 1
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return min + values[0] % range
}
function guaIndex(bits: string) { return Number.parseInt([...bits].reverse().join(''), 2) }
function guaName(bits: string) { return guaNames[guaIndex(bits)] }
function guaTheme(bits: string) { return guaThemes[guaIndex(bits)] }
export function castYizhishuDivination() {
  const firstRaw = secureRandom(1, 10000), secondRaw = secureRandom(1, 9999)
  const key0 = firstRaw % 8, key1 = secondRaw % 8, key2 = (key0 + key1) % 6
  const bengua = guaMap[key0] + guaMap[key1]
  const hugua = bengua.slice(1, 4) + bengua.slice(2, 5)
  const biangua = bengua.slice(0, key2) + (bengua[key2] === '0' ? '1' : '0') + bengua.slice(key2 + 1)
  return { key0, key1, key2, bengua, hugua, biangua, bengua_name: guaName(bengua), hugua_name: guaName(hugua), biangua_name: guaName(biangua) }
}
function Divination({ copy, modelConfig }: { copy: Copy; modelConfig?: { apiKey: string; endpoint: string; model: string } }) {
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState<ReturnType<typeof castYizhishuDivination> | null>(null)
  const [modelReading, setModelReading] = useState(''), [modelError, setModelError] = useState(''), [interpreting, setInterpreting] = useState(false)
  const generate = async () => {
    const next = castYizhishuDivination(); setResult(next); setModelReading(''); setModelError('')
    if (!modelConfig?.apiKey) { setModelError(copy('请先在“我的 → DeepSeek 连接”配置模型网关，当前仅显示本机基础解读。','Configure a model gateway under Profile → DeepSeek connection. Showing local interpretation only.')); return }
    setInterpreting(true)
    try { setModelReading(await interpretDivination({ ...modelConfig, question: question.trim(), original: next.bengua_name, nuclear: next.hugua_name, changed: next.biangua_name, movingLine: 6-next.key2 })) }
    catch (error) { setModelError(error instanceof Error ? error.message : copy('模型解卦失败，请重试','Model interpretation failed. Try again.')) }
    finally { setInterpreting(false) }
  }
  const cast = (event: FormEvent) => { event.preventDefault(); void generate() }
  return <><form className="desktop-form" onSubmit={cast}><fieldset><label className="desktop-wide">{copy('想问的事情（可选）', 'Your question (optional)')}<textarea maxLength={300} value={question} onChange={event => setQuestion(event.target.value)} placeholder={copy('静下心来，写下你此刻想问的事', 'Write what is on your mind')} /></label><button type="submit" className="desktop-primary desktop-wide">{copy('随机起卦', 'Cast randomly')}</button></fieldset></form>{result && <div className="desktop-divination-result" aria-live="polite">{question.trim() && <p><strong>{copy('所问', 'Question')}：</strong>{question.trim()}</p>}<HexagramSet result={result} copy={copy}/><DivinationInterpretation result={result} question={question} copy={copy}/>{interpreting&&<p className="desktop-note" role="status">{copy('模型正在结合所问解卦…','The model is interpreting the cast…')}</p>}{modelError&&<p className="desktop-error" role="alert">{modelError}</p>}{modelReading&&<section className="desktop-model-reading"><h4>{copy('模型解卦','Model interpretation')}</h4><p>{modelReading}</p></section>}<p className="desktop-note">{copy(`动爻：第 ${6 - result.key2} 爻`, `Moving line: ${6 - result.key2}`)}</p><button type="button" disabled={interpreting} onClick={() => void generate()}>{interpreting ? copy('正在解卦…','Interpreting…') : copy('重新随机起卦', 'Cast again')}</button></div>}</>
}
function HexagramSet({ result, copy }: { result: ReturnType<typeof castYizhishuDivination>; copy: Copy }) {
  const items = [
    { label: copy('本卦','Original'), name: result.bengua_name, bits: result.bengua, moving: result.key2 },
    { label: copy('互卦','Nuclear'), name: result.hugua_name, bits: result.hugua, moving: -1 },
    { label: copy('变卦','Changed'), name: result.biangua_name, bits: result.biangua, moving: -1 },
  ]
  return <div className="desktop-hexagram-set">{items.map(item=><section key={item.label}><small>{item.label}</small><h3>{item.name}</h3><Hexagram bits={item.bits} moving={item.moving} copy={copy}/></section>)}</div>
}
function DivinationInterpretation({ result, question, copy }: { result: ReturnType<typeof castYizhishuDivination>; question: string; copy: Copy }) {
  const stages = ['事情刚起步，先观察和准备','基础逐渐形成，适合小步尝试','进入关键推进期，注意及时调整','外部影响增强，需要协调关系','接近结果，避免因急躁失衡','一个阶段将结束，重点是复盘与转化']
  return <section className="desktop-divination-reading"><h4>{copy('卦象解读','Interpretation')}</h4><p><strong>{copy('当前处境','Current situation')}：</strong>{result.bengua_name}提示“{guaTheme(result.bengua)}”。</p><p><strong>{copy('内在因素','Underlying influence')}：</strong>{result.hugua_name}反映“{guaTheme(result.hugua)}”。</p><p><strong>{copy('变化方向','Direction of change')}：</strong>{result.biangua_name}指向“{guaTheme(result.biangua)}”。</p><p><strong>{copy('动爻提示','Moving-line note')}：</strong>第{6-result.key2}爻，{stages[5-result.key2]}。</p>{question.trim()&&<p><strong>{copy('结合所问','For your question')}：</strong>可以先从“{guaTheme(result.bengua)}”着手，同时留意事情可能转向“{guaTheme(result.biangua)}”。这是一种反思角度，不代表确定结果。</p>}</section>
}
function Hexagram({ bits, moving, copy }: { bits: string; moving: number; copy: Copy }) {
  return <div className="desktop-hexagram" aria-label={copy('六爻自下而上编号', 'Six lines numbered from bottom to top')}>{[0,1,2,3,4,5].map(line=><div key={line} className={moving===line?'moving':''}><span>{6-line}</span><b className={`hexagram-line ${bits[line] === '1' ? 'yang' : 'yin'}`} aria-label={bits[line] === '1' ? copy('阳爻','Yang line') : copy('阴爻','Yin line')}><i/><i/></b>{moving===line&&<small>{copy('动爻','Moving')}</small>}</div>)}</div>
}
