import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSkincarePhotos, getSkincarePhoto, MAX_SKIN_PHOTO_BYTES, MAX_SKIN_PHOTOS, removeSkincarePhotos, saveSkincarePhotos, skincarePhotoDb } from './skincarePhotos'

const file = (name = '护肤.png', mime = 'image/png', size = 4) => ({
  name, blob: new Blob([new Uint8Array(size)], { type: mime }),
})

beforeEach(async () => {
  // Native Node Blob retains its bytes through fake-indexeddb structuredClone.
  vi.stubGlobal('Blob', NodeBlob)
  await skincarePhotoDb.photos.clear()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await skincarePhotoDb.photos.clear()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('isolated local skincare photos', () => {
  it('uses the exact isolated database name, table key and limits', () => {
    expect(skincarePhotoDb.name).toBe('aily-skincare-photos-v1')
    expect(skincarePhotoDb.photos.schema.primKey.keyPath).toBe('id')
    expect(MAX_SKIN_PHOTO_BYTES).toBe(5 * 1024 * 1024)
    expect(MAX_SKIN_PHOTOS).toBe(3)
  })

  it('atomically persists JPEG/PNG/WebP rows with exact bytes across database reopen', async () => {
    const inputs = ['image/jpeg', 'image/png', 'image/webp'].map((mime, index) => ({
      name: `护肤-${index}.photo`, blob: new Blob([new Uint8Array([0, 17, 128, 255])], { type: mime }),
    }))
    const ids = await saveSkincarePhotos(inputs)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
    expect(ids.every(id => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id))).toBe(true)
    skincarePhotoDb.close()
    await skincarePhotoDb.open()
    for (const [index, id] of ids.entries()) {
      const saved = await getSkincarePhoto(id)
      expect(Object.keys(saved!).sort()).toEqual(['blob', 'createdAt', 'id', 'name'])
      expect(saved!.name).toBe(inputs[index].name)
      expect(saved!.blob.type).toBe(inputs[index].blob.type)
      expect(new Uint8Array(await saved!.blob.arrayBuffer())).toEqual(new Uint8Array([0, 17, 128, 255]))
      expect(new Date(saved!.createdAt).toISOString()).toBe(saved!.createdAt)
    }
    expect(localStorage.length).toBe(0)
  })

  it.each(['', 'image/svg+xml', 'image/gif', 'image/jpg', 'image/heic', 'text/plain', 'application/octet-stream', 'video/mp4'])('rejects unsupported MIME %j before any batch writes', async mime => {
    const bulkAdd = vi.spyOn(skincarePhotoDb.photos, 'bulkAdd')
    await expect(saveSkincarePhotos([file('valid.png'), file('invalid', mime)])).rejects.toThrow('JPEG, PNG or WebP')
    expect(bulkAdd).not.toHaveBeenCalled()
    expect(await skincarePhotoDb.photos.count()).toBe(0)
  })

  it.each(['', ' ', '.', '..', '../photo.png', 'folder/photo.png', 'folder\\photo.png', 'https://example.test/photo.png', 'data:image/png;base64,AA', 'photo\u0000.png', 'photo\n.png', 'a'.repeat(256)])('rejects unsafe filename %j before writing a valid first file', async name => {
    await expect(saveSkincarePhotos([file('valid.png'), file(name)])).rejects.toThrow('filename')
    expect(await skincarePhotoDb.photos.count()).toBe(0)
  })

  it('validates maximum selection and individual size before writes; accepts exact 5MB', async () => {
    await expect(saveSkincarePhotos(Array.from({ length: 4 }, () => file()))).rejects.toThrow('at most 3')
    await expect(saveSkincarePhotos([file(), file('too-big.png', 'image/png', MAX_SKIN_PHOTO_BYTES + 1)])).rejects.toThrow('5MB')
    await expect(saveSkincarePhotos([file(), { name: 'fake.png', blob: { type: 'image/png', size: 1 } as Blob }])).rejects.toThrow('JPEG')
    await expect(saveSkincarePhotos([{ name: 'url.png', blob: 'https://example.test/a.png' as unknown as Blob }])).rejects.toThrow('JPEG')
    expect(await skincarePhotoDb.photos.count()).toBe(0)
    expect(await saveSkincarePhotos([])).toEqual([])
    const ids = await saveSkincarePhotos([file('limit.png', 'image/png', MAX_SKIN_PHOTO_BYTES)])
    expect((await getSkincarePhoto(ids[0]))?.blob.size).toBe(MAX_SKIN_PHOTO_BYTES)
  })

  it('rolls back all successful rows when a real bulkAdd duplicate-key failure occurs', async () => {
    const [existing] = await saveSkincarePhotos([file('existing.png')])
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce(existing as ReturnType<typeof crypto.randomUUID>)
    await expect(saveSkincarePhotos([file('would-add.png'), file('duplicate.png')])).rejects.toThrow()
    expect(await skincarePhotoDb.photos.count()).toBe(1)
    expect(await getSkincarePhoto('00000000-0000-4000-8000-000000000001')).toBeUndefined()
    expect((await getSkincarePhoto(existing))?.name).toBe('existing.png')
  })

  it('removes only exact requested IDs, tolerates repeats/missing IDs and validates before deleting', async () => {
    const ids = await saveSkincarePhotos([file('one.png'), file('two.png'), file('three.png')])
    await expect(removeSkincarePhotos([ids[0], '../unsafe'])).rejects.toThrow('ID')
    expect(await skincarePhotoDb.photos.count()).toBe(3)
    await removeSkincarePhotos([ids[1], ids[1], 'missing-safe-id'])
    expect(await getSkincarePhoto(ids[1])).toBeUndefined()
    expect((await getSkincarePhoto(ids[0]))?.name).toBe('one.png')
    expect((await getSkincarePhoto(ids[2]))?.name).toBe('three.png')
    await removeSkincarePhotos([])
    await expect(getSkincarePhoto('https://example.test/photo')).rejects.toThrow('ID')
    expect(await skincarePhotoDb.photos.count()).toBe(2)
  })

  it('clears only skincare binary rows without rewriting record, plan or shared album metadata', async () => {
    const [id] = await saveSkincarePhotos([file()])
    const metadata = JSON.stringify([{ id: 'record', photoIds: [id], custom: true }])
    localStorage.setItem('aily.ext.skincare', metadata)
    localStorage.setItem('aily.ext.skincare-plans.v1', 'original-plans')
    localStorage.setItem('aily.album', 'private-unrelated-album')
    await clearSkincarePhotos()
    await clearSkincarePhotos()
    expect(await skincarePhotoDb.photos.count()).toBe(0)
    expect(localStorage.getItem('aily.ext.skincare')).toBe(metadata)
    expect(localStorage.getItem('aily.ext.skincare-plans.v1')).toBe('original-plans')
    expect(localStorage.getItem('aily.album')).toBe('private-unrelated-album')
  })
})
