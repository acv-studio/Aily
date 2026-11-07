import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { isPersonalDate, isPersonalMonth, isPersonalRecord, localToday, personalToolId, PersonalJsonExport, PersonalLocalNotice, PersonalStoreNotice, shiftPersonalMonth, usePersonalItems } from './personalToolsStorage'
import type { PersonalToolCopy } from './personalToolsStorage'
import './personalTools.css'

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

export function LedgerApp({ copy }: { copy: PersonalToolCopy }) {
  const store = usePersonalItems(LEDGER_STORAGE_KEY, isLedgerEntry)
  const [month, setMonth] = useState(() => localToday().slice(0, 7)), [browseDate, setBrowseDate] = useState(''), [query, setQuery] = useState(''), [filter, setFilter] = useState<'all' | 'income' | 'expense'>('all')
  const [kind, setKind] = useState<'income' | 'expense'>('expense'), [amount, setAmount] = useState(''), [note, setNote] = useState(''), [date, setDate] = useState(localToday)
  const [category, setCategory] = useState(''), [categoryFilter, setCategoryFilter] = useState('all')
  const categoryLabel = (value: string) => {
    const known = ledgerCategories.find(item => item.id === value)
    return known ? copy(known.zh, known.en) : value ? copy(`自定义：${value}`, `Custom: ${value}`) : copy('未分类', 'Uncategorized')
  }
  const customCategories = [...new Set(store.items.map(item => item.category).filter((value): value is string => !!value && !ledgerCategories.some(item => item.id === value)))].sort()
  const [editing, setEditing] = useState<LedgerEntry | null>(null), [deleting, setDeleting] = useState<LedgerEntry | null>(null), [error, setError] = useState(''), [saved, setSaved] = useState('')
  const amountInput = useRef<HTMLInputElement>(null)
  const monthItems = store.items.filter(item => !month || item.date.startsWith(`${month}-`))
  const totals = ledgerTotals(monthItems)
  const needle = query.trim().toLocaleLowerCase()
  const visible = monthItems.filter(item => (!browseDate || item.date === browseDate) && (filter === 'all' || item.kind === filter) && (categoryFilter === 'all' || (categoryFilter === 'none' ? !item.category : item.category === categoryFilter.slice(9))) && (!needle || `${item.note} ${item.date} ${categoryLabel(item.category ?? '')} ${copy(item.kind === 'income' ? '收入' : '支出', item.kind === 'income' ? 'Income' : 'Expense')} ${ledgerMoney(item.cents)}`.toLocaleLowerCase().includes(needle))).sort((a, b) => b.date.localeCompare(a.date))
  const reset = () => { setEditing(null); setAmount(''); setNote(''); setCategory(''); setKind('expense'); setDate(localToday()); setError('') }
  const edit = (item: LedgerEntry) => {
    if (editing || amount || note || category) { setError(copy('请先保存或取消当前草稿，再编辑其他记录。', 'Save or cancel your current draft before editing another entry.')); return }
    setEditing(item); setKind(item.kind); setAmount(ledgerMoney(item.cents).slice(1)); setDate(item.date); setNote(item.note); setCategory(item.category ?? ''); setError(''); setSaved('')
    amountInput.current?.focus(); amountInput.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }
  const submit = (event: FormEvent) => {
    event.preventDefault(); setSaved('')
    const cents = parseLedgerCents(amount)
    // Existing safe-integer amounts remain editable, even if above the add-entry limit.
    const limit = editing ? Number.MAX_SAFE_INTEGER : 100000000000
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
      reset(); setMonth(date.slice(0, 7)); setBrowseDate(''); setSaved(copy('记录已保存。', 'Entry saved.'))
    } else setError('')
  }
  const remove = () => {
    if (!deleting) return
    const current = store.items.find(item => item.id === deleting.id)
    if (!current || JSON.stringify(current) !== JSON.stringify(deleting)) { setError(copy('待删除记录已更改，请取消后重新选择。', 'The entry selected for deletion changed. Cancel and select it again.')); return }
    if (store.save(store.items.filter(item => item.id !== deleting.id))) { setDeleting(null); setSaved(copy('记录已删除。', 'Entry deleted.')) }
  }
  const browseMonth = (next: string) => { setMonth(next); setBrowseDate('') }
  return <section className="personal-tools ledger-app" aria-label={copy('记账记录', 'Ledger records')}>
    <div className="personal-heading"><div><span className="personal-eyebrow">{copy('收支手账', 'MONEY JOURNAL')}</span><h3>{copy('每一笔，都清楚', 'A little clarity, every day')}</h3></div><PersonalJsonExport items={store.items} name="ledger" blocked={store.blocked} isCurrent={store.isCurrent} copy={copy} /></div>
    <PersonalLocalNotice copy={copy} /><PersonalStoreNotice store={store} copy={copy} />
    <div className="personal-month-nav">
      <button type="button" aria-label={copy('上个月', 'Previous month')} onClick={() => browseMonth(shiftPersonalMonth(month || localToday().slice(0, 7), -1))}>‹</button>
      <label>{copy('浏览月份', 'Browse month')}<input type="month" value={month} onChange={event => { if (!event.target.value || isPersonalMonth(event.target.value)) browseMonth(event.target.value) }} /></label>
      <button type="button" aria-label={copy('下个月', 'Next month')} onClick={() => browseMonth(shiftPersonalMonth(month || localToday().slice(0, 7), 1))}>›</button>
      <button type="button" onClick={() => browseMonth(localToday().slice(0, 7))}>{copy('本月', 'This month')}</button><button type="button" onClick={() => browseMonth('')}>{copy('全部日期', 'All dates')}</button>
    </div>
    <section className="personal-summary" aria-label={month ? copy('月度汇总', 'Monthly totals') : copy('全部汇总', 'All-time totals')}>
      <div><span>{copy('收入', 'Income')}</span><strong className="personal-income">{ledgerMoney(totals.income)}</strong></div><div><span>{copy('支出', 'Expenses')}</span><strong>{ledgerMoney(totals.expense)}</strong></div><div><span>{copy('结余', 'Balance')}</span><strong>{ledgerMoney(totals.balance)}</strong></div>
    </section><p className="personal-help">{copy('汇总包含所选月份的全部记录，不受搜索、类型、分类或具体日期筛选影响。金额以人民币记录。', 'Totals include all entries in the selected month, unaffected by search, type, category or day filters. Amounts are recorded in CNY.')}</p>
    <form className="personal-editor" onSubmit={submit}><h4>{editing ? copy('编辑记录', 'Edit entry') : copy('记下一笔', 'Add an entry')}</h4><fieldset disabled={store.blocked}>
      <label>{copy('收支类型', 'Entry type')}<select value={kind} onChange={event => setKind(event.target.value as 'income' | 'expense')}><option value="expense">{copy('支出', 'Expense')}</option><option value="income">{copy('收入', 'Income')}</option></select></label>
      <label>{copy('金额（元）', 'Amount (CNY)')}<input ref={amountInput} type="text" inputMode="decimal" required value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" /></label>
      <label>{copy('日期', 'Date')}<input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label>
      <label>{copy('备注', 'Note')}<input maxLength={Math.max(200, editing?.note.length ?? 0)} value={note} onChange={event => setNote(event.target.value)} placeholder={copy('这笔钱花在哪里？', 'What was it for?')} /></label>
      <label>{copy('分类（可选）', 'Category (optional)')}<select value={category} onChange={event => setCategory(event.target.value)}><option value="">{categoryLabel('')}</option>{ledgerCategories.map(item => <option value={item.id} key={item.id}>{categoryLabel(item.id)}</option>)}{category && !ledgerCategories.some(item => item.id === category) && <option value={category}>{categoryLabel(category)}</option>}</select></label>
      <button className="personal-primary" type="submit">{editing ? copy('保存修改', 'Save changes') : copy('添加记录', 'Add entry')}</button>
    </fieldset>{(editing || amount || note || category) && <button type="button" className="personal-cancel" onClick={reset}>{copy('取消草稿', 'Cancel draft')}</button>}</form>
    {error && <p className="personal-error" role="alert">{error}</p>}{saved && <p className="personal-status" role="status">{saved}</p>}
    <div className="personal-filters"><label className="personal-search">{copy('搜索记录', 'Search entries')}<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={copy('备注、日期、分类或金额', 'Note, date, category or amount')} /></label><label>{copy('类型筛选', 'Filter type')}<select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">{copy('全部收支', 'All types')}</option><option value="expense">{copy('支出', 'Expense')}</option><option value="income">{copy('收入', 'Income')}</option></select></label><label>{copy('分类筛选', 'Filter category')}<select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="all">{copy('全部分类', 'All categories')}</option><option value="none">{categoryLabel('')}</option>{ledgerCategories.map(item => <option value={`category:${item.id}`} key={item.id}>{categoryLabel(item.id)}</option>)}{customCategories.map(value => <option value={`category:${value}`} key={value}>{categoryLabel(value)}</option>)}</select></label><label>{copy('具体日期', 'Filter date')}<input type="date" value={browseDate} onChange={event => { setBrowseDate(event.target.value); if (event.target.value) setMonth(event.target.value.slice(0, 7)) }} /></label><button type="button" className="personal-wide" onClick={() => { setQuery(''); setFilter('all'); setCategoryFilter('all'); setBrowseDate('') }}>{copy('清除筛选', 'Clear filters')}</button></div>
    <p className="personal-help" aria-live="polite">{copy(`显示 ${visible.length} 条记录`, `${visible.length} entries shown`)}</p>
    {deleting && <div className="personal-delete-confirm" role="group" aria-label={copy('确认删除记录', 'Confirm entry deletion')}><p>{copy(`删除“${deleting.note || deleting.date}”？此操作无法撤销。`, `Delete “${deleting.note || deleting.date}”? This cannot be undone.`)}</p><button type="button" className="personal-danger" disabled={store.blocked} onClick={remove}>{copy('确认删除', 'Confirm delete')}</button><button type="button" onClick={() => setDeleting(null)}>{copy('取消删除', 'Cancel deletion')}</button></div>}
    <ul className="personal-entry-list">{visible.map((item, index) => <li key={item.id}>
      {(index === 0 || visible[index - 1].date !== item.date) && <h4 className="personal-day-heading"><time dateTime={item.date}>{item.date}</time></h4>}
      <article className="personal-ledger-row"><span className={`personal-kind-icon ${item.kind}`} aria-hidden="true">{item.kind === 'income' ? '↙' : '↗'}</span><div className="personal-entry-body"><strong>{item.note || copy(item.kind === 'income' ? '收入' : '支出', item.kind === 'income' ? 'Income' : 'Expense')}</strong><small>{copy(item.kind === 'income' ? '收入' : '支出', item.kind === 'income' ? 'Income' : 'Expense')} · {categoryLabel(item.category ?? '')}</small></div><b className={item.kind === 'income' ? 'personal-income' : ''}>{item.kind === 'income' ? '+' : '−'}{ledgerMoney(item.cents)}</b><div className="personal-row-actions"><button type="button" disabled={store.blocked || !!deleting} aria-label={copy(`编辑记录：${item.note || item.date}`, `Edit entry: ${item.note || item.date}`)} onClick={() => edit(item)}>{copy('编辑', 'Edit')}</button><button type="button" disabled={store.blocked || !!editing} aria-label={copy(`删除记录：${item.note || item.date}`, `Delete entry: ${item.note || item.date}`)} onClick={() => setDeleting(item)}>{copy('删除', 'Delete')}</button></div></article>
    </li>)}</ul>
    {!visible.length && !store.blocked && <div className="personal-empty"><span aria-hidden="true">↗</span><h4>{store.items.length ? copy('没有匹配记录', 'No matching entries') : copy('从第一笔开始', 'Start with your first entry')}</h4><p>{store.items.length ? copy('试试其他月份，或清除搜索和筛选。', 'Try another month, or clear your search and filters.') : copy('记下收入和支出，为日常留一点余地。', 'Record income and expenses, and make room for everyday life.')}</p></div>}
  </section>
}
export default LedgerApp
