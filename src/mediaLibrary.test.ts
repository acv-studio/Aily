import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addLibraryMedia, clearMediaLibrary, mediaDb, mediaMime, MAX_MEDIA_FILE_BYTES } from './mediaLibrary'

beforeEach(async () => { await mediaDb.delete(); await mediaDb.open() })
afterEach(async () => { await mediaDb.delete() })
describe('persistent local media library', () => {
  it('stores selected audio and photos separately and keeps metadata on reopen', async () => {
    await addLibraryMedia('music', [{ name: 'song.mp3', blob: new Blob(['audio'], { type: 'audio/mpeg' }) }])
    await addLibraryMedia('album', [{ name: 'photo.png', blob: new Blob(['image'], { type: 'image/png' }) }])
    const item = await mediaDb.items.where('kind').equals('music').first()
    expect(item).toMatchObject({ name: 'song.mp3', mime: 'audio/mpeg', favorite: false, collection: '' })
    await mediaDb.items.update(item!.id, { favorite: true, collection: 'My songs' })
    mediaDb.close(); await mediaDb.open()
    expect(await mediaDb.items.get(item!.id)).toMatchObject({ favorite: true, collection: 'My songs' })
    expect(await mediaDb.items.where('kind').equals('album').count()).toBe(1)
  })
  it('handles a missing MIME type with allowed file extensions', () => {
    expect(mediaMime('music', 'Music.M4A', '')).toBe('audio/mp4')
    expect(mediaMime('music', 'notes.txt', '')).toBeNull()
    expect(mediaMime('album', 'script.svg', 'text/html')).toBeNull()
  })
  it('rejects invalid and oversized selections without saving a partial import', async () => {
    await expect(addLibraryMedia('music', [{ name: 'okay.mp3', blob: new Blob(['ok'], { type: 'audio/mpeg' }) }, { name: 'wrong.txt', blob: new Blob(['bad'], { type: 'text/plain' }) }])).rejects.toThrow()
    expect(await mediaDb.items.count()).toBe(0)
    await expect(addLibraryMedia('music', [{ name: 'too-big.mp3', blob: { size: MAX_MEDIA_FILE_BYTES + 1, type: 'audio/mpeg' } as Blob }])).rejects.toThrow('50MB')
  })
  it('clears persisted media when local profile data is deleted', async () => {
    await addLibraryMedia('album', [{ name: 'photo.png', blob: new Blob(['image'], { type: 'image/png' }) }])
    await clearMediaLibrary()
    expect(await mediaDb.items.count()).toBe(0)
  })
})
