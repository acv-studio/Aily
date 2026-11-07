import { useEffect, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import { Camera, MediaTypeSelection } from '@capacitor/camera'
import { Capacitor } from '@capacitor/core'
import { Heart, Music2, ChevronLeft, ChevronRight, Trash2, FolderPlus, Pencil } from 'lucide-react'
import { addLibraryMedia, mediaDb, type LibraryMedia, type MediaKind } from './mediaLibrary'
import './mediaLibrary.css'

type Copy = (zh: string, en: string) => string
export default function MediaLibraryApp({ kind, copy }: { kind: MediaKind; copy: Copy }) {
  const [items, setItems] = useState<LibraryMedia[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [activeId, setActiveId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([]), [selecting, setSelecting] = useState(false), [collection, setCollection] = useState('')
  const [renameId, setRenameId] = useState<string | null>(null), [renameValue, setRenameValue] = useState('')
  const [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off')
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
      },
      error: () => { if (mounted.current) { setLoading(false); setError(copy('媒体库读取失败，请重新打开此软件；原数据未被覆盖。', 'Unable to read the library. Reopen this tool; existing data is unchanged.')) } },
    })
    return () => { mounted.current = false; subscription.unsubscribe(); audio.current?.pause(); for (const url of Object.values(urlMap.current)) URL.revokeObjectURL(url); urlMap.current = {} }
  }, [kind])
  const collections = [...new Set(items.map(item => item.collection).filter(Boolean))].sort()
  const visible = items.filter(item => (filter === 'all' || filter === 'favorites' ? filter !== 'favorites' || item.favorite : item.collection === filter.slice(11)) && (!search || item.name.toLowerCase().includes(search.toLowerCase())))
  const active = items.find(item => item.id === activeId)
  const operate = async (work: () => Promise<unknown>) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try { await work() } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : copy('操作未保存，请重试。', 'Changes were not saved. Please retry.')) }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
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
    if (!ids.length || !window.confirm(copy(`从 Aily 移除 ${ids.length} 项？不会删除系统相册或文件中的原件。`, `Remove ${ids.length} items from Aily? Originals in Photos or Files are not deleted.`))) return
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
    if (kind !== 'music' || !activeId || !urls[activeId]) return
    const player = audio.current
    if (player) { player.load(); void player.play().catch(() => { /* Native controls remain available when autoplay is blocked. */ }) }
  }, [activeId, urls[activeId || ''], kind])
  useEffect(() => {
    if (!activeId || kind !== 'album') return
    document.querySelector<HTMLButtonElement>('.media-photo-viewer header button')?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setActiveId(null) } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [activeId, kind])

  return <div className={`media-library-app media-library-${kind}`}>
    <p className="media-privacy">{copy('选中的媒体会复制到 Aily 本机媒体库，关闭后仍保留；不上传、不包含在聊天备份中。卸载或清除应用数据可能丢失。', 'Selected media is copied to Aily’s on-device library and retained after closing. It is not uploaded or included in chat backups; uninstalling or clearing data may remove it.')}{kind === 'music' && copy(' 支持本地音频，不读取 Apple Music 受保护歌曲。', ' Local audio only; protected Apple Music tracks cannot be imported.')}</p>
    <div className="media-library-toolbar">
      {kind === 'album' && Capacitor.isNativePlatform() ? <button disabled={busy} onClick={() => void choosePhotos()}>{copy('从系统相册添加', 'Add from Photos')}</button> : <label className="media-import">{copy(kind === 'album' ? '添加照片' : '添加本地音乐', kind === 'album' ? 'Add photos' : 'Add local music')}<input type="file" multiple accept={kind === 'album' ? 'image/*' : 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac'} disabled={busy} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void importFiles(files) }} /></label>}
      <button disabled={busy || !items.length} aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setSelected([]) }}>{copy(selecting ? '完成' : '多选', selecting ? 'Done' : 'Select')}</button>
    </div>
    <label className="media-search">{copy('搜索媒体', 'Search library')}<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={copy('按名称搜索', 'Search by name')} /></label>
    <div className="media-filter-row"><button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>{copy('全部', 'All')} · {items.length}</button><button aria-pressed={filter === 'favorites'} onClick={() => setFilter('favorites')}>{copy('收藏', 'Favorites')}</button>{collections.map(name => <button key={name} aria-pressed={filter === `collection:${name}`} onClick={() => setFilter(`collection:${name}`)}>{name}</button>)}</div>
    {selecting && <section className="media-batch" aria-label={copy('批量管理', 'Manage selection')}><span>{copy(`已选 ${selected.length} 项`, `${selected.length} selected`)}</span><label>{copy(kind === 'album' ? '相簿名称' : '播放列表名称', kind === 'album' ? 'Album name' : 'Playlist name')}<input value={collection} maxLength={60} onChange={event => setCollection(event.target.value)} /></label><button disabled={busy || !selected.length || !collection.trim()} onClick={group}><FolderPlus size={16} />{copy('归入列表', 'Add to collection')}</button><button disabled={busy || !selected.length} onClick={() => remove(selected)}>{copy('移除所选', 'Remove selected')}</button></section>}
    {renameId && <form className="media-batch" onSubmit={event => { event.preventDefault(); if (!renameValue.trim()) return; void operate(async () => { await mediaDb.items.update(renameId, { name: renameValue.trim() }); setRenameId(null) }) }}><label>{copy('媒体名称', 'Media name')}<input value={renameValue} maxLength={100} required onChange={event => setRenameValue(event.target.value)} /></label><button type="submit" disabled={busy}>{copy('保存名称', 'Save name')}</button><button type="button" disabled={busy} onClick={() => setRenameId(null)}>{copy('取消', 'Cancel')}</button></form>}
    {error && <p role="alert" className="media-error">{error}</p>}{loading && <p role="status">{copy('正在读取媒体库…', 'Loading library…')}</p>}{busy && <p role="status">{copy('正在处理…', 'Working…')}</p>}
    <div className={kind === 'album' ? 'media-photo-grid' : 'media-track-list'}>{visible.map(item => <article key={item.id}>
      {selecting && <label className="media-selection"><input type="checkbox" checked={selected.includes(item.id)} aria-label={copy(`选择 ${item.name}`, `Select ${item.name}`)} onChange={event => setSelected(previous => event.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))} /></label>}
      <button className="media-open" aria-label={copy(`打开 ${item.name}`, `Open ${item.name}`)} onClick={() => setActiveId(item.id)}>{kind === 'album' ? <img loading="lazy" src={urls[item.id]} alt={item.name} /> : <Music2 size={24} />}<span>{item.name}</span>{kind === 'music' && <small>{(item.blob.size / 1024 / 1024).toFixed(1)} MB{item.collection ? ` · ${item.collection}` : ''}</small>}</button>
      <div className="media-item-actions"><button disabled={busy} aria-label={copy(`重命名 ${item.name}`, `Rename ${item.name}`)} onClick={() => { setRenameId(item.id); setRenameValue(item.name) }}><Pencil size={16} /></button><button disabled={busy} aria-pressed={item.favorite} aria-label={copy(`收藏 ${item.name}`, `Favorite ${item.name}`)} onClick={() => void favorite(item)}><Heart size={16} fill={item.favorite ? 'currentColor' : 'none'} /></button><button disabled={busy} aria-label={copy(`移除 ${item.name}`, `Remove ${item.name}`)} onClick={() => remove([item.id])}><Trash2 size={16} /></button></div>
    </article>)}</div>
    {!loading && !visible.length && <p className="media-empty">{copy(items.length ? '没有符合条件的媒体。' : '添加你喜欢的照片或音乐，建立自己的媒体库。', items.length ? 'No matching media.' : 'Add your favorite photos or music to build your library.')}</p>}
    {kind === 'music' && active && <section className="media-player" aria-label={copy('正在播放', 'Now playing')}><strong>{active.name}</strong><audio ref={audio} controls preload="metadata" src={urls[active.id]} aria-label={active.name} onEnded={ended} onError={() => setError(copy('此音频格式暂无法播放，请选择 MP3 或 M4A。', 'This audio cannot be played. Try MP3 or M4A.'))} /><div><button onClick={() => navigate(-1)}>{copy('上一首', 'Previous')}</button><button onClick={() => setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')}>{copy(({ off: '顺序播放', all: '列表循环', one: '单曲循环' })[repeat], ({ off: 'In order', all: 'Repeat all', one: 'Repeat one' })[repeat])}</button><button onClick={() => navigate(1)}>{copy('下一首', 'Next')}</button><button onClick={() => { audio.current?.pause(); setActiveId(null) }}>{copy('收起播放器', 'Close player')}</button></div></section>}
    {kind === 'album' && active && <section className="media-photo-viewer" role="dialog" aria-modal="true" aria-label={copy('查看照片', 'Photo viewer')}><header><button onClick={() => setActiveId(null)} aria-label={copy('返回相册', 'Back to album')}>{'<'}</button><strong>{active.name}</strong><button disabled={busy} aria-pressed={active.favorite} onClick={() => void favorite(active)}>{copy('收藏', 'Favorite')}</button></header><img src={urls[active.id]} alt={active.name} /><footer><button onClick={() => navigate(-1)} aria-label={copy('上一张', 'Previous photo')}><ChevronLeft /></button><span>{new Date(active.addedAt).toLocaleDateString()}</span><button onClick={() => navigate(1)} aria-label={copy('下一张', 'Next photo')}><ChevronRight /></button></footer></section>}
  </div>
}
