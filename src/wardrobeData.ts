import Dexie, { type Table } from 'dexie'

/** Metadata stays in the original localStorage record; photos never live here. */
export type WardrobeItem = {
  id: string
  name: string
  category: string
  color: string
  season: string
  photoId?: string
  [key: string]: unknown
}

export const WARDROBE_KEY = 'aily.ext.wardrobe'

/** Validate without normalizing, stripping extensions, or restricting legacy labels. */
export function isWardrobeItem(value: unknown): value is WardrobeItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return ['id', 'name', 'category', 'color', 'season'].every(key => typeof item[key] === 'string')
    && (item.photoId === undefined || typeof item.photoId === 'string')
}

export const wardrobeCategories: { id: string; zh: string; en: string }[] = [
  { id: '上装', zh: '上衣', en: 'Tops' },
  { id: '下装', zh: '裤子', en: 'Pants' },
  { id: '连体装', zh: '连体装', en: 'One-pieces' },
  { id: '半身裙', zh: '半身裙', en: 'Skirts' },
  { id: '鞋子', zh: '鞋子', en: 'Shoes' },
  { id: '包包', zh: '包包', en: 'Bags' },
  { id: '外套', zh: '外套', en: 'Outerwear' },
  { id: '配饰', zh: '配饰', en: 'Accessories' },
  { id: '鞋包', zh: '鞋包', en: 'Shoes & bags' },
]

/** Select only actual owned items. Incomplete wardrobes produce partial outfits. */
export function generateWardrobeOutfit(items: readonly WardrobeItem[], previousIds: readonly string[] = []): WardrobeItem[] {
  const previous = new Set(previousIds)
  // Defensive deduplication prevents malformed duplicate records occupying two slots.
  const unique = items.filter((item, index) => items.findIndex(other => other.id === item.id) === index)
  const group = (...categories: string[]) => unique.filter(item => categories.includes(item.category))
  const pick = (choices: WardrobeItem[]) => {
    const fresh = choices.filter(item => !previous.has(item.id))
    const pool = fresh.length ? fresh : choices
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : undefined
  }
  const tops = group('上装')
  const bottoms = group('下装', '半身裙')
  const dresses = group('连体装', '连衣裙')
  const result: WardrobeItem[] = []
  const append = (choices: WardrobeItem[]) => {
    const item = pick(choices)
    if (item) result.push(item)
  }
  let useDress = dresses.length > 0 && (!tops.length || !bottoms.length)
  if (dresses.length && tops.length && bottoms.length) {
    const previousDress = dresses.some(item => previous.has(item.id))
    const previousSeparates = tops.some(item => previous.has(item.id)) || bottoms.some(item => previous.has(item.id))
    useDress = previousDress !== previousSeparates ? !previousDress : Math.random() < 0.5
  }
  if (useDress) append(dresses)
  else {
    append(tops)
    append(bottoms)
  }
  append(group('外套'))
  const shoes = group('鞋子')
  const bags = group('包包')
  append(shoes)
  append(bags)
  // A legacy combined category cannot reliably be reclassified from its name.
  // Use one combined slot only when a modern shoe/bag slot is missing.
  if (!shoes.length || !bags.length) append(group('鞋包'))
  append(group('配饰'))
  return result
}

export type WardrobePhoto = { id: string; blob: Blob }

class WardrobePhotoDatabase extends Dexie {
  photos!: Table<WardrobePhoto, string>

  constructor() {
    super('aily-wardrobe-photos')
    this.version(1).stores({ photos: 'id' })
  }
}

/** Isolated local-only binary storage; metadata deletion is the UI's responsibility. */
export const wardrobePhotoDb = new WardrobePhotoDatabase()

const MAX_PHOTO_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_BYTES = 50 * 1024 * 1024
const IMAGE_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'])

export async function saveWardrobePhoto(blob: Blob): Promise<string> {
  if (!(blob instanceof Blob) || !IMAGE_MIMES.has(blob.type.toLowerCase())) {
    throw new Error('Choose a JPG, PNG, WebP or GIF image.')
  }
  if (blob.size > MAX_PHOTO_BYTES) throw new Error('Each wardrobe photo must be at most 5MB.')
  const id = crypto.randomUUID()
  // Serializing quota inspection and insertion prevents concurrent uploads from
  // passing the same quota check; a failed add also rolls back atomically.
  await wardrobePhotoDb.transaction('rw', wardrobePhotoDb.photos, async () => {
    let total = 0
    await wardrobePhotoDb.photos.each(photo => { total += photo.blob.size })
    if (total + blob.size > MAX_TOTAL_BYTES) throw new Error('Wardrobe photo storage is limited to 50MB.')
    await wardrobePhotoDb.photos.add({ id, blob })
  })
  return id
}

/** Only clear binary photos; never rewrite or remove wardrobe metadata. */
export async function clearWardrobePhotos(): Promise<void> {
  await wardrobePhotoDb.photos.clear()
}
