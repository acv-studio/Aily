import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { liveQuery } from 'dexie'
import { ArrowLeft, Shirt, ShoppingBag, Footprints, Shuffle, Plus, UserRound, Grid2X2, X, Pencil, Trash2, Camera, Check, Layers, Gem, PersonStanding } from 'lucide-react'
import type { Locale } from './i18n'
import { PersonalStoreNotice, personalToolId, usePersonalItems } from './personalToolsStorage'
import { generateWardrobeOutfit, isWardrobeItem, saveWardrobePhoto, wardrobeCategories, wardrobePhotoDb, WARDROBE_KEY, type WardrobeItem } from './wardrobeData'
import './wardrobe.css'

const profileKey = 'aily.ext.wardrobe.profile.v1'
type Profile = { id: string; name: string }
const validProfile = (value: unknown): value is Profile => !!value && typeof value === 'object' && 'id' in value && value.id === 'owner' && 'name' in value && typeof value.name === 'string'
function slot(category: string) {
  if (['连体装', '连衣裙'].includes(category)) return 'dress'
  if (category === '上装') return 'top'
  if (['下装', '半身裙'].includes(category)) return 'bottom'
  if (['鞋子', '鞋包'].includes(category)) return 'shoes'
  return category
}
function GarmentIcon({ category, size = 24 }: { category: string; size?: number }) {
  if (category === '鞋子' || category === '鞋包') return <Footprints size={size} strokeWidth={1.35}/>
  if (category === '包包') return <ShoppingBag size={size} strokeWidth={1.35}/>
  if (category === '配饰') return <Gem size={size} strokeWidth={1.35}/>
  if (category === '下装') return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 4h16l3 25h-9l-2-15-2 15H5L8 4Z"/><path d="M8 8h16M16 4v10"/></svg>
  if (category === '半身裙') return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M10 5h12l6 23H4l6-23Z"/><path d="M10 9h12M12 9l-3 19M20 9l3 19"/></svg>
  if (slot(category) === 'dress') return <PersonStanding size={size} strokeWidth={1.35}/>
  return <Shirt size={size} strokeWidth={1.35}/>
}
function ClothingVisual({ item, url, preview, label }: { item: WardrobeItem; url?: string; preview: boolean; label: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])
  if (url && !failed) return <img src={url} alt={item.name} onError={() => setFailed(true)}/>
  return <div className="wardrobe-garment-placeholder"><GarmentIcon category={item.category} size={preview ? 65 : 44}/>{preview && <small>{item.color || label}</small>}</div>
}
const emptyForm = { name: '', category: '上装', color: '', season: '四季' }
export default function WardrobeApp({ locale, onClose }: { locale: Locale; onClose?: () => void }) {
  const copy = (zh: string, en: string) => locale === 'en' ? en : zh
  const store = usePersonalItems(WARDROBE_KEY, isWardrobeItem), profile = usePersonalItems(profileKey, validProfile)
  const [page, setPage] = useState<'home' | 'library' | 'profile'>('home'), [category, setCategory] = useState<string | null>(null), [search, setSearch] = useState('')
  const profileReturn = useRef<'home' | 'library'>('home')
  const [selectedIds, setSelectedIds] = useState<string[]>(() => generateWardrobeOutfit(store.items).map(item => item.id))
  const [urls, setUrls] = useState<Record<string, string>>({}), [photoError, setPhotoError] = useState(''), [notice, setNotice] = useState('')
  const [editor, setEditor] = useState<{ item: WardrobeItem | null } | null>(null), [form, setForm] = useState(emptyForm)
  const [photo, setPhoto] = useState<File | null>(null), [removePhoto, setRemovePhoto] = useState(false), [draftUrl, setDraftUrl] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [owner, setOwner] = useState(profile.items[0]?.name || '')
  const mounted = useRef(false), pending = useRef(false), editorPanel = useRef<HTMLElement>(null), nameInput = useRef<HTMLInputElement>(null), picker = useRef<HTMLInputElement>(null), trigger = useRef<HTMLElement | null>(null)
  const blocked = store.blocked || busy
  const title = profile.items[0]?.name || copy('我的衣橱', 'My wardrobe')
  const categoryName = (id: string) => { const entry = wardrobeCategories.find(item => item.id === id); return entry ? copy(entry.zh, entry.en) : id }
  const shownCategories = [...wardrobeCategories.filter(item => wardrobeCategories.indexOf(item) < 6 || store.items.some(clothing => clothing.category === item.id)), ...[...new Set(store.items.map(item => item.category))].filter(id => !wardrobeCategories.some(entry => entry.id === id)).map(id => ({ id, zh: id, en: id }))]
  const libraryCategories = [...wardrobeCategories, ...shownCategories.filter(entry => !wardrobeCategories.some(row => row.id === entry.id))]
  const outfit = selectedIds.map(id => store.items.find(item => item.id === id)).filter((item): item is WardrobeItem => !!item)
  const visible = store.items.filter(item => (category === null || item.category === category) && `${item.name} ${categoryName(item.category)} ${item.category} ${item.color} ${item.season}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const openLibrary = (filter: string | null = null) => { setCategory(filter); setSearch(''); setPage('library') }
  useEffect(() => {
    mounted.current = true; let previous: Record<string, { blob: Blob; url: string }> = {}
    const subscription = liveQuery(() => wardrobePhotoDb.photos.toArray()).subscribe({
      next: rows => {
        if (!mounted.current) return
        const next: typeof previous = {}
        for (const row of rows) next[row.id] = previous[row.id]?.blob === row.blob ? previous[row.id] : { blob: row.blob, url: URL.createObjectURL(row.blob) }
        for (const [id, value] of Object.entries(previous)) if (next[id]?.url !== value.url) URL.revokeObjectURL(value.url)
        previous = next; setUrls(Object.fromEntries(Object.entries(next).map(([id, value]) => [id, value.url]))); setPhotoError('')
      },
      error: () => { if (mounted.current) setPhotoError(copy('衣物照片读取失败；文字记录仍保留，请重新打开重试。', 'Clothing photos could not be loaded. Text records remain; reopen to retry.')) },
    })
    return () => { mounted.current = false; subscription.unsubscribe(); for (const value of Object.values(previous)) URL.revokeObjectURL(value.url) }
  }, [])
  useEffect(() => {
    if (!photo) { setDraftUrl(''); return }
    const url = URL.createObjectURL(photo); setDraftUrl(url); return () => URL.revokeObjectURL(url)
  }, [photo])
  const requestClose = () => {
    if (pending.current) return
    const initial = editor?.item || emptyForm
    const changed = photo || removePhoto || ['name', 'category', 'color', 'season'].some(key => form[key as keyof typeof form] !== initial[key as keyof typeof form])
    if (changed && !window.confirm(copy('放弃尚未保存的衣物修改？', 'Discard unsaved clothing changes?'))) return
    setEditor(null); setPhoto(null); setError(''); trigger.current?.focus()
  }
  useEffect(() => { if (editor) nameInput.current?.focus() }, [editor])
  useEffect(() => {
    if (!editor) return
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); requestClose() }
      if (event.key === 'Tab') {
        const nodes = Array.from(editorPanel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([hidden]),select:not(:disabled),textarea:not(:disabled)') || [])
        const first = nodes[0], last = nodes.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', keyboard, true); return () => window.removeEventListener('keydown', keyboard, true)
  }, [editor, form, photo, removePhoto, busy])
  const openEditor = (item: WardrobeItem | null, element?: HTMLElement) => {
    trigger.current = element || null; setForm(item ? { name: item.name, category: item.category, color: item.color, season: item.season } : { ...emptyForm, category: category ?? emptyForm.category }); setPhoto(null); setRemovePhoto(false); setError(''); setEditor({ item })
  }
  const cleanPhoto = async (id: string | undefined, records: WardrobeItem[]) => {
    if (id && !records.some(item => item.photoId === id)) await wardrobePhotoDb.photos.delete(id)
  }
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (pending.current || store.blocked || !form.name.trim()) return
    const current = editor?.item && store.items.find(item => item.id === editor.item?.id)
    if (editor?.item && JSON.stringify(current) !== JSON.stringify(editor.item)) { setError(copy('这件衣物已经更改，请保留草稿，关闭后重新读取。', 'This item changed. Keep your draft, close and reload.')); return }
    pending.current = true; setBusy(true); setError(''); let addedPhoto: string | undefined
    try {
      if (photo) addedPhoto = await saveWardrobePhoto(photo)
      if (!mounted.current) { if (addedPhoto) await wardrobePhotoDb.photos.delete(addedPhoto); return }
      const item: WardrobeItem = { ...(editor?.item || {}), id: editor?.item?.id || personalToolId(), ...form, name: form.name.trim(), color: form.color.trim() }
      if (addedPhoto) item.photoId = addedPhoto; else if (removePhoto) delete item.photoId
      const records = editor?.item ? store.items.map(row => row.id === item.id ? item : row) : [...store.items, item]
      if (!store.save(records)) { if (addedPhoto) await wardrobePhotoDb.photos.delete(addedPhoto); return }
      setEditor(null); setPhoto(null); openLibrary(item.category); setNotice(copy('衣物已保存。', 'Clothing saved.')); trigger.current?.focus()
      if (!selectedIds.length) setSelectedIds(generateWardrobeOutfit(records).map(row => row.id))
      try { if (editor?.item?.photoId !== item.photoId) await cleanPhoto(editor?.item?.photoId, records) } catch { setPhotoError(copy('衣物已保存，但旧照片清理失败。文字与新照片未丢失。', 'Clothing saved, but old photo cleanup failed. The record and new photo are retained.')) }
    } catch { if (mounted.current) setError(copy('照片处理或保存失败，请检查格式和本机空间。单张照片不超过 5MB，草稿已保留。', 'Photo processing or saving failed. Check format and local storage. Photos must be under 5MB; your draft is retained.')) }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  const remove = async (item: WardrobeItem) => {
    if (blocked || pending.current || !window.confirm(copy(`移除「${item.name}」及其本机衣橱照片？无法撤销，但不会删除系统相册原件。`, `Remove “${item.name}” and its wardrobe photo? This cannot be undone. Originals in system Photos are untouched.`))) return
    const records = store.items.filter(row => row.id !== item.id)
    if (!store.save(records)) return
    setSelectedIds(ids => ids.filter(id => id !== item.id)); setNotice(copy('已移除衣物，系统照片未改动。', 'Clothing removed. System photos are unchanged.'))
    try { await cleanPhoto(item.photoId, records) } catch { if (mounted.current) setPhotoError(copy('衣物已移除，但照片清理失败，请重新打开重试。', 'Clothing removed, but photo cleanup failed. Reopen to retry.')) }
  }
  const choose = (item: WardrobeItem) => {
    const targetSlot = slot(item.category)
    setSelectedIds(ids => [...ids.filter(id => { const old = store.items.find(row => row.id === id); if (!old) return false; const oldSlot = slot(old.category); return oldSlot !== targetSlot && !(targetSlot === 'dress' && ['top', 'bottom'].includes(oldSlot)) && !(['top', 'bottom'].includes(targetSlot) && oldSlot === 'dress') }), item.id])
    setNotice(copy('已加入左侧搭配预览。', 'Added to the outfit preview.'))
  }
  const look = () => { setSelectedIds(generateWardrobeOutfit(store.items, selectedIds).map(item => item.id)); setNotice(copy('已用衣橱里的衣物重新组合。', 'A new combination from your wardrobe.')) }
  const garment = (item: WardrobeItem, preview = false) => <ClothingVisual item={item} url={item.photoId ? urls[item.photoId] : undefined} preview={preview} label={categoryName(item.category)}/>
  return <section className={`wardrobe-app wardrobe-page-${page}`} aria-label={copy('穿搭衣橱', 'Wardrobe')}>
    <header className="wardrobe-header" aria-hidden={editor ? true : undefined} inert={!!editor}><div><button className="wardrobe-back" disabled={busy} aria-label={copy(page !== 'home' ? '返回衣橱' : '返回 Aily', page !== 'home' ? 'Back to wardrobe' : 'Back to Aily')} onClick={() => { if (page === 'profile') setPage(profileReturn.current); else if (page === 'library') { setPage('home'); setSearch('') } else onClose?.() }}><ArrowLeft size={19}/></button><h2>{page === 'library' ? category === null ? copy('全部衣物', 'All clothes') : categoryName(category) : page === 'profile' ? copy('我的衣橱', 'My wardrobe') : title}</h2></div><div className="wardrobe-header-actions"><button className="wardrobe-settings" disabled={busy} aria-label={copy('衣橱设置', 'Wardrobe settings')} aria-pressed={page === 'profile'} onClick={() => { if (page !== 'profile') profileReturn.current = page; setOwner(profile.items[0]?.name || ''); setPage('profile') }}><UserRound size={21}/></button><button className="wardrobe-add" disabled={blocked} aria-label={copy('添加衣物', 'Add clothing')} onClick={event => openEditor(null, event.currentTarget)}><Shirt size={24}/><Plus size={13}/></button></div></header>
    <main className="wardrobe-scroll" aria-hidden={editor ? true : undefined} inert={!!editor}>
      <PersonalStoreNotice store={store} copy={copy}/>{photoError && <p className="wardrobe-error" role="alert">{photoError}</p>}
      {page === 'home' && <><div className="wardrobe-home-grid"><section className="wardrobe-outfit" aria-label={copy('当前搭配预览', 'Current outfit preview')}><div className="wardrobe-outfit-heading"><small>{copy('今日穿搭', 'TODAY’S LOOK')}</small><button disabled={blocked || !store.items.length} aria-label={copy('随机生成穿搭', 'Create random outfit')} onClick={look}><Shuffle size={17}/></button></div><div className="wardrobe-outfit-stack">{outfit.length ? outfit.map(item => <button className="wardrobe-outfit-piece" data-slot={slot(item.category)} key={item.id} disabled={blocked} aria-label={copy(`更换 ${item.name}`, `Change ${item.name}`)} onClick={() => openLibrary(item.category)}>{garment(item, true)}<span>{item.name}</span></button>) : <div className="wardrobe-outfit-empty"><Shirt size={55} strokeWidth={1}/><strong>{copy('从一件喜欢的衣服开始', 'Start with a favorite piece')}</strong><small>{copy('添加衣物照片，组合你的日常穿搭。', 'Add clothing photos and build your everyday looks.')}</small><button disabled={blocked} onClick={event => openEditor(null, event.currentTarget)}><Plus size={16}/>{copy('添加衣物', 'Add clothing')}</button></div>}</div></section><section className="wardrobe-categories" aria-label={copy('衣物分类', 'Clothing categories')}><div className="wardrobe-categories-heading"><h3>{copy('我的衣服', 'My clothes')}</h3><span>{store.items.length}</span></div>{shownCategories.map(entry => <button className="wardrobe-category-card" key={entry.id} disabled={blocked} aria-label={`${categoryName(entry.id)} · ${store.items.filter(item => item.category === entry.id).length}`} onClick={() => openLibrary(entry.id)}><GarmentIcon category={entry.id}/><span>{categoryName(entry.id)}</span><b>{store.items.filter(item => item.category === entry.id).length}</b></button>)}</section></div><p className="wardrobe-home-note">{copy('点击左侧衣物更换搭配，右侧分类管理你的衣橱。', 'Tap a piece to change the look. Use categories to manage your clothes.')}</p></>}
      {page === 'library' && <section className="wardrobe-category-page" aria-label={copy('全部衣物分类库', 'All-clothes library')}><div className="wardrobe-filters" role="group" aria-label={copy('按分类筛选', 'Filter by category')}><button aria-pressed={category === null} onClick={() => setCategory(null)}>{copy('全部', 'All')} <span>{store.items.length}</span></button>{libraryCategories.map(entry => <button key={entry.id} aria-pressed={category === entry.id} onClick={() => setCategory(entry.id)}>{categoryName(entry.id)} <span>{store.items.filter(item => item.category === entry.id).length}</span></button>)}</div><div className="wardrobe-category-summary"><span>{copy(`${visible.length} 件衣物`, `${visible.length} items`)}</span><button disabled={blocked} onClick={event => openEditor(null, event.currentTarget)}><Plus size={16}/>{copy('添加', 'Add')}</button></div><label className="wardrobe-search">{copy('搜索衣物', 'Search clothing')}<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={copy('名称、颜色或季节', 'Name, color or season')}/></label><div className="wardrobe-items">{visible.map(item => <article key={item.id}><button className="wardrobe-item-photo" disabled={blocked} aria-label={copy(`编辑 ${item.name}`, `Edit ${item.name}`)} onClick={event => openEditor(item, event.currentTarget)}>{garment(item)}</button><div className="wardrobe-item-copy"><h3>{item.name}</h3><p>{categoryName(item.category)} · {item.color || copy('未填颜色', 'Color not set')} · {item.season}</p></div><button className="wardrobe-look-choice" disabled={blocked} aria-pressed={selectedIds.includes(item.id)} onClick={() => choose(item)}>{selectedIds.includes(item.id) ? <Check size={16}/> : <Plus size={16}/>} {copy(selectedIds.includes(item.id) ? '已在穿搭' : '加入穿搭', selectedIds.includes(item.id) ? 'In look' : 'Add to look')}</button><div className="wardrobe-item-actions"><button disabled={blocked} aria-label={copy(`编辑衣物：${item.name}`, `Edit clothing: ${item.name}`)} onClick={event => openEditor(item, event.currentTarget)}><Pencil size={15}/></button><button disabled={blocked} aria-label={copy(`移除衣物：${item.name}`, `Remove clothing: ${item.name}`)} onClick={() => void remove(item)}><Trash2 size={15}/></button></div></article>)}</div>{!visible.length && <div className="wardrobe-list-empty"><GarmentIcon category={category ?? '上装'} size={42}/><p>{copy(search ? '没有匹配的衣物。' : category === null ? '衣橱里还没有衣物。' : '这个分类还没有衣物。', search ? 'No matching clothing.' : category === null ? 'No clothing in your wardrobe yet.' : 'No clothing in this category yet.')}</p></div>}</section>}
      {page === 'profile' && <section className="wardrobe-profile"><div className="wardrobe-profile-card"><UserRound size={32}/><h3>{copy('让衣橱属于你', 'Make this wardrobe yours')}</h3><PersonalStoreNotice store={profile} copy={copy}/><form onSubmit={event => { event.preventDefault(); if (profile.save([{ id: 'owner', name: owner.trim() }])) setNotice(copy('衣橱名称已保存。', 'Wardrobe name saved.')) }}><label>{copy('衣橱名称', 'Wardrobe name')}<input maxLength={60} value={owner} onChange={event => setOwner(event.target.value)} placeholder={copy('例如：小林的衣橱', 'e.g. Alex’s wardrobe')}/></label><button disabled={profile.blocked || busy}>{copy('保存名称', 'Save name')}</button></form></div><div className="wardrobe-profile-card"><Layers size={25}/><h3>{copy('本机衣橱', 'On-device wardrobe')}</h3><p>{copy(`已保存 ${store.items.length} 件衣物。衣物名称、分类、颜色与季节会按 Aily 的应用数据规则供主 Bot 查询；衣物照片只保存在本机，不发送给模型，不包含在聊天备份中。清除应用数据会移除衣橱，系统相册原件不受影响。`, `${store.items.length} saved items. Names, categories, colors and seasons follow Aily’s main-Bot app-data access rules. Clothing photos stay on-device, are not sent to models and are excluded from chat backups. Clearing app data removes this wardrobe, not originals in Photos.`)}</p><p>{copy('照片单张不超过 5MB，总容量 50MB。旧版“上装、下装、外套、鞋包、配饰”记录完整保留。', 'Photos: up to 5MB each, 50MB total. Legacy clothing categories and records are retained.')}</p></div></section>}
    </main>
    <p className={`wardrobe-status${notice ? ' has-message' : ''}`} role="status" aria-live="polite">{notice}</p>
    <nav className="wardrobe-bottom-nav" aria-label={copy('衣橱导航', 'Wardrobe navigation')} aria-hidden={editor ? true : undefined} inert={!!editor}><button disabled={busy} aria-current={page === 'home' ? 'page' : undefined} onClick={() => { setPage('home'); setSearch('') }}><Shirt size={23}/><span>{copy('穿搭', 'Outfits')}</span></button><button disabled={busy} aria-current={page === 'library' ? 'page' : undefined} onClick={() => openLibrary()}><Grid2X2 size={23}/><span>{copy('分类', 'Categories')}</span></button></nav>
    {editor && <div className="wardrobe-modal-backdrop"><section className="wardrobe-editor" ref={editorPanel} role="dialog" aria-modal="true" aria-label={copy(editor.item ? '编辑衣物' : '添加衣物', editor.item ? 'Edit clothing' : 'Add clothing')}><header><h3>{copy(editor.item ? '编辑衣物' : '添加衣物', editor.item ? 'Edit clothing' : 'Add clothing')}</h3><button disabled={busy} aria-label={copy('关闭衣物编辑', 'Close clothing editor')} onClick={requestClose}><X size={21}/></button></header><form onSubmit={event => void save(event)}><button type="button" className="wardrobe-photo-picker" disabled={busy || store.blocked} onClick={() => picker.current?.click()}>{draftUrl || !removePhoto && editor.item?.photoId && urls[editor.item.photoId] ? <img src={draftUrl || urls[editor.item!.photoId!]} alt={copy('衣物照片预览', 'Clothing photo preview')}/> : <Camera size={32}/>}<span>{copy('添加或更换照片', 'Add or change photo')}</span></button><input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden style={{ display: 'none' }} aria-label={copy('选择衣物照片', 'Choose clothing photo')} disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) { setPhoto(file); setRemovePhoto(false) } }}/>{(photo || editor.item?.photoId && !removePhoto) && <button className="wardrobe-remove-photo" type="button" disabled={busy} onClick={() => { setPhoto(null); setRemovePhoto(true) }}>{copy('移除衣物照片', 'Remove clothing photo')}</button>}<fieldset disabled={busy || store.blocked}><label className="wardrobe-wide">{copy('衣物名称', 'Clothing name')}<input ref={nameInput} required maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })}/></label><label>{copy('分类', 'Category')}<select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}>{[...wardrobeCategories, ...shownCategories.filter(entry => !wardrobeCategories.some(row => row.id === entry.id))].map(entry => <option key={entry.id} value={entry.id}>{categoryName(entry.id)}</option>)}</select></label><label>{copy('季节', 'Season')}<select value={form.season} onChange={event => setForm({ ...form, season: event.target.value })}>{['四季', '春秋', '夏季', '冬季', ...(!['四季', '春秋', '夏季', '冬季'].includes(form.season) ? [form.season] : [])].map(value => <option key={value} value={value}>{locale === 'en' ? ({ '四季': 'All seasons', '春秋': 'Spring / Autumn', '夏季': 'Summer', '冬季': 'Winter' }[value] || value) : value}</option>)}</select></label><label className="wardrobe-wide">{copy('颜色', 'Color')}<input maxLength={60} value={form.color} onChange={event => setForm({ ...form, color: event.target.value })} placeholder={copy('例如：奶白、浅绿', 'e.g. ivory, mint')}/></label></fieldset><PersonalStoreNotice store={store} copy={copy}/>{error && <p className="wardrobe-error" role="alert">{error}</p>}<button className="wardrobe-save" disabled={busy || store.blocked || !form.name.trim()}>{busy ? copy('正在保存…', 'Saving…') : copy(editor.item ? '保存修改' : '加入衣橱', editor.item ? 'Save changes' : 'Add to wardrobe')}</button><small>{copy('照片仅复制到衣橱，不会修改系统相册。', 'Photos are copied to your wardrobe. System originals stay unchanged.')}</small></form></section></div>}
  </section>
}
