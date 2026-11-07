import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearWardrobePhotos, generateWardrobeOutfit, isWardrobeItem, saveWardrobePhoto, wardrobeCategories, wardrobePhotoDb, WARDROBE_KEY, type WardrobeItem } from './wardrobeData'

const item = (id: string, category: string): WardrobeItem => ({ id, name: id, category, color: '', season: '四季' })
const ids = (items: WardrobeItem[]) => items.map(value => value.id)
const MB = 1024 * 1024
const photo = (size = 4, mime = 'image/png') => new Blob([new Uint8Array(size)], { type: mime })

beforeEach(async () => {
  // Node Blob survives fake-indexeddb's structuredClone, unlike jsdom Blob.
  vi.stubGlobal('Blob', NodeBlob)
  await wardrobePhotoDb.photos.clear()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await wardrobePhotoDb.photos.clear()
  vi.unstubAllGlobals()
  localStorage.removeItem(WARDROBE_KEY)
})

describe('wardrobe metadata compatibility', () => {
  it('keeps the original key, Chinese category ids and reference category order', () => {
    expect(WARDROBE_KEY).toBe('aily.ext.wardrobe')
    expect(wardrobeCategories.slice(0, 6).map(category => category.id)).toEqual(['上装', '下装', '连体装', '半身裙', '鞋子', '包包'])
    expect(wardrobeCategories.slice(0, 6).map(category => category.zh)).toEqual(['上衣', '裤子', '连体装', '半身裙', '鞋子', '包包'])
    expect(wardrobeCategories.slice(6).map(category => category.id)).toEqual(['外套', '配饰', '鞋包'])
    expect(wardrobeCategories.every(category => category.en.length > 0)).toBe(true)
  })

  it('validates legacy and custom properties without normalization or corruption', () => {
    const records = [
      { ...item('legacy', '鞋包'), favorite: true, custom: { tags: ['旅行'], size: 37 } },
      { ...item('custom', '自定义分类'), photoId: 'local-photo', vendor: '手作', season: '' },
      { ...item('', ''), name: '', extra: null },
    ]
    const serialized = JSON.stringify(records)
    localStorage.setItem(WARDROBE_KEY, serialized)
    const parsed: unknown[] = JSON.parse(localStorage.getItem(WARDROBE_KEY)!)
    expect(parsed.every(isWardrobeItem)).toBe(true)
    expect(JSON.stringify(parsed)).toBe(serialized)
    expect(parsed.filter(isWardrobeItem)).toEqual(records)
    expect(localStorage.getItem(WARDROBE_KEY)).toBe(serialized)
  })

  it.each([null, [], 'cloth', {}, { ...item('a', '上装'), id: 1 }, { ...item('a', '上装'), name: null }, { ...item('a', '上装'), category: [] }, { ...item('a', '上装'), color: 3 }, { ...item('a', '上装'), season: false }, { ...item('a', '上装'), photoId: 5 }, { ...item('a', '上装'), photoId: null }])('rejects malformed metadata: %j', value => {
    expect(isWardrobeItem(value)).toBe(false)
  })
})

describe('generateWardrobeOutfit', () => {
  it('never invents clothes, changes inputs or drops selected custom fields', () => {
    const clothes = [Object.freeze({ ...item('top', '上装'), custom: { favorite: true } }), Object.freeze(item('bottom', '下装')), Object.freeze(item('coat', '外套')), Object.freeze(item('shoes', '鞋包'))]
    const original = JSON.stringify(clothes)
    const outfit = generateWardrobeOutfit(Object.freeze(clothes))
    expect(ids(outfit)).toEqual(['top', 'bottom', 'coat', 'shoes'])
    expect(outfit.every(value => clothes.includes(value))).toBe(true)
    expect(outfit[0].custom).toEqual({ favorite: true })
    expect(JSON.stringify(clothes)).toBe(original)
    expect(generateWardrobeOutfit([])).toEqual([])
    expect(generateWardrobeOutfit([item('unknown', '自定义分类')])).toEqual([])
  })

  it('chooses separates OR a one-piece, with at most one item per optional slot', () => {
    const clothes = ['上装', '上装', '下装', '半身裙', '连体装', '连衣裙', '外套', '外套', '鞋子', '鞋子', '包包', '配饰', '配饰', '鞋包'].map((category, index) => item(String(index), category))
    for (let index = 0; index < 100; index++) {
      const outfit = generateWardrobeOutfit(clothes)
      const count = (...categories: string[]) => outfit.filter(value => categories.includes(value.category)).length
      expect(new Set(ids(outfit)).size).toBe(outfit.length)
      expect(count('连体装', '连衣裙') + count('上装')).toBe(1)
      if (count('连体装', '连衣裙')) expect(count('下装', '半身裙')).toBe(0)
      else expect(count('下装', '半身裙')).toBe(1)
      for (const category of ['外套', '鞋子', '包包', '配饰']) expect(count(category)).toBe(1)
      expect(count('鞋包')).toBe(0)
      expect(outfit.every(value => clothes.includes(value))).toBe(true)
    }
  })

  it('supports dress aliases, skirts, incomplete wardrobes and legacy combined slots', () => {
    expect(ids(generateWardrobeOutfit([item('dress', '连衣裙'), item('top', '上装')]))).toEqual(['dress'])
    expect(ids(generateWardrobeOutfit([item('top', '上装'), item('skirt', '半身裙')]))).toEqual(['top', 'skirt'])
    expect(ids(generateWardrobeOutfit([item('top', '上装')]))).toEqual(['top'])
    expect(ids(generateWardrobeOutfit([item('legacy', '鞋包'), item('bag', '包包')]))).toEqual(['bag', 'legacy'])
    expect(generateWardrobeOutfit([item('a', '鞋包'), item('b', '鞋包')])).toHaveLength(1)
    expect(generateWardrobeOutfit([item('duplicate', '上装'), item('duplicate', '下装')])).toHaveLength(1)
  })

  it('avoids previous slot ids and changes base mode when alternatives exist', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const clothes = [item('t1', '上装'), item('t2', '上装'), item('b', '下装')]
    expect(ids(generateWardrobeOutfit(clothes, ['t1', 'b']))).toEqual(['t2', 'b'])
    const withDress = [...clothes, item('d', '连体装')]
    expect(ids(generateWardrobeOutfit(withDress, ['t1', 'b']))).toEqual(['d'])
    expect(ids(generateWardrobeOutfit(withDress, ['d']))).toEqual(['t1', 'b'])
    expect(ids(generateWardrobeOutfit([item('only', '上装')], ['only']))).toEqual(['only'])
  })
})

describe('wardrobe local photo storage', () => {
  it.each(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'])('persists exact %s bytes across database reopen with only id/blob fields', async mime => {
    const blob = new Blob([new Uint8Array([0, 17, 128, 255])], { type: mime })
    const id = await saveWardrobePhoto(blob)
    wardrobePhotoDb.close()
    await wardrobePhotoDb.open()
    const saved = await wardrobePhotoDb.photos.get(id)
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    expect(Object.keys(saved!).sort()).toEqual(['blob', 'id'])
    expect(saved?.blob.type).toBe(mime)
    expect(new Uint8Array(await saved!.blob.arrayBuffer())).toEqual(new Uint8Array([0, 17, 128, 255]))
    expect(localStorage.getItem(WARDROBE_KEY)).toBeNull()
  })

  it('keeps same-content uploads distinct and stores no binary data in metadata', async () => {
    const first = await saveWardrobePhoto(photo())
    const second = await saveWardrobePhoto(photo())
    expect(first).not.toBe(second)
    const metadata = { ...item('top', '上装'), photoId: first }
    expect(isWardrobeItem(metadata)).toBe(true)
    expect(JSON.stringify(metadata)).not.toContain('base64')
    expect(JSON.stringify(metadata)).not.toContain('blob')
    expect(await wardrobePhotoDb.photos.count()).toBe(2)
  })

  it.each(['', 'application/octet-stream', 'text/plain', 'image/svg+xml', 'image/heic', 'video/mp4'])('rejects unsupported MIME %j without writes', async mime => {
    await expect(saveWardrobePhoto(photo(4, mime))).rejects.toThrow('JPG, PNG, WebP or GIF')
    expect(await wardrobePhotoDb.photos.count()).toBe(0)
  })

  it('rejects non-Blobs and files over 5MB, but accepts the exact limit', async () => {
    await expect(saveWardrobePhoto({ type: 'image/png', size: 1 } as Blob)).rejects.toThrow('JPG')
    await expect(saveWardrobePhoto(photo(5 * MB + 1))).rejects.toThrow('5MB')
    expect(await wardrobePhotoDb.photos.count()).toBe(0)
    await saveWardrobePhoto(photo(5 * MB))
    expect(await wardrobePhotoDb.photos.count()).toBe(1)
  })

  it('allows exactly 50MB total and rejects excess atomically', async () => {
    const blob = photo(5 * MB)
    await wardrobePhotoDb.photos.bulkAdd(Array.from({ length: 9 }, (_, index) => ({ id: `quota-${index}`, blob })))
    await saveWardrobePhoto(blob)
    expect(await wardrobePhotoDb.photos.count()).toBe(10)
    await expect(saveWardrobePhoto(photo(1))).rejects.toThrow('50MB')
    expect(await wardrobePhotoDb.photos.count()).toBe(10)
  })

  it('serializes concurrent quota checks so only the upload that fits succeeds', async () => {
    const blob = photo(5 * MB)
    await wardrobePhotoDb.photos.bulkAdd(Array.from({ length: 9 }, (_, index) => ({ id: `concurrent-${index}`, blob })))
    const outcomes = await Promise.allSettled([saveWardrobePhoto(blob), saveWardrobePhoto(blob)])
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    const failure = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult
    expect(failure.reason.message).toContain('50MB')
    expect(await wardrobePhotoDb.photos.count()).toBe(10)
  })

  it('propagates storage failure, rolls back writes and leaves metadata unchanged', async () => {
    const metadata = JSON.stringify([{ ...item('legacy', '鞋包'), custom: true }])
    localStorage.setItem(WARDROBE_KEY, metadata)
    const failure = new Error('IndexedDB unavailable')
    const add = wardrobePhotoDb.photos.add.bind(wardrobePhotoDb.photos)
    vi.spyOn(wardrobePhotoDb.photos, 'add').mockImplementationOnce(record => add(record).then(() => {
      throw failure
    }))
    await expect(saveWardrobePhoto(photo())).rejects.toBe(failure)
    expect(await wardrobePhotoDb.photos.count()).toBe(0)
    expect(localStorage.getItem(WARDROBE_KEY)).toBe(metadata)
  })

  it('clears only photo blobs, allowing UI to manage metadata independently', async () => {
    const id = await saveWardrobePhoto(photo())
    const metadata = JSON.stringify([{ ...item('top', '上装'), photoId: id, custom: ['preserve'] }])
    localStorage.setItem(WARDROBE_KEY, metadata)
    await clearWardrobePhotos()
    expect(await wardrobePhotoDb.photos.count()).toBe(0)
    expect(localStorage.getItem(WARDROBE_KEY)).toBe(metadata)
  })
})
