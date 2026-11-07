import Dexie, { type Table } from 'dexie'

export type SkincarePhoto = { id: string; blob: Blob; name: string; createdAt: string }

export const MAX_SKIN_PHOTO_BYTES = 5 * 1024 * 1024
export const MAX_SKIN_PHOTOS = 3

class SkincarePhotoDatabase extends Dexie {
  photos!: Table<SkincarePhoto, string>

  constructor() {
    super('aily-skincare-photos-v1')
    this.version(1).stores({ photos: 'id' })
  }
}

/** Health photos stay in this isolated local store, never the shared album. */
export const skincarePhotoDb = new SkincarePhotoDatabase()

const imageMimes = new Set(['image/jpeg', 'image/png', 'image/webp'])
function safeId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)
}
function safeName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0 && name.length <= 255
    && name !== '.' && name !== '..' && !/[\u0000-\u001f\u007f/\\:]/.test(name)
}
function validateId(id: unknown): asserts id is string {
  if (!safeId(id)) throw new Error('Invalid local skincare photo ID.')
}

/** Validate the entire explicit-picker selection before opening an atomic write. */
export async function saveSkincarePhotos(files: readonly { blob: Blob; name: string }[]): Promise<string[]> {
  if (!Array.isArray(files) || files.length > MAX_SKIN_PHOTOS) {
    throw new Error('Choose at most 3 skincare photos.')
  }
  for (const file of files) {
    if (!file || !(file.blob instanceof Blob) || !imageMimes.has(file.blob.type.toLowerCase())) {
      throw new Error('Choose a JPEG, PNG or WebP image.')
    }
    if (file.blob.size > MAX_SKIN_PHOTO_BYTES) throw new Error('Each skincare photo must be at most 5MB.')
    if (!safeName(file.name)) throw new Error('Use a safe, nonempty photo filename.')
  }
  if (!files.length) return []
  const createdAt = new Date().toISOString()
  const photos: SkincarePhoto[] = files.map(file => ({
    id: crypto.randomUUID(), blob: file.blob, name: file.name, createdAt,
  }))
  // A bulkAdd error must escape the transaction so even successful rows roll back.
  await skincarePhotoDb.transaction('rw', skincarePhotoDb.photos, async () => {
    await skincarePhotoDb.photos.bulkAdd(photos)
  })
  return photos.map(photo => photo.id)
}

export async function getSkincarePhoto(id: string): Promise<SkincarePhoto | undefined> {
  validateId(id)
  return skincarePhotoDb.photos.get(id)
}

export async function removeSkincarePhotos(ids: readonly string[]): Promise<void> {
  if (!Array.isArray(ids)) throw new Error('Expected local skincare photo IDs.')
  for (const id of ids) validateId(id)
  if (!ids.length) return
  await skincarePhotoDb.transaction('rw', skincarePhotoDb.photos, async () => {
    await skincarePhotoDb.photos.bulkDelete([...ids])
  })
}

/** Removes only these local binary photos; record/plan integration belongs to UI. */
export async function clearSkincarePhotos(): Promise<void> {
  await skincarePhotoDb.photos.clear()
}
