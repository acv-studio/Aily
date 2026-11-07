import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, ImageOff, Trash2 } from 'lucide-react'
import type { LibraryMedia } from './mediaLibrary'
import { getPhoto } from './nativePhotoOrganizer'
import { decisionKey, type OrganizerPhoto } from './photoOrganizer'
import './pendingPhotoList.css'

type Copy = (zh: string, en: string) => string
const PAGE_SIZE = 12
function PhotoThumbnail({ photo, item }: { photo: OrganizerPhoto; item?: LibraryMedia }) {
  const [src, setSrc] = useState(''), [failed, setFailed] = useState(false), [visible, setVisible] = useState(false)
  const container = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const node = container.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: '160px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    let cancelled = false, localUrl: string | undefined
    setFailed(false)
    if (item) { localUrl = URL.createObjectURL(item.blob); setSrc(localUrl) }
    else void getPhoto({ id: photo.id }).then(result => { if (!cancelled) setSrc(result.url) }).catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true; if (localUrl) URL.revokeObjectURL(localUrl) }
  }, [visible, photo.id, item?.blob])
  return <span ref={container} className="pending-photo-thumbnail">{src && !failed ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)}/> : failed ? <ImageOff size={22}/> : <span className="pending-thumbnail-placeholder"/>}</span>
}
export default function PendingPhotoList({ photos, library, disabled, copy, onOpen, onKeep, onDelete }: {
  photos: OrganizerPhoto[]; library: LibraryMedia[]; disabled: boolean; copy: Copy
  onOpen: (photo: OrganizerPhoto) => void; onKeep: (photo: OrganizerPhoto) => void; onDelete: (photos: OrganizerPhoto[]) => void
}) {
  const [selection, setSelection] = useState<string[]>([]), [page, setPage] = useState(0)
  const selected = photos.filter(photo => selection.includes(photo.id))
  const pages = Math.max(1, Math.ceil(photos.length / PAGE_SIZE)), currentPage = Math.min(page, pages - 1)
  const visible = photos.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  return <section className="pending-photo-list" aria-label={copy('待删除照片清单', 'Flagged photo list')}>
    <header><div><h3>{copy('待删除清单', 'Ready to delete')} <span>{photos.length}</span></h3><p>{copy('先看一眼，再决定。保留的照片不会被删除。', 'Review before deleting. Kept photos are excluded.')}</p></div><button className="pending-delete-all" disabled={disabled || !photos.length} onClick={() => onDelete(photos)}><Trash2 size={16}/>{copy(`一键删除全部（${photos.length}）`, `Delete all (${photos.length})`)}</button></header>
    <div className="pending-list-tools"><label><input type="checkbox" disabled={disabled || !photos.length} checked={photos.length > 0 && selected.length === photos.length} onChange={event => setSelection(event.target.checked ? photos.map(photo => photo.id) : [])}/>{copy('全选', 'Select all')}</label><span>{copy(`已选 ${selected.length} 张`, `${selected.length} selected`)}</span>{selected.length > 0 && <button disabled={disabled} onClick={() => onDelete(selected)}>{copy(`删除所选（${selected.length}）`, `Delete selected (${selected.length})`)}</button>}</div>
    <div className="pending-photo-grid">{visible.map(photo => <article key={decisionKey(photo)}>
      <label className="pending-photo-select"><input type="checkbox" disabled={disabled} checked={selection.includes(photo.id)} aria-label={copy(`选择待删除照片：${photo.name}`, `Select flagged photo: ${photo.name}`)} onChange={event => setSelection(previous => event.target.checked ? [...previous, photo.id] : previous.filter(id => id !== photo.id))}/></label>
      <button className="pending-photo-open" disabled={disabled} aria-label={copy(`查看待删除照片：${photo.name}`, `Preview flagged photo: ${photo.name}`)} onClick={() => onOpen(photo)}><PhotoThumbnail photo={photo} item={photo.source === 'library' ? library.find(item => item.id === photo.id) : undefined}/><strong>{photo.name}</strong></button>
      <button className="pending-photo-keep" disabled={disabled} aria-label={copy(`保留照片：${photo.name}`, `Keep photo: ${photo.name}`)} onClick={() => onKeep(photo)}><Check size={14}/>{copy('移出待删除', 'Keep this photo')}</button>
    </article>)}</div>
    {photos.length > PAGE_SIZE && <footer><button disabled={disabled || currentPage === 0} aria-label={copy('上一页待删除照片', 'Previous flagged page')} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18}/></button><span>{currentPage + 1} / {pages}</span><button disabled={disabled || currentPage >= pages - 1} aria-label={copy('下一页待删除照片', 'Next flagged page')} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18}/></button></footer>}
    {!photos.length && <p className="pending-list-empty">{copy('暂无待删除照片', 'No flagged photos')}</p>}
  </section>
}
