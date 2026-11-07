import { useState, type FormEvent } from 'react'
import type { Locale } from './i18n'
import './contactsApp.css'

const KEY = 'aily-desktop-contacts'
type Contact = { id: string; name: string; phone: string; email: string; [key: string]: unknown }
type Snapshot = { items: Contact[]; raw: string | null; failed: boolean }
const contactGroup = (item: Contact) => typeof item.group === 'string' ? item.group.trim() : ''
function load(): Snapshot {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw === null ? [] : JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every(item => item && typeof item === 'object' && ['id', 'name', 'phone', 'email'].every(key => typeof item[key] === 'string'))) throw new Error('Invalid contacts')
    return { items: parsed, raw, failed: false }
  } catch { return { items: [], raw: null, failed: true } }
}
// Only user-initiated actions receive links. Never interpret stored text as a URL.
export function contactPhoneHref(value: string): string | undefined {
  const phone = value.trim()
  if (!/^\+?[\d ()-]+$/.test(phone) || !/\d/.test(phone)) return undefined
  return `tel:${phone.replace(/[ ()-]/g, '')}`
}
export function contactEmailHref(value: string): string | undefined {
  const email = value.trim()
  if (!/^[A-Za-z0-9.!#$&'*+/=_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(email)) return undefined
  return `mailto:${encodeURIComponent(email)}`
}
export default function ContactsApp({ locale }: { locale: Locale }) {
  const copy = (zh: string, en: string) => locale === 'en' ? en : zh
  const [state, setState] = useState(load), [stale, setStale] = useState(false), [writeFailed, setWriteFailed] = useState(false)
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [email, setEmail] = useState(''), [group, setGroup] = useState('')
  const [editing, setEditing] = useState<{ index: number; raw: string } | null>(null), [error, setError] = useState('')
  const [query, setQuery] = useState(''), [favoritesOnly, setFavoritesOnly] = useState(false), [groupFilter, setGroupFilter] = useState('')
  const blocked = state.failed || stale
  const reload = () => { setState(load()); setStale(false); setWriteFailed(false) }
  const save = (items: Contact[]) => {
    if (blocked) return false
    try {
      // Best-effort concurrency guard: localStorage has no atomic compare-and-swap.
      if (localStorage.getItem(KEY) !== state.raw) { setStale(true); setWriteFailed(false); return false }
      const raw = JSON.stringify(items)
      localStorage.setItem(KEY, raw); setState({ items, raw, failed: false }); setWriteFailed(false); return true
    } catch { setWriteFailed(true); return false }
  }
  const clearForm = () => { setEditing(null); setName(''); setPhone(''); setEmail(''); setGroup(''); setError('') }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    const original = editing && state.items[editing.index]
    if (editing && (!original || JSON.stringify(original) !== editing.raw)) {
      setError(copy('该联系人已更改，请取消后重新选择编辑；草稿已保留。', 'This contact has changed. Cancel and select Edit again; your draft is retained.')); return
    }
    const contact: Contact = { ...(original || {}), id: original ? original.id : globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, name: name.trim(), phone: phone.trim(), email: email.trim() }
    if (group.trim()) contact.group = group.trim()
    else if (typeof original?.group === 'string') delete contact.group
    // Keep legacy records without a group field and preserve unrelated unknown metadata.
    if (save(editing ? state.items.map((item, index) => index === editing.index ? contact : item) : [contact, ...state.items])) clearForm()
  }
  const groups = [...new Set(state.items.map(contactGroup).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const selectedGroup = groupFilter.startsWith('group:') ? groupFilter.slice(6) : ''
  const visible = state.items.map((item, index) => ({ item, index })).filter(({ item }) => (!favoritesOnly || item.favorite === true) && (!groupFilter || (groupFilter === 'ungrouped' ? !contactGroup(item) : contactGroup(item) === selectedGroup)) && [item.name, item.phone, item.email].some(value => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
  return <section className="aily-contacts" aria-label={copy('本机通讯录', 'Local contacts')}>
    <p className="contacts-notice">{copy('这是你手动建立的通讯录，不会读取手机或系统联系人。仅保存在当前浏览器，默认不上传、不同步，不包含在聊天加密备份中。主 Bot 只有在你主动预览并确认本次授权后，才会将所选字段发送给指定模型。清除浏览器数据会移除这些记录；共用设备上的其他使用者可能看到它们。', 'This is your manually created address book. It does not access phone or system contacts. Saved only in this browser, not uploaded or synced by default, and not included in encrypted chat backups. The main Bot sends selected fields to your model only after an explicit preview and confirmation for that turn. Clearing browser data removes these records; other users of a shared device may see them.')}</p>
    {state.failed && <div className="contacts-error" role="alert">{copy('本地数据读取失败。为避免覆盖原数据，暂时不能修改。', 'Local data could not be read. Changes are blocked to protect existing data.')} <button type="button" onClick={reload}>{copy('重试读取', 'Retry loading')}</button></div>}
    {stale && <div className="contacts-error" role="alert">{copy('本地数据已在其他页面或操作中更改。本次修改未保存，请重新读取后重试；表单草稿会保留。', 'Local data changed in another page or action. This change was not saved. Reload before retrying; your form draft will be kept.')} <button type="button" onClick={reload}>{copy('重新读取', 'Reload data')}</button></div>}
    {writeFailed && <p className="contacts-error" role="alert">{copy('保存失败。本次修改未保存，原数据保持不变，请重试。', 'Save failed. This change was not saved; existing data is unchanged. Please retry.')}</p>}
    <form className="contacts-editor" onSubmit={submit}><fieldset disabled={blocked}>
      <legend>{editing ? copy('编辑联系人', 'Edit contact') : copy('新建联系人', 'New contact')}</legend>
      <label>{copy('姓名', 'Name')}<input required autoComplete="name" maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>{copy('电话', 'Phone')}<input type="tel" autoComplete="tel" maxLength={60} value={phone} onChange={event => setPhone(event.target.value)} /></label>
      <label>{copy('邮箱', 'Email')}<input type="email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>{copy('分组（可选）', 'Group (optional)')}<input maxLength={60} value={group} onChange={event => setGroup(event.target.value)} placeholder={copy('例如：家人、朋友、工作', 'For example: Family, Friends, Work')} /></label>
      <button className="contacts-primary" type="submit">{editing ? copy('保存联系人', 'Save contact') : copy('添加联系人', 'Add contact')}</button>
    </fieldset>{editing && <button type="button" onClick={clearForm}>{copy('取消编辑', 'Cancel edit')}</button>}</form>
    {error && <p className="contacts-error" role="alert">{error}</p>}
    <div className="contacts-toolbar"><label>{copy('搜索联系人', 'Search contacts')}<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={copy('姓名、电话或邮箱', 'Name, phone or email')} /></label><label>{copy('按分组筛选', 'Filter by group')}<select value={groupFilter} onChange={event => setGroupFilter(event.target.value)}><option value="">{copy('全部分组', 'All groups')}</option><option value="ungrouped">{copy('未分组', 'Ungrouped')}</option>{groups.map(value => <option key={value} value={`group:${value}`}>{value}</option>)}{selectedGroup && !groups.includes(selectedGroup) && <option value={groupFilter}>{selectedGroup}</option>}</select></label><button type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(value => !value)}>{copy('仅收藏', 'Favorites only')}</button></div>
    <p className="contacts-count" role="status">{copy(`显示 ${visible.length} / ${state.items.length} 位联系人`, `Showing ${visible.length} of ${state.items.length} contacts`)}</p>
    <ul className="contacts-list">{visible.map(({ item, index }) => {
      const tel = contactPhoneHref(item.phone), mail = contactEmailHref(item.email)
      return <li key={`${item.id}-${index}`}><div className="contacts-person"><strong>{item.name}</strong>{item.phone && <small>{item.phone}</small>}{item.email && <small>{item.email}</small>}{contactGroup(item) && <small className="contacts-group">{copy('分组', 'Group')}: {contactGroup(item)}</small>}</div>
        <div className="contacts-actions">{tel && <a href={tel} aria-label={copy(`拨打：${item.name}`, `Call: ${item.name}`)}>{copy('拨打', 'Call')}</a>}{mail && <a href={mail} aria-label={copy(`发邮件：${item.name}`, `Email: ${item.name}`)}>{copy('发邮件', 'Email')}</a>}
          <button type="button" disabled={blocked} aria-label={copy(`收藏联系人：${item.name}`, `Favorite contact: ${item.name}`)} aria-pressed={item.favorite === true} onClick={() => save(state.items.map((row, rowIndex) => rowIndex === index ? { ...row, favorite: row.favorite !== true } : row))}>{item.favorite === true ? '★' : '☆'}</button>
          <button type="button" disabled={blocked} aria-label={copy(`编辑联系人：${item.name}`, `Edit contact: ${item.name}`)} onClick={() => { setEditing({ index, raw: JSON.stringify(item) }); setName(item.name); setPhone(item.phone); setEmail(item.email); setGroup(contactGroup(item)); setError('') }}>{copy('编辑', 'Edit')}</button>
          <button type="button" disabled={blocked} aria-label={copy(`删除联系人：${item.name}`, `Delete contact: ${item.name}`)} onClick={() => { if (save(state.items.filter((_, rowIndex) => rowIndex !== index)) && editing) clearForm() }}>{copy('删除', 'Delete')}</button>
        </div>{((item.phone && !tel) || (item.email && !mail)) && <small className="contacts-notice">{copy('部分联系方式格式不安全或不受支持，仅显示文本。', 'Some contact details are unsafe or unsupported; shown as text only.')}</small>}
      </li>
    })}</ul>
    {!visible.length && !blocked && <p className="contacts-notice">{state.items.length ? copy('没有匹配的联系人。', 'No matching contacts.') : copy('还没有联系人。', 'No contacts yet.')}</p>}
    <p className="contacts-notice">{copy('拨打与发邮件会交给设备支持的应用处理，可能产生费用；不会自动拨号或发送。', 'Call and Email hand off to supported apps on your device and may incur charges. Nothing is dialed or sent automatically.')}</p>
  </section>
}
