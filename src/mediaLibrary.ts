import Dexie, { type Table } from 'dexie'

export type MediaKind = 'album' | 'music'
export type LibraryMedia = { id: string; kind: MediaKind; name: string; blob: Blob; mime: string; addedAt: string; favorite: boolean; collection: string }
export type PhotoDecision = { id: string; status: 'pending' | 'keep'; updatedAt: string }
class MediaDatabase extends Dexie {
  items!: Table<LibraryMedia, string>
  photoDecisions!: Table<PhotoDecision, string>
  constructor() {
    super('aily-media-library-v1')
    this.version(1).stores({ items: 'id,kind,addedAt' })
    this.version(2).stores({ items: 'id,kind,addedAt', photoDecisions: 'id,status' })
  }
}
export const mediaDb = new MediaDatabase()
export const MAX_MEDIA_FILE_BYTES = 50 * 1024 * 1024
export const MAX_MEDIA_LIBRARY_BYTES = 200 * 1024 * 1024
export function mediaMime(kind: MediaKind, name: string, mime: string) {
  const extensions: Record<string, string> = kind === 'album'
    ? { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }
    : { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac' }
  const resolved = mime || extensions[name.split('.').at(-1)?.toLowerCase() || ''] || ''
  return resolved.startsWith(kind === 'album' ? 'image/' : 'audio/') ? resolved : null
}
export async function addLibraryMedia(kind: MediaKind, files: { name: string; blob: Blob }[]) {
  const records = files.map(file => {
    const mime = mediaMime(kind, file.name, file.blob.type)
    if (!mime || !file.blob.size || file.blob.size > MAX_MEDIA_FILE_BYTES) throw new Error('请选择有效的图片或音频，单个文件不超过 50MB。')
    return { id: crypto.randomUUID(), kind, name: file.name, blob: file.blob, mime, addedAt: new Date().toISOString(), favorite: false, collection: '' } satisfies LibraryMedia
  })
  await mediaDb.transaction('rw', mediaDb.items, async () => {
    const total = (await mediaDb.items.toArray()).reduce((size, item) => size + item.blob.size, 0) + records.reduce((size, item) => size + item.blob.size, 0)
    if (total > MAX_MEDIA_LIBRARY_BYTES) throw new Error('本机媒体库已超过 200MB，请先移除不需要的媒体。')
    await mediaDb.items.bulkAdd(records)
  })
}
export async function clearMediaLibrary() {
  await mediaDb.transaction('rw', mediaDb.items, mediaDb.photoDecisions, async () => {
    await mediaDb.items.clear()
    await mediaDb.photoDecisions.clear()
  })
}
