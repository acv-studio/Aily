import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, BarChart3, CalendarDays, ChevronLeft, ChevronRight, CircleUserRound, Eye, EyeOff, FileText, MoreHorizontal, Plus, Search, Settings2, Tags, Trash2, Wallet, X, Pencil, Utensils, Bus, ShoppingBag, House, Heart, GraduationCap, Gift, Banknote, Coffee, CircleEllipsis } from 'lucide-react'
import { buildLedgerChart, chartRatio, groupLedgerDays } from './ledgerAnalytics'
import { isPersonalDate, isPersonalMonth, isPersonalRecord, localToday, personalToolId, PersonalJsonExport, PersonalLocalNotice, PersonalStoreNotice, shiftPersonalMonth, usePersonalItems } from './personalToolsStorage'
import type { PersonalToolCopy } from './personalToolsStorage'
import './ledgerReference.css'

export type LedgerEntry = { id: string; kind: 'income' | 'expense'; cents: number; note: string; date: string; category?: string }
export const LEDGER_STORAGE_KEY = 'aily-desktop-ledger'
// Stable IDs are independent of locale. Unknown existing string categories are
// retained and surfaced as custom options, never silently mapped or removed.
export const ledgerCategories = [
  { id: 'food', zh: '餐饮', en: 'Food' }, { id: 'transport', zh: '交通', en: 'Transport' },
  { id: 'shopping', zh: '购物', en: 'Shopping' }, { id: 'home', zh: '居家', en: 'Home' },
  { id: 'leisure', zh: '休闲', en: 'Leisure' }, { id: 'health', zh: '健康', en: 'Health' },
  { id: 'education', zh: '学习', en: 'Education' }, { id: 'salary', zh: '工资', en: 'Salary & wages' },
  { id: 'gift', zh: '礼物', en: 'Gifts' }, { id: 'other', zh: '其他', en: 'Other' },
] as const
export const isLedgerEntry = (value: unknown): value is LedgerEntry => isPersonalRecord(value) && typeof value.id === 'string' && (value.kind === 'income' || value.kind === 'expense') && Number.isSafeInteger(value.cents) && Number(value.cents) > 0 && typeof value.note === 'string' && isPersonalDate(value.date) && (value.category === undefined || typeof value.category === 'string')
// Exact cent arithmetic also supports legacy amounts larger than the new-entry limit.
export function ledgerMoney(cents: bigint | number) {
  const value = BigInt(cents), negative = value < 0n, absolute = negative ? -value : value
  return `${negative ? '−' : ''}¥${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`
}
export function parseLedgerCents(amount: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || amount.length > 24) return null
  const [whole, fraction = ''] = amount.split('.')
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return cents > 0n && cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null
}
export function ledgerTotals(items: LedgerEntry[]) {
  let income = 0n, expense = 0n
  for (const item of items) { if (item.kind === 'income') income += BigInt(item.cents); else expense += BigInt(item.cents) }
  return { income, expense, balance: income - expense }
}

type BudgetRow = { id: string; cents: number }
const BUDGET_STORAGE_KEY = 'aily.ledger-budgets.v1'
const isBudgetRow = (value: unknown): value is BudgetRow => isPersonalRecord(value) && typeof value.id === 'string' && isPersonalMonth(value.id) && Number.isSafeInteger(value.cents) && Number(value.cents) >= 0
const categoryIcons = { food: Utensils, transport: Bus, shopping: ShoppingBag, home: House, leisure: Coffee, health: Heart, education: GraduationCap, salary: Banknote, gift: Gift, other: CircleEllipsis }
function CategoryIcon({ category }: { category?: string }) {
  const Icon = categoryIcons[category as keyof typeof categoryIcons] ?? CircleEllipsis
  return <Icon size={21} strokeWidth={1.7} aria-hidden="true" />
}

function LedgerBudget({ month, expense, copy, money }: { month: string; expense: bigint; copy: PersonalToolCopy; money: (cents: bigint | number) => string }) {
  const store = usePersonalItems(BUDGET_STORAGE_KEY, isBudgetRow)
  const initial = store.items.find(item => item.id === month)
  const [draft, setDraft] = useState(() => initial ? ledgerMoney(initial.cents).slice(1) : '')
  const [error, setError] = useState(''), [saved, setSaved] = useState(false)
  const budget = store.items.find(item => item.id === month)
  const budgetCents = BigInt(budget?.cents ?? 0), over = !!budget && expense > budgetCents
  const submit = (event: FormEvent) => {
    event.preventDefault(); setSaved(false)
    const cents = draft.length <= 24 && /^0+(?:\.0{1,2})?$/.test(draft) ? 0 : parseLedgerCents(draft)
    if (cents === null) { setError(copy('请输入有效预算（可为零），最多两位小数。', 'Enter a valid budget (zero is allowed) with up to two decimal places.')); return }
    if (store.save([...store.items.filter(item => item.id !== month), { id: month, cents }])) { setError(''); setSaved(true) }
  }
  return <section className="ledger-card ledger-budget"><span className="ledger-eyebrow">{copy('每月计划 · 本地保存', 'MONTHLY PLAN · LOCAL ONLY')}</span><h2>{copy('给生活留一点余地', 'Make room for everyday life')}</h2><p className="ledger-muted">{copy(`${month} 的支出预算，不连接银行、不收费。`, `Expense budget for ${month}. No bank connection or fees.`)}</p>
    <PersonalStoreNotice store={store} copy={copy} />
    <div className="ledger-budget-summary"><div><span>{copy('已支出', 'Spent')}</span><strong>{money(expense)}</strong></div><div><span>{copy('月预算', 'Monthly budget')}</span><strong>{budget ? money(budget.cents) : copy('未设置', 'Not set')}</strong></div></div>
    {budget && <><div className={`ledger-progress ${over ? 'is-over' : ''}`} role="img" aria-label={copy('预算使用进度', 'Budget usage')}><span style={{ width: `${over ? 100 : chartRatio(expense, budgetCents) * 100}%` }} /></div><p className={over ? 'personal-error' : 'ledger-muted'}>{over ? copy(`已超预算 ${money(expense - budgetCents)}`, `Over budget by ${money(expense - budgetCents)}`) : copy(`剩余预算 ${money(budgetCents - expense)}`, `Remaining budget ${money(budgetCents - expense)}`)}</p></>}
    <form onSubmit={submit}><label>{copy('月预算（元）', 'Monthly budget (CNY)')}<input type="text" inputMode="decimal" value={draft} onChange={event => { setDraft(event.target.value); setSaved(false) }} placeholder="0.00" required /></label><button type="submit" className="ledger-primary" disabled={store.blocked}>{copy('保存预算', 'Save budget')}</button></form>
    {error && <p className="personal-error" role="alert">{error}</p>}{saved && <p className="personal-status" role="status">{copy('预算已保存在当前浏览器。', 'Budget saved in this browser.')}</p>}
    <p className="ledger-muted">{copy('预算仅统计所浏览月份的全部支出，不受筛选影响。只有点击保存才会修改；读取失败时不会覆盖数据。', 'Uses all expenses in the browsed month, regardless of filters. Only Save changes your budget; loading errors never overwrite data.')}</p>
  </section>
}

export function LedgerApp({ copy, onClose }: { copy: PersonalToolCopy; onClose?: () => void }) {
  const store = usePersonalItems(LEDGER_STORAGE_KEY, isLedgerEntry)
  const [page, setPage] = useState<'details' | 'charts' | 'budget' | 'my'>('details')
  const [month, setMonth] = useState(() => localToday().slice(0, 7)), [browseDate, setBrowseDate] = useState(''), [query, setQuery] = useState(''), [filter, setFilter] = useState<'all' | 'income' | 'expense'>('all')
  const [searchOpen, setSearchOpen] = useState(false), [calendarOpen, setCalendarOpen] = useState(false), [amountsVisible, setAmountsVisible] = useState(true)
  const [kind, setKind] = useState<'income' | 'expense'>('expense'), [amount, setAmount] = useState(''), [note, setNote] = useState(''), [date, setDate] = useState(localToday)
  const [category, setCategory] = useState(''), [categoryFilter, setCategoryFilter] = useState('all')
  const [editorOpen, setEditorOpen] = useState(false), [discardOpen, setDiscardOpen] = useState(false)
  const [editing, setEditing] = useState<LedgerEntry | null>(null), [deleting, setDeleting] = useState<LedgerEntry | null>(null), [error, setError] = useState(''), [saved, setSaved] = useState('')
  const [range, setRange] = useState<'week' | 'month' | 'year'>('month'), [chartKind, setChartKind] = useState<'expense' | 'income'>('expense')
  const amountInput = useRef<HTMLInputElement>(null), plusButton = useRef<HTMLButtonElement>(null), dialogRef = useRef<HTMLDivElement>(null), backgroundRef = useRef<HTMLDivElement>(null), returnFocus = useRef<HTMLElement | null>(null)
  const draftStart = useRef('')
  const draftSnapshot = JSON.stringify({ kind, amount, note, date, category })
  const dirty = editorOpen && draftSnapshot !== draftStart.current
  const categoryLabel = (value: string) => {
    const known = ledgerCategories.find(item => item.id === value)
    return known ? copy(known.zh, known.en) : value ? copy(`自定义：${value}`, `Custom: ${value}`) : copy('未分类', 'Uncategorized')
  }
  const customCategories = [...new Set([...store.items.map(item => item.category), category].filter((value): value is string => !!value && !ledgerCategories.some(item => item.id === value)))].sort()
  const monthItems = store.items.filter(item => !month || item.date.startsWith(`${month}-`)), totals = ledgerTotals(monthItems)
  const activeMonth = month || localToday().slice(0, 7)
  const monthlyTotals = ledgerTotals(store.items.filter(item => item.date.startsWith(`${activeMonth}-`)))
  const money = (cents: bigint | number) => amountsVisible ? ledgerMoney(cents) : '••••'
  const needle = query.trim().toLocaleLowerCase()
  const visible = monthItems.filter(item => (!browseDate || item.date === browseDate) && (filter === 'all' || item.kind === filter) && (categoryFilter === 'all' || (categoryFilter === 'none' ? !item.category : item.category === categoryFilter.slice(9))) && (!needle || `${item.note} ${item.date} ${categoryLabel(item.category ?? '')} ${copy(item.kind === 'income' ? '收入' : '支出', item.kind === 'income' ? 'Income' : 'Expense')} ${ledgerMoney(item.cents)}`.toLocaleLowerCase().includes(needle)))
  const days = groupLedgerDays(visible)
  const dayLabel = (value: string) => new Intl.DateTimeFormat(copy('zh-CN', 'en-US'), { month: 'short', day: 'numeric', weekday: 'short', ...(!month ? { year: 'numeric' as const } : {}), timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
  const chart = buildLedgerChart(store.items, range, activeMonth, chartKind)
  const chartMax = chart.points.reduce((max, point) => point.cents > max ? point.cents : max, 0n)
  const chartPath = chart.points.map((point, index) => `${index ? 'L' : 'M'}${chart.points.length > 1 ? 12 + index / (chart.points.length - 1) * 576 : 300},${142 - chartRatio(point.cents, chartMax) * 120}`).join(' ')
  const reset = () => { setEditing(null); setAmount(''); setNote(''); setCategory(''); setKind('expense'); setDate(localToday()); setError(''); setDiscardOpen(false) }
  const closeEditor = () => { setEditorOpen(false); reset() }
  const requestCloseEditor = () => { if (dirty) setDiscardOpen(true); else closeEditor() }
  const openEditor = (item?: LedgerEntry, trigger?: HTMLElement) => {
    if (editorOpen || deleting) { setError(copy('请先保存或取消当前草稿，再编辑其他记录。', 'Save or cancel your current draft before editing another entry.')); return }
    returnFocus.current = trigger ?? plusButton.current
    const next = { kind: item?.kind ?? 'expense', amount: item ? ledgerMoney(item.cents).slice(1) : '', note: item?.note ?? '', date: item?.date ?? localToday(), category: item?.category ?? '' }
    draftStart.current = JSON.stringify(next)
    setEditing(item ?? null); setKind(next.kind); setAmount(next.amount); setNote(next.note); setDate(next.date); setCategory(next.category); setError(''); setSaved(''); setDiscardOpen(false); setEditorOpen(true)
  }
  useEffect(() => {
    if (!editorOpen && !deleting) return
    const background = backgroundRef.current
    if (background) background.inert = true
    const frame = requestAnimationFrame(() => {
      if (editorOpen && !discardOpen && !store.blocked) amountInput.current?.focus()
      else dialogRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    })
    return () => { cancelAnimationFrame(frame); if (background) background.inert = false }
  }, [editorOpen, deleting, discardOpen, store.blocked])
  // Capture on window BEFORE DesktopTools' document-capture Escape handler.
  // Refresh only the handler as dirty changes, not focus (typing must not steal it).
  useEffect(() => {
    if (!editorOpen && !deleting) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (deleting) { setDeleting(null); setError('') } else if (discardOpen) setDiscardOpen(false); else requestCloseEditor(); return }
      if (event.key !== 'Tab') return
      event.stopImmediatePropagation()
      const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter(node => !node.closest('[inert]'))
      const first = nodes[0], last = nodes[nodes.length - 1]
      if (!first) { event.preventDefault(); dialogRef.current?.focus(); return }
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', keydown, true)
    return () => window.removeEventListener('keydown', keydown, true)
  }, [editorOpen, deleting, discardOpen, dirty])
  const wasModalOpen = useRef(false)
  useEffect(() => {
    const open = editorOpen || !!deleting
    if (wasModalOpen.current && !open) (returnFocus.current?.isConnected ? returnFocus.current : plusButton.current)?.focus()
    wasModalOpen.current = open
  }, [editorOpen, deleting])
  const submit = (event: FormEvent) => {
    event.preventDefault(); setSaved('')
    const cents = parseLedgerCents(amount), limit = editing ? Number.MAX_SAFE_INTEGER : 100000000000
    if (cents === null || cents > limit || !isPersonalDate(date) || note.length > Math.max(200, editing?.note.length ?? 0)) {
      setError(copy('请输入有效日期和正数金额（最多两位小数，新记录最高 10 亿元）。备注最多 200 字。', 'Enter a valid date and positive amount (up to two decimal places; new entries max CNY 1 billion). Notes allow up to 200 characters.')); return
    }
    const current = editing && store.items.find(item => item.id === editing.id)
    if (editing && (!current || JSON.stringify(current) !== JSON.stringify(editing))) {
      setError(copy('这条记录在重新读取后已被更改或删除。草稿未保存；请保留所需内容，取消编辑后重新打开记录。', 'This entry changed or was deleted after reloading. Your draft was not saved. Keep any needed text, cancel editing, then reopen the entry.')); return
    }
    const entry: LedgerEntry = { ...(current || {}), id: editing?.id ?? personalToolId(), kind, cents, note: note.trim(), date }
    if (category) entry.category = category; else delete entry.category
    if (store.save(editing ? store.items.map(item => item.id === editing.id ? entry : item) : [entry, ...store.items])) {
      closeEditor(); setMonth(date.slice(0, 7)); setBrowseDate(''); setPage('details'); setSaved(copy('记录已保存。', 'Entry saved.'))
    } else setError('')
  }
  const remove = () => {
    if (!deleting) return
    const current = store.items.find(item => item.id === deleting.id)
    if (!current || JSON.stringify(current) !== JSON.stringify(deleting)) { setError(copy('待删除记录已更改，请取消后重新选择。', 'The entry selected for deletion changed. Cancel and select it again.')); return }
    if (store.save(store.items.filter(item => item.id !== deleting.id))) { setDeleting(null); setError(''); setSaved(copy('记录已删除。', 'Entry deleted.')) }
  }
  const browseMonth = (next: string) => { setMonth(next); setBrowseDate('') }
  const openSearch = (categories = false) => { setPage('details'); setSearchOpen(value => categories ? true : !value) }
  const tabs = [{ id: 'details' as const, zh: '明细', en: 'Details', Icon: FileText }, { id: 'charts' as const, zh: '图表', en: 'Charts', Icon: BarChart3 }, { id: 'budget' as const, zh: '预算', en: 'Budget', Icon: Wallet }, { id: 'my' as const, zh: '我的', en: 'My ledger', Icon: CircleUserRound }]
  return <section className="ledger-reference-app" data-page={page} aria-label={copy('收支手账', 'Budget ledger')}>
    <div className="ledger-app-frame" ref={backgroundRef}>
      <header className="ledger-header">
        <div className="ledger-topline"><button type="button" className="ledger-back" onClick={onClose} disabled={!onClose}><ArrowLeft size={18} />{copy('返回 Aily', 'Back to Aily')}</button><span>{copy('收支手账', 'MONEY JOURNAL')}</span><div className="ledger-header-actions"><button type="button" aria-label={copy('打开搜索', 'Open search')} onClick={() => openSearch()}><Search size={20} /></button><button type="button" aria-label={copy('选择月份', 'Choose month')} aria-expanded={calendarOpen} onClick={() => setCalendarOpen(!calendarOpen)}><CalendarDays size={20} /></button><button type="button" aria-label={copy('更多设置', 'More settings')} onClick={() => setPage('my')}><MoreHorizontal size={22} /></button></div></div>
        <div className="ledger-month-summary" role="region" aria-label={month ? copy('月度汇总', 'Monthly totals') : copy('全部汇总', 'All-time totals')}><button className="ledger-month-title" type="button" onClick={() => setCalendarOpen(!calendarOpen)} aria-expanded={calendarOpen}><small>{month ? `${month.slice(0, 4)}${copy('年', '')}` : copy('所有年份', 'ALL YEARS')}</small><strong>{month ? `${Number(month.slice(5))}${copy('月', '')}` : copy('全部日期', 'All dates')}<ChevronRight size={17} /></strong></button><div className="ledger-header-total"><span>{copy('收入', 'INCOME')}</span><strong>{money(totals.income)}</strong></div><div className="ledger-header-total"><span>{copy('支出', 'EXPENSE')}</span><strong>{money(totals.expense)}</strong></div><button type="button" className="ledger-eye" aria-label={amountsVisible ? copy('隐藏金额', 'Hide amounts') : copy('显示金额', 'Show amounts')} aria-pressed={!amountsVisible} onClick={() => setAmountsVisible(!amountsVisible)}>{amountsVisible ? <Eye size={19} /> : <EyeOff size={19} />}</button></div>
        <nav className="ledger-shortcuts" aria-label={copy('记账快捷操作', 'Ledger shortcuts')}><button type="button" onClick={() => setPage('details')}><FileText />{copy('账单', 'Bills')}</button><button type="button" onClick={() => setPage('budget')}><Wallet />{copy('预算', 'Budget')}</button><button type="button" onClick={() => openSearch(true)}><Tags />{copy('分类', 'Categories')}</button><button type="button" onClick={() => openSearch()}><Search />{copy('搜索', 'Search')}</button><button type="button" onClick={() => setPage('my')}><MoreHorizontal />{copy('更多', 'More')}</button></nav>
      </header>
      <main className="ledger-content">
        <PersonalStoreNotice store={store} copy={copy} />{saved && <p className="personal-status" role="status">{saved}</p>}{error && !editorOpen && !deleting && <p className="personal-error" role="alert">{error}</p>}
        {calendarOpen && <section className="ledger-card ledger-calendar" aria-label={copy('月份导航', 'Month navigation')}><button type="button" aria-label={copy('上个月', 'Previous month')} onClick={() => browseMonth(shiftPersonalMonth(activeMonth, -1))}><ChevronLeft /></button><label>{copy('浏览月份', 'Browse month')}<input type="month" value={month} onChange={event => { if (!event.target.value || isPersonalMonth(event.target.value)) browseMonth(event.target.value) }} /></label><button type="button" aria-label={copy('下个月', 'Next month')} onClick={() => browseMonth(shiftPersonalMonth(activeMonth, 1))}><ChevronRight /></button><div className="ledger-calendar-presets"><button type="button" onClick={() => browseMonth(localToday().slice(0, 7))}>{copy('本月', 'This month')}</button><button type="button" onClick={() => browseMonth('')}>{copy('全部日期', 'All dates')}</button></div></section>}
        {page === 'details' && <>
          <div className="ledger-section-heading"><h2>{copy('明细', 'DETAILS')}</h2><span>{copy(`结余 ${money(totals.balance)}`, `Balance ${money(totals.balance)}`)}</span><button type="button" aria-expanded={searchOpen} aria-label={copy('筛选记录', 'Filter entries')} onClick={() => setSearchOpen(!searchOpen)}><Settings2 size={18} /></button></div>
          {searchOpen && <section className="ledger-card ledger-filters" aria-label={copy('搜索与筛选', 'Search and filters')}><label className="ledger-wide">{copy('搜索记录', 'Search entries')}<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={copy('备注、日期、分类或金额', 'Note, date, category or amount')} /></label><label>{copy('类型筛选', 'Filter type')}<select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">{copy('全部收支', 'All types')}</option><option value="expense">{copy('支出', 'Expense')}</option><option value="income">{copy('收入', 'Income')}</option></select></label><label>{copy('分类筛选', 'Filter category')}<select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="all">{copy('全部分类', 'All categories')}</option><option value="none">{categoryLabel('')}</option>{ledgerCategories.map(item => <option value={`category:${item.id}`} key={item.id}>{categoryLabel(item.id)}</option>)}{customCategories.map(value => <option value={`category:${value}`} key={value}>{categoryLabel(value)}</option>)}</select></label><label className="ledger-wide">{copy('具体日期', 'Filter date')}<input type="date" value={browseDate} onChange={event => { setBrowseDate(event.target.value); if (isPersonalDate(event.target.value)) setMonth(event.target.value.slice(0, 7)) }} /></label><button className="ledger-wide" type="button" onClick={() => { setQuery(''); setFilter('all'); setCategoryFilter('all'); setBrowseDate('') }}>{copy('清除筛选', 'Clear filters')}</button></section>}
          <p className="ledger-filter-note" aria-live="polite">{copy(`显示 ${visible.length} 条记录 · 月度汇总不受筛选影响`, `${visible.length} entries · Monthly totals ignore filters`)}</p>
          <div className="ledger-days">{days.map(day => <section className="ledger-day" key={day.date}><header className="ledger-day-heading"><time dateTime={day.date}>{dayLabel(day.date)}</time><span>{copy('收入', 'In')} {money(day.income)} · {copy('支出', 'Out')} {money(day.expense)}</span></header><ul>{day.entries.map(item => <li className="ledger-row" key={item.id}><button type="button" className="ledger-row-main" onClick={event => openEditor(item, event.currentTarget)} aria-label={copy(`编辑记录：${item.note || item.date}`, `Edit entry: ${item.note || item.date}`)}><span className={`ledger-category-icon ${item.kind}`}><CategoryIcon category={item.category} /></span><span className="ledger-row-copy"><strong>{item.note || categoryLabel(item.category ?? '')}</strong><small>{categoryLabel(item.category ?? '')} · {copy(item.kind === 'income' ? '收入' : '支出', item.kind === 'income' ? 'Income' : 'Expense')}</small></span><b className={item.kind === 'income' ? 'ledger-income' : ''}>{amountsVisible ? `${item.kind === 'income' ? '+' : '−'}${ledgerMoney(item.cents)}` : '••••'}</b></button><div className="ledger-row-actions"><button type="button" disabled={store.blocked} aria-label={copy(`删除记录：${item.note || item.date}`, `Delete entry: ${item.note || item.date}`)} onClick={event => { returnFocus.current = event.currentTarget; setError(''); setDeleting(item) }}><Trash2 size={16} /></button></div></li>)}</ul></section>)}</div>
          {!visible.length && <div className="ledger-empty"><span><FileText size={32} /></span><h3>{store.blocked ? copy('记录暂不可用', 'Records unavailable') : store.items.length ? copy('没有匹配记录', 'No matching entries') : copy('从第一笔开始', 'Start with your first entry')}</h3><p>{store.blocked ? copy('请先处理上方的存储提示，原数据不会被覆盖。', 'Resolve the storage notice above. Existing data will not be overwritten.') : store.items.length ? copy('试试其他月份，或清除搜索和筛选。', 'Try another month, or clear your search and filters.') : copy('点击下方黄色 ＋，记下真实的收入和支出。', 'Tap the yellow + below to record your income or expenses.')}</p></div>}
        </>}
        {page === 'charts' && <section className="ledger-charts"><div className="ledger-section-heading"><h2>{copy('收支图表', 'Your money, in view')}</h2><span>{activeMonth}</span></div><div className="ledger-segmented" aria-label={copy('图表范围', 'Chart range')}>{(['week', 'month', 'year'] as const).map(value => <button type="button" key={value} aria-pressed={range === value} onClick={() => setRange(value)}>{copy(value === 'week' ? '周' : value === 'month' ? '月' : '年', value === 'week' ? 'Week' : value === 'month' ? 'Month' : 'Year')}</button>)}</div><div className="ledger-chart-kind"><button type="button" aria-pressed={chartKind === 'expense'} onClick={() => setChartKind('expense')}>{copy('支出', 'Expenses')}</button><button type="button" aria-pressed={chartKind === 'income'} onClick={() => setChartKind('income')}>{copy('收入', 'Income')}</button></div><section className="ledger-card"><div className="ledger-chart-totals"><div><span>{copy('总金额', 'Total')}</span><strong>{money(chart.total)}</strong></div><div><span>{copy('日均金额', 'Daily average')}</span><strong>{money(chart.average)}</strong></div></div><p className="ledger-muted">{chart.start} — {chart.end}</p><svg className="ledger-line-chart" viewBox="0 0 600 170" role="img" aria-label={copy('所选范围内实际收支趋势', 'Actual transaction trend for the selected range')}><title>{copy('实际记录趋势', 'Recorded transaction trend')}</title>{[22, 82, 142].map(y => <line key={y} x1="12" x2="588" y1={y} y2={y} className="ledger-chart-grid" />)}{chart.points.length > 0 && <path d={chartPath} className="ledger-chart-line" />}{chart.points.length === 1 && <circle cx="300" cy={142 - chartRatio(chart.points[0].cents, chartMax) * 120} r="4" className="ledger-chart-dot" />}</svg><div className="ledger-chart-labels"><span>{chart.points[0]?.label}</span><span>{chart.points[Math.floor(chart.points.length / 2)]?.label}</span><span>{chart.points.length > 1 ? chart.points[chart.points.length - 1]?.label : ''}</span></div>{chart.total === 0n && <p className="ledger-muted">{copy('这段时间还没有此类记录，图表从零开始。', 'No entries of this type in this period. The chart starts at zero.')}</p>}{amountsVisible && <details className="ledger-chart-data"><summary>{copy('查看每日金额', 'View chart amounts')}</summary><ul>{chart.points.map(point => <li key={point.key}><span>{point.label}</span><b>{money(point.cents)}</b></li>)}</ul></details>}</section><section className="ledger-card"><h3>{copy('分类排行', 'Category breakdown')}</h3>{chart.categories.map(item => <div className="ledger-ranking" key={item.category}><span className="ledger-category-icon"><CategoryIcon category={item.category} /></span><div><div className="ledger-ranking-label"><strong>{categoryLabel(item.category)}</strong><span>{amountsVisible ? `${item.percent.toFixed(1)}%` : '••••'} · {copy(`${item.count} 笔`, `${item.count} entries`)}</span><b>{money(item.cents)}</b></div><div className="ledger-progress"><span style={{ width: `${chartRatio(item.cents, chart.total) * 100}%` }} /></div></div></div>)}{!chart.categories.length && <p className="ledger-muted">{copy('添加真实记录后，这里会显示分类占比。', 'Category percentages appear here once you add real entries.')}</p>}</section><p className="ledger-muted">{copy('图表使用所选月份对应的真实记录，不受明细筛选影响；浏览全部日期时使用本月。', 'Charts use real entries for the selected period, independently of detail filters. All dates uses the current month.')}</p></section>}
        {page === 'budget' && <LedgerBudget key={activeMonth} month={activeMonth} expense={monthlyTotals.expense} copy={copy} money={money} />}
        {page === 'my' && <section className="ledger-my"><div className="ledger-section-heading"><h2>{copy('我的手账', 'My ledger')}</h2><CircleUserRound /></div><section className="ledger-card"><h3>{copy('金额显示', 'Amount display')}</h3><p className="ledger-muted">{copy('在共用设备上，仅隐藏账目展示中的金额；编辑、预算输入及导出仍显示真实金额。', 'Hides amounts only in ledger displays on a shared device. Entry editing, budget inputs and exports still show actual amounts.')}</p><button type="button" aria-pressed={!amountsVisible} onClick={() => setAmountsVisible(!amountsVisible)}>{amountsVisible ? <EyeOff size={18} /> : <Eye size={18} />}{amountsVisible ? copy('隐藏金额', 'Hide amounts') : copy('显示金额', 'Show amounts')}</button></section><section className="ledger-card"><h3>{copy('导出与隐私', 'Export & privacy')}</h3><PersonalLocalNotice copy={copy} /><PersonalJsonExport items={store.items} name="ledger" blocked={store.blocked} isCurrent={store.isCurrent} copy={copy} /><p className="ledger-muted">{copy('预算也仅保存在当前浏览器；账单 JSON 导出不包含预算。没有 AI 理财、金融产品、云同步或银行连接。', 'Budgets also stay in this browser; ledger JSON exports do not include budgets. No AI financial advice, financial products, cloud sync or bank connection.')}</p></section></section>}
      </main>
      <nav className="ledger-bottom-nav" aria-label={copy('手账导航', 'Ledger navigation')}>{tabs.slice(0, 2).map(tab => <button type="button" key={tab.id} aria-current={page === tab.id ? 'page' : undefined} onClick={() => setPage(tab.id)}><tab.Icon size={23} /><span>{copy(tab.zh, tab.en)}</span></button>)}<button type="button" ref={plusButton} className="ledger-add" aria-label={copy('记下一笔', 'Add an entry')} onClick={() => openEditor()}><Plus size={31} /></button>{tabs.slice(2).map(tab => <button type="button" key={tab.id} aria-current={page === tab.id ? 'page' : undefined} onClick={() => setPage(tab.id)}><tab.Icon size={23} /><span>{copy(tab.zh, tab.en)}</span></button>)}</nav>
    </div>
    {(editorOpen || deleting) && <div className="ledger-modal-backdrop" onClick={event => { if (event.target !== event.currentTarget) return; if (deleting) { setDeleting(null); setError('') } else requestCloseEditor() }}><div className="ledger-editor" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ledger-dialog-title" tabIndex={-1}>
      {deleting ? <><h2 id="ledger-dialog-title">{copy('确认删除记录', 'Confirm entry deletion')}</h2><p>{copy(`删除“${deleting.note || deleting.date}”？此操作无法撤销。`, `Delete “${deleting.note || deleting.date}”? This cannot be undone.`)}</p><PersonalStoreNotice store={store} copy={copy} />{error && <p className="personal-error" role="alert">{error}</p>}<div className="ledger-dialog-actions"><button type="button" onClick={() => { setDeleting(null); setError('') }}>{copy('取消删除', 'Cancel deletion')}</button><button type="button" className="ledger-danger" disabled={store.blocked} onClick={remove}>{copy('确认删除', 'Confirm delete')}</button></div></> : discardOpen ? <><h2 id="ledger-dialog-title">{copy('放弃未保存的修改？', 'Discard unsaved changes?')}</h2><p>{copy('草稿尚未保存。继续编辑可保留内容，放弃后不能恢复。', 'Your draft is not saved. Keep editing to preserve it; discarded changes cannot be recovered.')}</p><div className="ledger-dialog-actions"><button type="button" className="ledger-primary" onClick={() => setDiscardOpen(false)}>{copy('继续编辑', 'Keep editing')}</button><button type="button" className="ledger-danger" onClick={closeEditor}>{copy('放弃草稿', 'Discard draft')}</button></div></> : <><div className="ledger-dialog-heading"><h2 id="ledger-dialog-title">{editing ? copy('编辑记录', 'Edit entry') : copy('记下一笔', 'Add an entry')}</h2><button type="button" aria-label={copy('关闭编辑器', 'Close editor')} onClick={requestCloseEditor}><X size={21} /></button></div><PersonalStoreNotice store={store} copy={copy} /><form onSubmit={submit}><fieldset disabled={store.blocked}><label>{copy('收支类型', 'Entry type')}<select value={kind} onChange={event => setKind(event.target.value as 'income' | 'expense')}><option value="expense">{copy('支出', 'Expense')}</option><option value="income">{copy('收入', 'Income')}</option></select></label><label>{copy('金额（元）', 'Amount (CNY)')}<input ref={amountInput} type="text" inputMode="decimal" required value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" /></label><label className="ledger-wide">{copy('日期', 'Date')}<input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label><label className="ledger-wide">{copy('备注', 'Note')}<input maxLength={Math.max(200, editing?.note.length ?? 0)} value={note} onChange={event => setNote(event.target.value)} placeholder={copy('这笔钱花在哪里？', 'What was it for?')} /></label><label className="ledger-wide">{copy('分类（可选）', 'Category (optional)')}<select value={category} onChange={event => setCategory(event.target.value)}><option value="">{categoryLabel('')}</option>{ledgerCategories.map(item => <option value={item.id} key={item.id}>{categoryLabel(item.id)}</option>)}{customCategories.map(value => <option value={value} key={value}>{categoryLabel(value)}</option>)}</select></label><label className="ledger-wide">{copy('或输入自定义分类', 'Or enter a custom category')}<input value={category && !ledgerCategories.some(item => item.id === category) ? category : ''} onChange={event => setCategory(event.target.value)} placeholder={copy('例如：宠物', 'For example: Pets')} /></label><button className="ledger-primary ledger-wide" type="submit">{editing ? copy('保存修改', 'Save changes') : copy('添加记录', 'Add entry')}</button></fieldset>{error && <p className="personal-error" role="alert">{error}</p>}<button className="ledger-cancel" type="button" onClick={requestCloseEditor}>{copy('取消草稿', 'Cancel draft')}</button></form></>}
    </div></div>}
  </section>
}
export default LedgerApp
