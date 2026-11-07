import { Blob as NodeBlob } from 'node:buffer'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addLibraryMedia, clearMediaLibrary, mediaDb, mediaMime, MAX_MEDIA_FILE_BYTES } from './mediaLibrary'

beforeEach(async () => { await mediaDb.delete(); await mediaDb.open() })
afterEach(async () => { vi.restoreAllMocks(); await mediaDb.delete() })
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
    await mediaDb.photoDecisions.add({ id: 'photo', status: 'keep', updatedAt: 'old' })
    await mediaDb.settings.put({ key: 'default-music-initialized-v1', value: { version: 1, initialized: true } })
    await clearMediaLibrary()
    expect(await mediaDb.items.count()).toBe(0)
    expect(await mediaDb.photoDecisions.count()).toBe(0)
    expect(await mediaDb.settings.count()).toBe(0)
  })
  it('rolls factory reset back if clearing the marker table fails', async () => {
    await addLibraryMedia('music', [{ name: 'song.wav', blob: new Blob(['audio'], { type: 'audio/wav' }) }])
    await mediaDb.photoDecisions.add({ id: 'photo', status: 'keep', updatedAt: 'old' })
    await mediaDb.settings.put({ key: 'marker', value: true })
    vi.spyOn(mediaDb.settings, 'clear').mockRejectedValueOnce(new Error('reset failed'))
    await expect(clearMediaLibrary()).rejects.toThrow('reset failed')
    expect(await mediaDb.items.count()).toBe(1)
    expect(await mediaDb.photoDecisions.count()).toBe(1)
    expect(await mediaDb.settings.get('marker')).toEqual({ key: 'marker', value: true })
  })
  it.each([1, 2])('upgrades version %i without losing legacy media or photo decisions', async version => {
    await mediaDb.delete()
    const legacyDb = new Dexie(mediaDb.name)
    legacyDb.version(1).stores({ items: 'id,kind,addedAt' })
    if (version === 2) legacyDb.version(2).stores({ items: 'id,kind,addedAt', photoDecisions: 'id,status' })
    await legacyDb.open()
    const legacy = { id: 'legacy-song', kind: 'music', name: 'Custom song', blob: new NodeBlob(['legacy audio bytes'], { type: 'audio/wav' }), mime: 'audio/wav', addedAt: 'old', favorite: true, collection: 'Custom collection' }
    await legacyDb.table('items').add(legacy)
    if (version === 2) await legacyDb.table('photoDecisions').add({ id: 'photo', status: 'keep', updatedAt: 'old' })
    legacyDb.close()
    await mediaDb.open()
    expect(mediaDb.verno).toBe(3)
    expect(await mediaDb.items.get(legacy.id)).toEqual(legacy)
    expect(await (await mediaDb.items.get(legacy.id))!.blob.text()).toBe('legacy audio bytes')
    expect(await mediaDb.photoDecisions.count()).toBe(version === 2 ? 1 : 0)
    expect(await mediaDb.settings.count()).toBe(0)
  })
})
