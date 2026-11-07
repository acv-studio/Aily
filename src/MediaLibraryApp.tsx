import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { liveQuery } from 'dexie'
import { Camera, MediaTypeSelection } from '@capacitor/camera'
import { Capacitor } from '@capacitor/core'
import { Heart, Music2, ChevronLeft, ChevronRight, Trash2, FolderPlus, Pencil, Ellipsis, Plus, Search, ShieldCheck, Images } from 'lucide-react'
import { StatusBar, Style } from '@capacitor/status-bar'
import { resolvedTheme, useTheme } from './theme'
import { addLibraryMedia, mediaDb, type LibraryMedia, type MediaKind } from './mediaLibrary'
import './mediaLibrary.css'
import './appleAlbum.css'

type Copy = (zh: string, en: string) => string
export default function MediaLibraryApp({ kind, copy, onOpenMedia }: { kind: MediaKind; copy: Copy; onOpenMedia?: (item: LibraryMedia) => void }) {
  const { resolved: appTheme } = useTheme()
  const [items, setItems] = useState<LibraryMedia[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [activeId, setActiveId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([]), [selecting, setSelecting] = useState(false), [collection, setCollection] = useState('')
  const [renameId, setRenameId] = useState<string | null>(null), [renameValue, setRenameValue] = useState('')
  const [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off')
  const [menuId, setMenuId] = useState<string | null>(null)
  const menuTitle = useId(), renameTitle = useId()
  const returnFocus = useRef<HTMLElement | null>(null), photoReturnFocus = useRef<HTMLElement | null>(null), menuCancel = useRef<HTMLButtonElement>(null), renameInput = useRef<HTMLInputElement>(null), viewerBack = useRef<HTMLButtonElement>(null)
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null), viewerWasOpen = useRef(false)
  const audio = useRef<HTMLAudioElement>(null), mounted = useRef(false), pending = useRef(false), urlMap = useRef<Record<string, string>>({}), rows = useRef<LibraryMedia[]>([])
  useEffect(() => {
    mounted.current = true
    const subscription = liveQuery(() => mediaDb.items.where('kind').equals(kind).reverse().sortBy('addedAt')).subscribe({
      next: data => {
        if (!mounted.current) return
        const next: Record<string, string> = {}
        for (const item of data) next[item.id] = urlMap.current[item.id] || URL.createObjectURL(item.blob)
        for (const [id, url] of Object.entries(urlMap.current)) if (!next[id]) URL.revokeObjectURL(url)
        urlMap.current = next; rows.current = data; setUrls(next); setItems(data); setLoading(false)
        setSelected(previous => previous.filter(id => next[id]))
        setActiveId(previous => previous && next[previous] ? previous : null)
        setMenuId(previous => previous && next[previous] ? previous : null)
        setRenameId(previous => previous && next[previous] ? previous : null)
      },
      error: () => { if (mounted.current) { setLoading(false); setError(copy('媒体库读取失败，请重新打开此软件；原数据未被覆盖。', 'Unable to read the library. Reopen this tool; existing data is unchanged.')) } },
    })
    return () => { mounted.current = false; subscription.unsubscribe(); audio.current?.pause(); for (const url of Object.values(urlMap.current)) URL.revokeObjectURL(url); urlMap.current = {} }
  }, [kind])
  const collections = [...new Set(items.map(item => item.collection).filter(Boolean))].sort()
  const visible = items.filter(item => (filter === 'all' || filter === 'favorites' ? filter !== 'favorites' || item.favorite : item.collection === filter.slice(11)) && (!search || item.name.toLowerCase().includes(search.toLowerCase())))
  const active = items.find(item => item.id === activeId)
  const menuItem = items.find(item => item.id === menuId)
  const albumOverlay = kind === 'album' && (!!menuItem || !!renameId)
  const restoreFocus = () => requestAnimationFrame(() => { if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }) })
  const closeMenu = (restore = true) => { setMenuId(null); if (restore) restoreFocus() }
  const openMenu = (item: LibraryMedia, trigger?: HTMLElement) => { if (busy || selecting) return; returnFocus.current = trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null); setMenuId(item.id) }
  const openPhoto = (item: LibraryMedia, trigger: HTMLElement) => {
    if (busy) return
    if (kind === 'album' && selecting) { setSelected(previous => previous.includes(item.id) ? previous.filter(id => id !== item.id) : [...previous, item.id]); return }
    if (kind === 'music' && onOpenMedia) { onOpenMedia(item); return }
    photoReturnFocus.current = trigger; setActiveId(item.id)
  }
  const photoDate = (item: LibraryMedia) => new Date(item.addedAt).toLocaleDateString(copy('zh-CN', 'en-US'), { month: 'long', day: 'numeric' })
  const closePhoto = () => { setActiveId(null); requestAnimationFrame(() => { if (photoReturnFocus.current?.isConnected) photoReturnFocus.current.focus({ preventScroll: true }) }) }
  const operate = async (work: () => Promise<unknown>) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try { await work() } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : copy('操作未保存，请重试。', 'Changes were not saved. Please retry.')) }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  const saveRename = (event: FormEvent) => {
    event.preventDefault()
    if (!renameValue.trim() || !renameId || busy) return
    const id = renameId
    void operate(async () => {
      const current = await mediaDb.items.get(id)
      if (!current || current.kind !== kind) throw new Error(copy('此媒体已移除，本次名称未保存。', 'This media was removed. Its name was not saved.'))
      await mediaDb.items.update(id, { name: renameValue.trim().slice(0, 100) })
      setRenameId(null); restoreFocus()
    })
  }
  const importFiles = async (files: File[]) => {
    await operate(async () => { if (mounted.current) await addLibraryMedia(kind, files.map(file => ({ name: file.name, blob: file }))) })
  }
  const choosePhotos = () => operate(async () => {
    const result = await Camera.chooseFromGallery({ mediaType: MediaTypeSelection.Photo, allowMultipleSelection: true, limit: 20 })
    const files = await Promise.all(result.results.map(async (media, index) => {
      if (!media.webPath) throw new Error(copy('照片无法读取，请重新选择。', 'Unable to read the selected photo. Try again.'))
      const response = await fetch(media.webPath)
      if (!response.ok) throw new Error(copy('照片无法读取，请重新选择。', 'Unable to read the selected photo. Try again.'))
      const blob = await response.blob()
      return { name: `${copy('照片', 'Photo')} ${new Date().toLocaleDateString()} ${index + 1}`, blob }
    }))
    if (mounted.current && files.length) await addLibraryMedia('album', files)
  })
  const favorite = (item: LibraryMedia) => operate(() => mediaDb.transaction('rw', mediaDb.items, async () => {
    const current = await mediaDb.items.get(item.id)
    if (current) await mediaDb.items.update(item.id, { favorite: !current.favorite })
  }))
  const remove = (ids: string[]) => {
    if (pending.current || !ids.length || !window.confirm(copy(`从 Aily 移除 ${ids.length} 项？不会删除系统相册或文件中的原件。`, `Remove ${ids.length} items from Aily? Originals in Photos or Files are not deleted.`))) return
    void operate(async () => { if (ids.includes(activeId || '')) audio.current?.pause(); await mediaDb.items.bulkDelete(ids) })
  }
  const group = () => {
    if (!selected.length || !collection.trim()) return
    void operate(() => mediaDb.transaction('rw', mediaDb.items, async () => {
      for (const id of selected) await mediaDb.items.update(id, { collection: collection.trim().slice(0, 60) })
      setCollection(''); setSelected([]); setSelecting(false)
    }))
  }
  const navigate = (direction: number) => {
    const list = visible.length ? visible : items
    if (!list.length) return
    const index = list.findIndex(item => item.id === activeId)
    audio.current?.pause(); setActiveId(list[(index + direction + list.length) % list.length].id)
  }
  const ended = () => {
    if (repeat === 'one') { if (audio.current) { audio.current.currentTime = 0; void audio.current.play().catch(() => setError(copy('播放失败，请手动重试。', 'Playback failed. Please try again.'))) }; return }
    const index = visible.findIndex(item => item.id === activeId)
    if (index >= 0 && (index < visible.length - 1 || repeat === 'all')) setActiveId(visible[(index + 1) % visible.length].id)
  }
  // Auto-start only when the user selected a song, or when the current song ended.
  useEffect(() => {
    if (onOpenMedia || kind !== 'music' || !activeId || !urls[activeId]) return
    const player = audio.current
    if (player) { player.load(); void player.play().catch(() => { /* Native controls remain available when autoplay is blocked. */ }) }
  }, [activeId, urls[activeId || ''], kind])
  useEffect(() => {
    if (kind !== 'album') return
    if (renameId) { renameInput.current?.focus({ preventScroll: true }); renameInput.current?.select() }
    else if (menuId) menuCancel.current?.focus({ preventScroll: true })
    else if (activeId && !viewerWasOpen.current) viewerBack.current?.focus({ preventScroll: true })
    viewerWasOpen.current = !!activeId
  }, [!!activeId, menuId, renameId, kind])
  useEffect(() => {
    if (kind !== 'album' || (!activeId && !menuId && !renameId)) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); if (busy) return
        if (renameId) { setRenameId(null); restoreFocus() }
        else if (menuId) closeMenu()
        else closePhoto()
      } else if (activeId && !albumOverlay && !busy && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !(event.target instanceof Element && event.target.closest('input,textarea,select'))) {
        event.preventDefault(); navigate(event.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [activeId, menuId, renameId, kind, busy, visible])
  useEffect(() => {
    if (kind !== 'album' || !activeId || !Capacitor.isNativePlatform()) return
    void StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
    return () => { void StatusBar.setStyle({ style: resolvedTheme() === 'light' ? Style.Light : Style.Dark }).catch(() => {}) }
  }, [kind, !!activeId, appTheme])

  const album = kind === 'album'
  return <div className={`media-library-app media-library-${kind}${album ? ' apple-album-library' : ''}`}>
    <div className="album-library-content" inert={album && (!!active || albumOverlay)} aria-hidden={album && (!!active || albumOverlay) || undefined}>
      {album && <header className="album-library-summary"><p>{copy('本机照片图库', 'ON-DEVICE PHOTO LIBRARY')}</p><h3>{copy('最近添加', 'Recently added')}</h3><small>{copy(`${items.length} 张照片`, `${items.length} photos`)}</small></header>}
      {!album && <p className="media-privacy">{copy('选中的媒体会复制到 Aily 本机媒体库，关闭后仍保留；不上传、不包含在聊天备份中。卸载或清除应用数据可能丢失。支持本地音频，不读取 Apple Music 受保护歌曲。', 'Selected media is copied to Aily’s on-device library and retained after closing, without uploading or chat backup. Uninstalling or clearing data may remove it. Local audio only; protected Apple Music tracks cannot be imported.')}</p>}
      <div className="media-library-toolbar">
        {album && Capacitor.isNativePlatform() ? <button className="album-import-button" disabled={busy} aria-label={copy('从系统相册添加', 'Add from Photos')} onClick={() => void choosePhotos()}><Plus size={18}/>{copy('添加照片', 'Add photos')}</button> : <label className="media-import">{album && <Plus size={18}/>} {copy(album ? '添加照片' : '添加本地音乐', album ? 'Add photos' : 'Add local music')}<input type="file" multiple accept={album ? 'image/*' : 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac'} disabled={busy} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void importFiles(files) }}/></label>}
        <button disabled={busy || !items.length} aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setSelected([]); setMenuId(null) }}>{copy(selecting ? '完成' : '多选', selecting ? 'Done' : 'Select')}</button>
      </div>
      {album && <details className="album-privacy-details"><summary><ShieldCheck size={15}/><span>{copy('仅保存在本机', 'Only on this device')}</span></summary><p className="media-privacy">{copy('添加的照片会复制到 Aily 本机媒体库，不上传、不进入聊天备份；关闭后保留。这里移除的只是 Aily 副本，不会删除系统相册原件；卸载或清除应用数据可能移除这些副本。照片按导入时间排列。', 'Photos are copied into Aily on this device, without uploading or chat backup. Removing them here deletes only Aily copies, never device Photos originals. Uninstalling or clearing app data may remove these copies. Dates reflect import time.')}</p></details>}
      <label className="media-search">{copy(album ? '搜索照片' : '搜索媒体', album ? 'Search photos' : 'Search library')}<span className="album-search-field">{album && <Search size={17}/>}<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={copy(album ? '搜索照片名称' : '按名称搜索', album ? 'Search photo names' : 'Search by name')}/></span></label>
      <div className="media-filter-row"><button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>{copy('全部', 'All')} · {items.length}</button><button aria-pressed={filter === 'favorites'} onClick={() => setFilter('favorites')}>{album && <Heart size={14}/>} {copy('收藏', 'Favorites')}</button>{collections.map(name => <button key={name} aria-pressed={filter === `collection:${name}`} onClick={() => setFilter(`collection:${name}`)}>{name}</button>)}</div>
      {selecting && <section className="media-batch" aria-label={copy('批量管理', 'Manage selection')}><span>{copy(`已选 ${selected.length} 项`, `${selected.length} selected`)}</span><label>{copy(album ? '相簿名称' : '播放列表名称', album ? 'Album name' : 'Playlist name')}<input value={collection} maxLength={60} onChange={event => setCollection(event.target.value)}/></label><button disabled={busy || !selected.length || !collection.trim()} onClick={group}><FolderPlus size={16}/>{copy('归入列表', 'Add to collection')}</button><button disabled={busy || !selected.length} onClick={() => remove(selected)}>{copy('移除所选', 'Remove selected')}</button></section>}
      {!album && renameId && <form className="media-batch" onSubmit={saveRename}><label>{copy('媒体名称', 'Media name')}<input value={renameValue} maxLength={100} required onChange={event => setRenameValue(event.target.value)}/></label><button type="submit" disabled={busy}>{copy('保存名称', 'Save name')}</button><button type="button" disabled={busy} onClick={() => setRenameId(null)}>{copy('取消', 'Cancel')}</button></form>}
      {error && <p role="alert" className="media-error">{error}</p>}{loading && <p role="status">{copy('正在读取媒体库…', 'Loading library…')}</p>}{busy && <p role="status">{copy('正在处理…', 'Working…')}</p>}
      {album && visible.length > 0 && <div className="album-grid-heading"><h4>{filter === 'favorites' ? copy('我的收藏', 'Favorites') : filter.startsWith('collection:') ? filter.slice(11) : copy('所有照片', 'All photos')}</h4><span>{visible.length}</span></div>}
      <div className={album ? 'media-photo-grid' : 'media-track-list'}>{visible.map(item => <article key={item.id} onContextMenu={event => { if (album && !selecting) { event.preventDefault(); openMenu(item, event.currentTarget) } }}>
        {selecting && <label className="media-selection"><input type="checkbox" disabled={busy} checked={selected.includes(item.id)} aria-label={copy(`选择 ${item.name}`, `Select ${item.name}`)} onChange={event => setSelected(previous => event.target.checked ? [...new Set([...previous, item.id])] : previous.filter(id => id !== item.id))}/></label>}
        <button className="media-open" disabled={busy} aria-label={copy(album && selecting ? `选择照片 ${item.name}` : `打开 ${item.name}`, album && selecting ? `Select photo ${item.name}` : `Open ${item.name}`)} onClick={event => openPhoto(item, event.currentTarget)}>{album ? <img loading="lazy" src={urls[item.id]} alt={item.name}/> : <Music2 size={24}/>}<span className={album ? 'album-photo-name' : undefined}>{item.name}</span>{!album && <small>{(item.blob.size / 1024 / 1024).toFixed(1)} MB{item.collection ? ` · ${item.collection}` : ''}</small>}</button>
        {album ? <>{item.favorite && <span className="album-favorite-badge" aria-hidden="true"><Heart size={14} fill="currentColor"/></span>}{!selecting && <button className="album-more-button" disabled={busy} aria-label={copy(`照片操作 ${item.name}`, `Photo options ${item.name}`)} aria-haspopup="dialog" onClick={event => openMenu(item, event.currentTarget)}><Ellipsis size={18}/></button>}</> : <div className="media-item-actions"><button disabled={busy} aria-label={copy(`重命名 ${item.name}`, `Rename ${item.name}`)} onClick={event => { returnFocus.current = event.currentTarget; setRenameId(item.id); setRenameValue(item.name) }}><Pencil size={16}/></button><button disabled={busy} aria-pressed={item.favorite} aria-label={copy(`收藏 ${item.name}`, `Favorite ${item.name}`)} onClick={() => void favorite(item)}><Heart size={16} fill={item.favorite ? 'currentColor' : 'none'}/></button><button disabled={busy} aria-label={copy(`移除 ${item.name}`, `Remove ${item.name}`)} onClick={() => remove([item.id])}><Trash2 size={16}/></button></div>}
      </article>)}</div>
      {!loading && !visible.length && <div className={album ? 'album-empty-state' : undefined}>{album && <Images size={38}/>}<p className="media-empty">{copy(items.length ? '没有符合条件的媒体。' : '添加你喜欢的照片或音乐，建立自己的媒体库。', items.length ? 'No matching media.' : 'Add your favorite photos or music to build your library.')}</p></div>}
      {album && items.length > 0 && <p className="album-library-footer">{copy(`${items.length} 张照片 · 仅本机保存`, `${items.length} photos · Stored on this device`)}</p>}
    </div>
    {!album && active && <section className="media-player" aria-label={copy('正在播放', 'Now playing')}><strong>{active.name}</strong><audio ref={audio} controls preload="metadata" src={urls[active.id]} aria-label={active.name} onEnded={ended} onError={() => setError(copy('此音频格式暂无法播放，请选择 MP3 或 M4A。', 'This audio cannot be played. Try MP3 or M4A.'))}/><div><button onClick={() => navigate(-1)}>{copy('上一首', 'Previous')}</button><button onClick={() => setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')}>{copy(({ off: '顺序播放', all: '列表循环', one: '单曲循环' })[repeat], ({ off: 'In order', all: 'Repeat all', one: 'Repeat one' })[repeat])}</button><button onClick={() => navigate(1)}>{copy('下一首', 'Next')}</button><button onClick={() => { audio.current?.pause(); setActiveId(null) }}>{copy('收起播放器', 'Close player')}</button></div></section>}
    {album && active && <section className="media-photo-viewer album-photo-viewer" role="dialog" aria-modal="true" aria-label={copy('查看照片', 'Photo viewer')} inert={albumOverlay} aria-hidden={albumOverlay || undefined}><header><button ref={viewerBack} disabled={busy || albumOverlay} onClick={closePhoto} aria-label={copy('返回相册', 'Back to album')}><ChevronLeft size={25}/></button><div><strong>{photoDate(active)}</strong><small>{new Date(active.addedAt).toLocaleTimeString(copy('zh-CN', 'en-US'), { hour: '2-digit', minute: '2-digit' })} · {copy('导入时间', 'Import time')}</small></div><button disabled={busy || albumOverlay} aria-label={copy('更多照片操作', 'More photo options')} onClick={event => openMenu(active, event.currentTarget)}><Ellipsis size={24}/></button></header>
      <div className="album-viewer-image-wrap" onPointerDown={event => { if (!event.isPrimary || event.button !== 0 || busy || albumOverlay) { swipe.current = null; return }; swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerUp={event => { const start = swipe.current; swipe.current = null; if (!start || start.id !== event.pointerId) return; const dx = event.clientX - start.x, dy = event.clientY - start.y; if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.25) navigate(dx < 0 ? 1 : -1) }} onPointerCancel={() => { swipe.current = null }} onLostPointerCapture={() => { swipe.current = null }}><img className="album-viewer-image" key={active.id} src={urls[active.id]} alt={active.name} draggable={false}/>{error && <p role="alert" className="media-error">{error}</p>}</div>
      <footer><div className="album-viewer-toolbar"><button disabled={busy || albumOverlay || visible.length < 2} onClick={() => navigate(-1)} aria-label={copy('上一张', 'Previous photo')}><ChevronLeft size={22}/></button><button disabled={busy || albumOverlay} aria-pressed={active.favorite} aria-label={copy('收藏', 'Favorite')} onClick={() => void favorite(active)}><Heart size={24} fill={active.favorite ? 'currentColor' : 'none'}/></button><button disabled={busy || albumOverlay} className="album-action-danger" aria-label={copy('移除当前照片', 'Remove current photo')} onClick={() => remove([active.id])}><Trash2 size={23}/></button><button disabled={busy || albumOverlay || visible.length < 2} onClick={() => navigate(1)} aria-label={copy('下一张', 'Next photo')}><ChevronRight size={22}/></button></div><p className="album-viewer-counter">{Math.max(1, visible.findIndex(item => item.id === active.id) + 1)} / {visible.length || items.length} · {active.name}</p></footer>
    </section>}
    {album && menuItem && <div className="album-action-overlay" onPointerDown={event => { if (event.target === event.currentTarget && !busy) closeMenu() }}><section className="album-action-sheet" role="dialog" aria-modal="true" aria-labelledby={menuTitle}><header><h3 id={menuTitle}>{copy('照片操作', 'Photo options')}</h3><p>{menuItem.name}</p><small>{copy('导入于', 'Imported')} {photoDate(menuItem)}</small></header><button disabled={busy} aria-label={copy(`重命名 ${menuItem.name}`, `Rename ${menuItem.name}`)} onClick={() => { setRenameId(menuItem.id); setRenameValue(menuItem.name); closeMenu(false) }}><Pencil size={18}/>{copy('重命名', 'Rename')}</button><button disabled={busy} aria-pressed={menuItem.favorite} aria-label={copy(`收藏 ${menuItem.name}`, `Favorite ${menuItem.name}`)} onClick={() => { void favorite(menuItem); closeMenu() }}><Heart size={18} fill={menuItem.favorite ? 'currentColor' : 'none'}/>{copy(menuItem.favorite ? '取消收藏' : '收藏照片', menuItem.favorite ? 'Unfavorite' : 'Favorite photo')}</button><button disabled={busy} className="album-action-danger" aria-label={copy(`移除 ${menuItem.name}`, `Remove ${menuItem.name}`)} onClick={() => { closeMenu(); remove([menuItem.id]) }}><Trash2 size={18}/>{copy('从 Aily 移除', 'Remove from Aily')}</button><button ref={menuCancel} disabled={busy} onClick={() => closeMenu()}>{copy('取消', 'Cancel')}</button></section></div>}
    {album && renameId && <div className="album-action-overlay"><form className="album-rename-sheet" role="dialog" aria-modal="true" aria-labelledby={renameTitle} onSubmit={saveRename}><header><h3 id={renameTitle}>{copy('重命名照片', 'Rename photo')}</h3><p>{copy('只修改 Aily 中的名称，不改变系统原件。', 'Only the name in Aily changes; originals stay untouched.')}</p></header><label>{copy('媒体名称', 'Media name')}<input ref={renameInput} value={renameValue} maxLength={100} required disabled={busy} onChange={event => setRenameValue(event.target.value)}/></label>{error && <p role="alert" className="media-error">{error}</p>}<footer><button type="button" disabled={busy} onClick={() => { setRenameId(null); restoreFocus() }}>{copy('取消', 'Cancel')}</button><button type="submit" disabled={busy || !renameValue.trim()}>{copy('保存名称', 'Save name')}</button></footer></form></div>}
  </div>
}
