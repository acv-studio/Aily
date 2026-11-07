import { useEffect, useId, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import { ArrowRight, BadgeCheck, ChevronLeft, ChevronRight, CircleUserRound, Folder, Heart, Images, Inbox, Leaf, Maximize2, Minimize2, RotateCcw, Shuffle, SlidersHorizontal, Sparkles, Trash2, X } from 'lucide-react'
import type { Locale } from './i18n'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { resolvedTheme, useTheme } from './theme'
import { addLibraryMedia, mediaDb, type LibraryMedia, type PhotoDecision } from './mediaLibrary'
import { isPhotoOrganizerAvailable, listPhotos, getPhoto, deletePhotos } from './nativePhotoOrganizer'
import PendingPhotoList from './PendingPhotoList'
import { deletePendingBatch, PHOTO_DELETE_BATCH_SIZE } from './photoOrganizerDeletion'
import { decisionKey, randomPhoto, type OrganizerPhoto } from './photoOrganizer'
import PhotoSwipeStage, { type PhotoSwipeStageHandle } from './PhotoSwipeStage'
import './photoOrganizer.css'

type Undo = { photo: OrganizerPhoto; before?: PhotoDecision }
export default function PhotoOrganizerApp({ locale, onClose }: { locale: Locale; onClose?: () => void }) {
  const en = locale === 'en', copy = (zh: string, english: string) => en ? english : zh
  const [library, setLibrary] = useState<LibraryMedia[]>([]), [nativePhotos, setNativePhotos] = useState<OrganizerPhoto[]>([])
  const [source, setSource] = useState<'library' | 'native'>('library'), [limited, setLimited] = useState(false)
  const [decisions, setDecisions] = useState<Record<string, PhotoDecision>>({}), [ready, setReady] = useState(false)
  const [activeId, setActiveId] = useState<string>(), [view, setView] = useState<'all' | 'pending' | 'keep'>('all')
  const [page, setPage] = useState<'overview' | 'review' | 'pending' | 'profile'>('overview')
  const [reviewMode, setReviewMode] = useState<'latest' | 'random'>('random'), [listReturn, setListReturn] = useState<'overview' | 'review'>('overview')
  const [expanded, setExpanded] = useState(false), [systemRead, setSystemRead] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null), expandedClose = useRef<HTMLButtonElement>(null)
  const { resolved: appTheme } = useTheme()
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    void StatusBar.setStyle({ style: expanded || appTheme === 'dark' ? Style.Dark : Style.Light }).catch(() => {})
    return () => { void StatusBar.setStyle({ style: resolvedTheme() === 'light' ? Style.Light : Style.Dark }).catch(() => {}) }
  }, [expanded, appTheme])
  const [previewUrl, setUrl] = useState(''), [previewKey, setPreviewKey] = useState(''), [photoLoading, setPhotoLoading] = useState(false), [photoFailed, setPhotoFailed] = useState(false), [previewRevision, setPreviewRevision] = useState(0)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [storageError, setStorageError] = useState(''), [notice, setNotice] = useState('')
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 5000); return () => window.clearTimeout(timer) }, [notice])
  const [history, setHistory] = useState<Undo[]>([]), [moving, setMoving] = useState(false)
  const mounted = useRef(false), working = useRef(false), swipeStage = useRef<PhotoSwipeStageHandle>(null)
  const [deleteTargets, setDeleteTargets] = useState<OrganizerPhoto[] | null>(null)
  const cancelDeletion = useRef<HTMLButtonElement>(null), deleteHeading = useId()
  useEffect(() => { if (deleteTargets) cancelDeletion.current?.focus() }, [deleteTargets])
  const blocked = busy || moving || deleteTargets !== null || expanded
  useEffect(() => {
    if (!expanded) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    expandedClose.current?.focus()
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setExpanded(false) } }
    document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('keydown', escape, true); previous?.isConnected && previous.focus() }
  }, [expanded])
  const native = isPhotoOrganizerAvailable()
  useEffect(() => {
    mounted.current = true
    const subscription = liveQuery(async () => ({ items: await mediaDb.items.where('kind').equals('album').toArray(), marks: await mediaDb.photoDecisions.toArray() })).subscribe({
      next: ({ items, marks }) => { if (mounted.current) { setLibrary(items); setDecisions(Object.fromEntries(marks.map(mark => [mark.id, mark]))); setReady(true); setStorageError('') } },
      error: () => { if (mounted.current) { setStorageError(copy('本机整理记录读取失败，暂时不能标记。请关闭后重试，原数据未被覆盖。', 'Local review data could not be read. Reopen to retry; existing data is unchanged.')); setReady(false) } },
    })
    return () => { mounted.current = false; subscription.unsubscribe() }
  }, [])
  const photos: OrganizerPhoto[] = (source === 'native' ? nativePhotos : library.map(item => ({ id: item.id, name: item.name, createdAt: item.addedAt, source: 'library' as const }))).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  useEffect(() => {
    if (view === 'all' && !activeId && photos.length) setActiveId(randomPhoto(photos.filter(photo => !decisions[decisionKey(photo)]).length ? photos.filter(photo => !decisions[decisionKey(photo)]) : photos)?.id)
  }, [source, photos.length, view, activeId])
  const visible = photos.filter(photo => view === 'all' || decisions[decisionKey(photo)]?.status === view).reverse()
  const active = visible.find(photo => photo.id === activeId) || visible[0]
  const activeKey = active ? decisionKey(active) : ''
  const url = previewKey === activeKey ? previewUrl : ''
  const pendingCount = photos.filter(photo => decisions[decisionKey(photo)]?.status === 'pending').length
  const keepCount = photos.filter(photo => decisions[decisionKey(photo)]?.status === 'keep').length
  const unreviewed = photos.filter(photo => !decisions[decisionKey(photo)])
  const item = active?.source === 'library' ? library.find(row => row.id === active.id) : undefined
  useEffect(() => {
    let cancelled = false, objectUrl: string | undefined
    setUrl(''); setPreviewKey(''); setPhotoFailed(false)
    if (!active || page !== 'review') { setPhotoLoading(false); return }
    setPhotoLoading(true)
    const key = decisionKey(active)
    if (item) { objectUrl = URL.createObjectURL(item.blob); setUrl(objectUrl); setPreviewKey(key) }
    else {
      void getPhoto({ id: active.id }).then(result => {
        if (cancelled) return
        if (!result.url) throw new Error('Photo preview is empty')
        setUrl(result.url); setPreviewKey(key)
      }).catch(() => {
        if (!cancelled) { setPhotoLoading(false); setPhotoFailed(true); setError(copy('此照片无法读取，可能已移除、在云端或权限已更改。可以重试或重新读取相册。', 'This photo is unavailable, in the cloud, or access changed. Retry or reload Photos.')) }
      })
    }
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [active?.id, active?.source, item?.blob, previewRevision, page])
  const operate = async (work: () => Promise<void>) => {
    if (working.current) return
    working.current = true; setBusy(true); setError('')
    try { await work() } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : copy('操作未完成，请核对列表后重试。', 'Operation incomplete. Check the list before retrying.')) }
    finally { working.current = false; if (mounted.current) setBusy(false) }
  }
  const readSystem = (mode?: 'latest' | 'random') => operate(async () => {
    const result = await listPhotos()
    if (!mounted.current) return
    const next = result.photos.map(photo => ({ ...photo, source: 'native' as const }))
    const candidates = next.filter(photo => !decisions[decisionKey(photo)])
    const available = candidates.length ? candidates : next
    setNativePhotos(next); setSystemRead(true); setLimited(result.limited); setSource('native'); setView('all'); setHistory([])
    setActiveId(mode === 'latest' ? available.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id : randomPhoto(available)?.id)
    if (mode && next.length) { setReviewMode(mode); setPage('review') }
    setNotice(copy(`已读取 ${next.length} 张可访问照片。`, `${next.length} accessible photos loaded.`))
  })
  const startReview = (mode: 'latest' | 'random') => {
    if (blocked || !ready) return
    if (!photos.length) {
      if (native && !systemRead) { void readSystem(mode); return }
      fileInput.current?.click(); return
    }
    const available = unreviewed.length ? unreviewed : photos
    setReviewMode(mode); setView('all'); setPage('review')
    setActiveId(mode === 'latest' ? available.at(-1)?.id : randomPhoto(available, active?.id)?.id)
  }
  const openPending = () => { if (blocked) return; setListReturn(page === 'review' ? 'review' : 'overview'); setPage('pending'); setView('pending') }
  const navigate = (direction: number) => {
    if (!visible.length || busy) return
    const index = visible.findIndex(photo => photo.id === active?.id)
    setActiveId(visible[(index + direction + visible.length) % visible.length].id)
  }
  const drawRandom = () => {
    if (busy) return
    setReviewMode('random'); setView('all'); setPage('review'); setActiveId(randomPhoto(unreviewed.length ? unreviewed : photos, active?.id)?.id)
    setNotice(unreviewed.length ? copy('随机抽取一张未整理照片。', 'Picked an unreviewed photo.') : copy('全部已整理，继续随机浏览；可以修改标记。', 'All reviewed. Browse randomly or change a decision.'))
  }
  const mark = (status: PhotoDecision['status']) => {
    if (!active || busy || !ready || !url || photoLoading || photoFailed) return
    const photo = active
    return operate(async () => {
      const key = decisionKey(photo)
      let before: PhotoDecision | undefined
      const decision: PhotoDecision = { id: key, status, updatedAt: new Date().toISOString() }
      await mediaDb.transaction('rw', mediaDb.photoDecisions, async () => { before = await mediaDb.photoDecisions.get(key); await mediaDb.photoDecisions.put(decision) })
      if (!mounted.current) return
      setDecisions(previous => ({ ...previous, [key]: decision })); setHistory(previous => [...previous.slice(-99), { photo, before }])
      setNotice(status === 'pending' ? copy('已标记待删除，原照片未删除。', 'Flagged for deletion. Original not deleted.') : copy('已标记保留。', 'Marked to keep.'))
      if (view === 'all') {
        const remaining = unreviewed.filter(row => row.id !== photo.id)
        setActiveId(reviewMode === 'latest' ? (remaining.at(-1) || photos.filter(row => row.id !== photo.id).at(-1) || photo).id : randomPhoto(remaining, photo.id)?.id || randomPhoto(photos, photo.id)?.id)
      }
      else setActiveId(visible.find(row => row.id !== photo.id)?.id)
    })
  }
  const undo = () => {
    const last = history.at(-1)
    if (!last || !ready) return
    void operate(async () => {
      await mediaDb.transaction('rw', mediaDb.photoDecisions, async () => {
        if (last.before) await mediaDb.photoDecisions.put(last.before)
        else await mediaDb.photoDecisions.delete(decisionKey(last.photo))
      })
      if (!mounted.current) return
      setDecisions(previous => { const next = { ...previous }; if (last.before) next[decisionKey(last.photo)] = last.before; else delete next[decisionKey(last.photo)]; return next })
      setHistory(previous => previous.slice(0, -1)); setView('all'); setPage('review'); setActiveId(last.photo.id); setNotice(copy('已撤销上一次标记。', 'Last decision undone.'))
    })
  }
  const keepPending = (photo: OrganizerPhoto) => {
    if (blocked || !ready) return
    void operate(async () => {
      const key = decisionKey(photo)
      let before: PhotoDecision | undefined
      await mediaDb.transaction('rw', mediaDb.photoDecisions, async () => {
        before = await mediaDb.photoDecisions.get(key)
        if (before?.status !== 'pending') throw new Error(copy('标记已更改，请重新读取列表。', 'Decision changed. Reload the list.'))
        await mediaDb.photoDecisions.put({ id: key, status: 'keep', updatedAt: new Date().toISOString() })
      })
      if (mounted.current) { setHistory(previous => [...previous.slice(-99), { photo, before }]); setNotice(copy('已保留，移出待删除清单。', 'Kept and removed from the flagged list.')) }
    })
  }
  const confirmDelete = () => {
    if (!deleteTargets?.length || working.current || !ready) return
    const targets = deleteTargets.slice()
    void operate(async () => {
      let count = 0, cleanupFailed = false
      try {
        for (let offset = 0; offset < targets.length; offset += PHOTO_DELETE_BATCH_SIZE) {
          const batch = targets.slice(offset, offset + PHOTO_DELETE_BATCH_SIZE)
          const result = await deletePendingBatch(batch, deletePhotos)
          const deleted = new Set(result.deletedIds)
          count += deleted.size; cleanupFailed ||= result.cleanupFailed
          if (mounted.current) {
            if (targets[0].source === 'native') setNativePhotos(previous => previous.filter(photo => !deleted.has(photo.id)))
            setHistory(previous => previous.filter(entry => entry.photo.source !== targets[0].source || !deleted.has(entry.photo.id)))
            setDecisions(previous => { const next = { ...previous }; for (const id of deleted) delete next[`${targets[0].source}:${id}`]; return next })
          }
          if (deleted.size !== batch.length) throw new Error(copy('部分照片未确认删除，已停止后续操作。', 'Some deletions were not confirmed. Remaining batches stopped.'))
          if (result.cleanupFailed || !mounted.current) break
        }
        if (mounted.current) setNotice(cleanupFailed ? copy(`已删除 ${count} 张，但部分整理记录清理失败，请重新读取相册。`, `${count} deleted, but review cleanup failed. Reload Photos.`) : copy(`已删除 ${count} 张${targets[0].source === 'library' ? ' Aily 副本，系统原件未改动' : '系统照片'}。`, `${count} ${targets[0].source === 'library' ? 'Aily copies deleted; system originals unchanged' : 'device photos deleted'}.`))
      } catch (failure) {
        if (mounted.current) {
          const cancelled = !!failure && typeof failure === 'object' && 'code' in failure && failure.code === 'CANCELLED'
          setNotice(copy(`已确认删除 ${count} 张；其余待删除标记保留。`, `${count} deletions confirmed; remaining flags kept.`))
          if (cancelled) setNotice(copy(count ? `已删除 ${count} 张，后续批次已取消。` : '已取消删除，照片和标记均保留。', count ? `${count} deleted; remaining batches cancelled.` : 'Deletion cancelled. Photos and flags kept.'))
          if (!cancelled) throw failure
        }
      } finally { if (mounted.current) setDeleteTargets(null) }
    })
  }
  const status = active && decisions[decisionKey(active)]?.status
  const sourceName = copy(source === 'native' ? '系统相册' : 'Aily 相册', source === 'native' ? 'Device Photos' : 'Aily library')
  const number = (value: number) => value.toLocaleString(en ? 'en-US' : 'zh-CN')
  const taken = active ? new Date(active.createdAt) : null
  const photoDate = taken && Number.isFinite(taken.getTime()) && taken.getFullYear() > 1970 ? taken.toLocaleDateString(en ? 'en-US' : 'zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) : copy('日期未知', 'Unknown date')
  const changeSource = (next: 'native' | 'library') => {
    if (blocked) return
    setSource(next); setView('all'); setActiveId(undefined); setHistory([])
  }
  const sourceChips = <div className="organizer-source-chips" aria-label={copy('照片来源', 'Photo sources')}>
    {systemRead && <button disabled={blocked} aria-pressed={source === 'native'} onClick={() => changeSource('native')}><Folder size={15}/>{copy('系统相册', 'Device Photos')}</button>}
    <button disabled={blocked} aria-pressed={source === 'library'} onClick={() => changeSource('library')}><Folder size={15}/>{copy('Aily 相册', 'Aily library')}</button>
    {source === 'library' && item?.collection && <span><Folder size={15}/>{item.collection}</span>}
  </div>
  return <section className={`photo-organizer organizer-page-${page}`} aria-label={copy('相册整理工具', 'Photo organizer tool')}>
    <input ref={fileInput} className="organizer-file-input" tabIndex={-1} type="file" multiple accept="image/*" aria-label={copy('选择本地照片', 'Choose local photos')} disabled={blocked} onChange={event => {
      const files = Array.from(event.target.files || []); event.target.value = ''; if (!files.length) return
      void operate(async () => { await addLibraryMedia('album', files.map(file => ({ name: file.name, blob: file }))); if (mounted.current) { setSource('library'); setView('all'); setPage('overview'); setActiveId(undefined); setHistory([]); setNotice(copy('照片已加入 Aily 本机相册。', 'Photos added to the on-device Aily library.')) } })
    }}/>
    {(error || storageError) && <p className="organizer-error" role="alert">{storageError || error}</p>}
    {busy && <p className="organizer-working" role="status">{copy('正在处理，请稍候…', 'Working. Please wait…')}</p>}
    {page === 'overview' && <>
      <header className="organizer-brand"><button className="organizer-icon-button organizer-home-back" disabled={blocked} aria-label={copy('返回', 'Back')} title={copy('返回 Aily', 'Back to Aily')} onClick={() => onClose?.()}><ChevronLeft size={27}/></button><h2>{copy('相册整理', 'Photo Organizer')}</h2><button className="organizer-icon-button" disabled={blocked} aria-label={copy('整理设置', 'Organizer settings')} onClick={() => setPage('profile')}><SlidersHorizontal size={25}/></button></header>
      <main className="organizer-overview-content">
        <div className="organizer-greeting"><time>{new Date().toLocaleDateString(en ? 'en-US' : 'zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</time><h1>{copy('少一点杂乱，', 'Less clutter,')}<br/>{copy('多一点美好。', 'more memories.')}</h1></div>
        <section className="organizer-hero"><span>{copy('今日的整理时刻', 'A little room for today')}</span><Leaf className="organizer-hero-leaf" strokeWidth={1.4} aria-hidden="true"/><h3>{copy('给回忆做个减法', 'Make space for memories')}</h3><p>{!ready ? copy('正在读取本机记录…', 'Loading local reviews…') : !photos.length ? copy('选择相册，开始轻松整理', 'Choose photos to start reviewing') : copy(`还有 ${number(unreviewed.length)} 张照片等待整理`, `${number(unreviewed.length)} photos waiting to be reviewed`)}</p><div className="organizer-start-actions"><button disabled={blocked || !ready} onClick={() => startReview('latest')}><ArrowRight size={21}/>{copy('从最新开始', 'Start with latest')}</button><button disabled={blocked || !ready} onClick={() => startReview('random')}><Shuffle size={21}/>{copy('随机整理', 'Random review')}</button></div></section>
        <div className="organizer-stat-grid"><button className="organizer-stat" disabled={blocked || !ready || !photos.length} aria-label={copy(`待整理 ${unreviewed.length}`, `${unreviewed.length} unreviewed photos`)} onClick={() => startReview('latest')}><Sparkles size={23}/><strong>{number(unreviewed.length)}</strong><span>{copy('待整理', 'To review')}</span></button><button className="organizer-stat" disabled={blocked || !ready || !keepCount} aria-label={copy(`已保留 ${keepCount}`, `${keepCount} kept photos`)} onClick={() => { setView('keep'); setActiveId(photos.filter(photo => decisions[decisionKey(photo)]?.status === 'keep').at(-1)?.id); setPage('review') }}><BadgeCheck size={23}/><strong>{number(keepCount)}</strong><span>{copy('已保留', 'Kept')}</span></button><button className="organizer-stat" disabled={blocked || !ready} aria-label={copy(`待删除 ${pendingCount}`, `${pendingCount} flagged photos`)} onClick={openPending}><Trash2 size={23}/><strong>{number(pendingCount)}</strong><span>{copy('待清理', 'To clean')}</span></button></div>
        <p className="organizer-total">{copy(`共 ${number(photos.length)} 张照片`, `${number(photos.length)} photos total`)} · {sourceName}{source === 'native' && limited && copy(' · 有限授权', ' · Limited access')}</p>
      </main>
    </>}
    {page === 'review' && <main className="organizer-review" aria-hidden={expanded || undefined}>
      <header className="organizer-review-header"><button className="organizer-icon-button" disabled={blocked} aria-label={copy(view === 'pending' ? '返回待清理清单' : '返回整理首页', view === 'pending' ? 'Back to flagged list' : 'Back to overview')} onClick={() => { setPage(view === 'pending' ? 'pending' : 'overview'); setExpanded(false) }}><X size={25}/></button><strong>{copy('一张一张，慢慢来', 'One photo at a time')}</strong><button className="organizer-tray organizer-icon-button" disabled={blocked} aria-label={copy(`待删除 ${pendingCount}`, `${pendingCount} flagged photos`)} onClick={openPending}><Inbox size={27}/><span>{number(pendingCount)}</span></button></header>
      {active ? <>
        <div className="organizer-review-meta"><strong>{photoDate}</strong><span>{source === 'library' && copy('导入日期 · ', 'Imported · ')}{copy(`剩余 ${number(unreviewed.length)} 张待整理`, `${number(unreviewed.length)} left to review`)}</span></div>
        <div className="organizer-photo-frame"><PhotoSwipeStage ref={swipeStage} photoKey={decisionKey(active)} src={url} name={active.name} loading={!photoFailed && (!url || photoLoading)} busy={blocked} canDecide={ready && !!url && !photoLoading && !photoFailed} copy={copy} onMotionChange={setMoving} onAction={action => action === 'pending' || action === 'keep' ? mark(action) : navigate(action === 'next' ? 1 : -1)} onLoaded={() => setPhotoLoading(false)} onError={() => { setPhotoLoading(false); setPhotoFailed(true); setError(copy('图片预览失败，请重试或浏览下一张。', 'Preview failed. Retry or browse the next photo.')) }}/><button className="organizer-expand" disabled={blocked || photoLoading || photoFailed || !url} aria-label={copy('查看大图', 'Expand photo')} onClick={() => setExpanded(true)}><Maximize2 size={20}/></button>{photoFailed && <button className="organizer-photo-retry" disabled={blocked} onClick={() => { setError(''); setPreviewRevision(value => value + 1) }}>{copy('重试照片', 'Retry photo')}</button>}</div>
        <div className="organizer-gesture-hint"><button className="organizer-icon-button" disabled={blocked || visible.length < 2} aria-label={copy('上一张', 'Previous photo')} onClick={() => swipeStage.current?.perform('previous')}><ChevronLeft size={17}/></button><span>{copy('左右浏览 · 上滑待清理 · 下滑保留', 'Browse sideways · Up to flag · Down to keep')}</span><button className="organizer-icon-button" disabled={blocked || visible.length < 2} aria-label={copy('下一张', 'Next photo')} onClick={() => swipeStage.current?.perform('next')}><ChevronRight size={17}/></button></div>
        {sourceChips}
        <div className="organizer-circle-actions"><div className="organizer-round-action organizer-round-flag"><button disabled={blocked || !ready || !url || photoLoading || photoFailed} aria-label={copy('待删除', 'Flag for deletion')} onClick={() => swipeStage.current?.perform('pending')}><Trash2 size={31}/></button><span>{copy('待清理', 'To clean')}</span></div><div className="organizer-round-action organizer-round-undo"><button disabled={blocked || !ready || !history.length} aria-label={copy('撤销上一次', 'Undo last')} onClick={undo}><RotateCcw size={31}/></button><span>{copy('撤销', 'Undo')}</span></div><div className="organizer-round-action organizer-round-keep"><button disabled={blocked || !ready || !url || photoLoading || photoFailed} aria-label={copy('保留', 'Keep')} onClick={() => swipeStage.current?.perform('keep')}><Heart size={31}/></button><span>{copy('保留', 'Keep')}</span></div></div>
        <p className="organizer-review-caption">{active.name} · {copy(status === 'pending' ? '待清理' : status === 'keep' ? '已保留' : '未整理', status === 'pending' ? 'Flagged' : status === 'keep' ? 'Kept' : 'Unreviewed')}{source === 'native' && limited && copy(' · 有限授权', ' · Limited access')}</p>
      </> : <div className="organizer-empty"><Images size={42}/><strong>{copy(view === 'pending' ? '暂无待删除照片' : view === 'keep' ? '暂无保留照片' : '选择相册，开始轻松整理', view === 'pending' ? 'No flagged photos' : view === 'keep' ? 'No kept photos' : 'Choose photos to start reviewing')}</strong><button disabled={blocked} onClick={() => setPage('overview')}>{copy('回到整理首页', 'Back to overview')}</button></div>}
    </main>}
    {page === 'pending' && <main className="organizer-list-page"><header className="organizer-section-header"><button className="organizer-icon-button" disabled={blocked} aria-label={copy('返回', 'Back')} onClick={() => { setView('all'); setPage(listReturn) }}><ChevronLeft size={25}/></button><div><h2>{copy('待清理', 'To clean')}</h2><p>{sourceName} · {copy('确认后才会删除', 'Nothing deleted until confirmed')}</p></div><Inbox size={25}/></header><PendingPhotoList key={source} photos={photos.filter(photo => decisions[decisionKey(photo)]?.status === 'pending')} library={library} disabled={blocked || !ready} copy={copy} onOpen={photo => { setActiveId(photo.id); setView('pending'); setPage('review') }} onKeep={keepPending} onDelete={targets => { if (ready && !blocked && targets.length) setDeleteTargets(targets.slice()) }}/><p className="organizer-list-note">{copy('“移出待删除”会保留照片。真正删除不能通过撤销标记恢复。', 'Keeping a photo removes its flag. Undo cannot restore deleted photos.')}</p></main>}
    {page === 'profile' && <main className="organizer-profile"><header className="organizer-section-header"><button className="organizer-icon-button" disabled={blocked} aria-label={copy('返回', 'Back')} onClick={() => setPage('overview')}><ChevronLeft size={25}/></button><h2>{copy('我的相册', 'My Photos')}</h2><SlidersHorizontal size={24}/></header><section className="organizer-profile-card"><CircleUserRound size={34}/><h3>{copy('只在本机，安心整理', 'Your photos stay with you')}</h3><p>{copy('选择你想整理的照片来源。', 'Choose the photos you want to review.')}</p>{sourceChips}<div className="organizer-profile-actions">{native && <button disabled={blocked} onClick={() => void readSystem()}><Images size={18}/>{copy('读取系统相册', 'Read device Photos')}</button>}<button disabled={blocked} onClick={() => fileInput.current?.click()}><Folder size={18}/>{copy('选择本地照片', 'Choose local photos')}</button></div>{source === 'native' && limited && <p>{copy('当前为有限照片权限，仅整理你允许访问的照片；可在系统设置中扩大授权后重新读取。', 'Limited access: only approved photos are shown. Expand permission in system settings, then reload.')}</p>}</section><section className="organizer-profile-card organizer-privacy"><h3>{copy('整理与删除说明', 'Review and deletion')}</h3><p>{copy('所有整理都在本机进行，不上传。上滑只标记；在待清理清单确认后才真正删除。系统照片会再次请求系统确认；Aily 相册只删除导入副本。清除应用数据会丢失整理记录。', 'Reviews stay on-device, never uploaded. Swiping only flags photos. Deleting from the flagged list requires confirmation; device photos also require system consent. Aily deletion removes imported copies only. Clearing app data removes review records.')}</p>{!native && <p>{copy('浏览器不能直接扫描系统相册：请先选择本地照片，或使用已导入 Aily 的相册。', 'Browsers cannot scan device Photos. Choose local files or review photos already imported into Aily.')}</p>}<p>{copy('导入照片会复制到 Aily 本机媒体库；单张不超过 50MB，总容量不超过 200MB。', 'Imported photos are copied to Aily’s on-device library; maximum 50MB per file and 200MB total.')}</p></section></main>}
    {page !== 'review' && <nav className="organizer-bottom-nav" aria-label={copy('相册整理导航', 'Photo organizer navigation')}><button disabled={blocked} aria-current={page === 'overview' || page === 'pending' ? 'page' : undefined} onClick={() => { setPage('overview'); setView('all') }}><Sparkles size={24}/><span>{copy('整理', 'Review')}</span></button><button disabled={blocked} aria-current={page === 'profile' ? 'page' : undefined} onClick={() => setPage('profile')}><CircleUserRound size={24}/><span>{copy('我的', 'Me')}</span></button></nav>}
    <p className={`organizer-status${notice ? ' has-message' : ''}`} role="status" aria-live="polite">{notice}</p>
    {deleteTargets && <div className="organizer-confirm-overlay"><section className="organizer-delete-confirm" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); setDeleteTargets(null) } }} role="alertdialog" aria-labelledby={deleteHeading} aria-describedby={`${deleteHeading}-description`}><h3 id={deleteHeading}>{copy(`确认删除 ${deleteTargets.length} 张照片？`, `Delete ${deleteTargets.length} photos?`)}</h3><p id={`${deleteHeading}-description`}>{deleteTargets[0].source === 'native' ? copy('将删除系统相册中的原照片，并请求系统确认。若开启 iCloud 照片，删除会同步到其他设备；iOS 通常可在“最近删除”中恢复。这不是只清除 Aily 标记。', 'This deletes originals from device Photos and requests system consent. With iCloud Photos, deletion syncs to other devices; iOS usually allows recovery in Recently Deleted. This is not just clearing Aily flags.') : copy('只删除 Aily 本机相册中的导入副本，不改动系统原照片。删除副本后无法通过“撤销标记”恢复，请确认已有原件或备份。', 'Only imported copies in Aily are deleted; system originals are untouched. Deleted copies cannot be restored with Undo. Confirm that you have originals or a backup.')}{deleteTargets.length > PHOTO_DELETE_BATCH_SIZE && copy(` 将分 ${Math.ceil(deleteTargets.length / PHOTO_DELETE_BATCH_SIZE)} 批处理；系统相册每批都需要确认，取消会保留剩余照片。`, ` ${Math.ceil(deleteTargets.length / PHOTO_DELETE_BATCH_SIZE)} batches; device Photos requires consent for each. Cancelling keeps the remaining photos.`)}</p><div><button ref={cancelDeletion} disabled={busy} onClick={() => setDeleteTargets(null)}>{copy('取消', 'Cancel')}</button><button className="organizer-confirm-delete" disabled={busy || !ready} onClick={confirmDelete}>{copy('确认删除', 'Confirm deletion')}</button></div></section></div>}
    {expanded && active && <section className="organizer-expanded" role="dialog" aria-modal="true" aria-label={copy('查看大图', 'Expanded photo')}><button ref={expandedClose} aria-label={copy('收起大图', 'Close expanded photo')} onClick={() => setExpanded(false)}><Minimize2 size={25}/></button><img src={url} alt={active.name}/></section>}
  </section>
}
