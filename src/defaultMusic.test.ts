import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearMediaLibrary, MAX_MEDIA_LIBRARY_BYTES, mediaDb, type LibraryMedia } from './mediaLibrary'
import { createDefaultMusicWav, DEFAULT_MUSIC_ARTIST, DEFAULT_MUSIC_ID, DEFAULT_MUSIC_NAME, DEFAULT_MUSIC_SETTING_KEY, ensureDefaultMusic } from './defaultMusic'

const marker = () => mediaDb.settings.get(DEFAULT_MUSIC_SETTING_KEY)
const item = (id = 'user-song', kind: 'music' | 'album' = 'music'): LibraryMedia => ({
  id, kind, name: '用户自定义名称', artist: 'My artist', blob: new Blob(['original bytes'], { type: kind === 'music' ? 'audio/wav' : 'image/png' }),
  mime: kind === 'music' ? 'audio/wav' : 'image/png', addedAt: '2020-01-01T00:00:00.000Z', favorite: true, collection: 'My collection',
})
beforeEach(async () => {
  // Native structuredClone preserves native Blob bytes in fake-indexeddb, like real browsers.
  vi.stubGlobal('Blob', NodeBlob)
  await mediaDb.delete(); await mediaDb.open()
})
afterEach(async () => { vi.restoreAllMocks(); await mediaDb.delete(); vi.unstubAllGlobals() })

describe('original local ambient WAV', () => {
  it('encodes deterministic valid mono PCM16 with smooth, non-silent bounded samples', async () => {
    const wav = await createDefaultMusicWav(0.25)
    const data = await wav.arrayBuffer()
    const view = new DataView(data)
    const text = (start: number, end: number) => new TextDecoder().decode(data.slice(start, end))
    expect(wav.type).toBe('audio/wav')
    expect(text(0, 4)).toBe('RIFF'); expect(text(8, 12)).toBe('WAVE')
    expect(view.getUint32(4, true)).toBe(data.byteLength - 8)
    expect(text(12, 16)).toBe('fmt '); expect(view.getUint32(16, true)).toBe(16)
    expect(view.getUint16(20, true)).toBe(1); expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(22050); expect(view.getUint32(28, true)).toBe(44100)
    expect(view.getUint16(32, true)).toBe(2); expect(view.getUint16(34, true)).toBe(16)
    expect(text(36, 40)).toBe('data'); expect(view.getUint32(40, true)).toBe(data.byteLength - 44)
    expect((data.byteLength - 44) / 44100).toBeCloseTo(0.25, 4)
    let peak = 0; let jump = 0; let previous = 0; let positive = false; let negative = false
    for (let offset = 44; offset < data.byteLength; offset += 2) {
      const sample = view.getInt16(offset, true)
      peak = Math.max(peak, Math.abs(sample)); jump = Math.max(jump, Math.abs(sample - previous)); previous = sample
      positive ||= sample > 0; negative ||= sample < 0
    }
    expect(peak).toBeGreaterThan(1000); expect(peak).toBeLessThan(16000)
    expect(jump).toBeLessThan(2500); expect(positive && negative).toBe(true)
    expect(view.getInt16(44, true)).toBe(0); expect(Math.abs(previous)).toBeLessThan(3)
    expect(await (await createDefaultMusicWav(0.25)).arrayBuffer()).toEqual(data)
  })
  it('rejects invalid or oversized durations', async () => {
    for (const duration of [0, -1, NaN, Infinity, 91]) await expect(createDefaultMusicWav(duration)).rejects.toThrow(RangeError)
  })
})

describe('one-time default music initialization', () => {
  it('adds a 72-second playable default alongside all existing music/photos without overwrites', async () => {
    const music = item(); const photo = item('photo', 'album')
    await mediaDb.items.bulkAdd([music, photo])
    await mediaDb.photoDecisions.add({ id: photo.id, status: 'keep', updatedAt: 'old' })
    await ensureDefaultMusic()
    const defaultItem = await mediaDb.items.get(DEFAULT_MUSIC_ID)
    expect(defaultItem).toMatchObject({ name: DEFAULT_MUSIC_NAME, artist: DEFAULT_MUSIC_ARTIST, kind: 'music', favorite: false, mime: 'audio/wav' })
    expect(defaultItem!.blob.size).toBe(44 + 72 * 22050 * 2)
    expect(defaultItem!.blob.size).toBeLessThan(4 * 1024 * 1024)
    for (const original of [music, photo]) {
      const stored = await mediaDb.items.get(original.id)
      expect(stored).toMatchObject({ name: original.name, artist: original.artist, addedAt: original.addedAt, favorite: true, collection: original.collection })
      expect(await stored!.blob.text()).toBe('original bytes')
    }
    expect(await mediaDb.photoDecisions.get(photo.id)).toMatchObject({ status: 'keep', updatedAt: 'old' })
    expect(await marker()).toMatchObject({ value: { version: 1, initialized: true } })
  })
  it('persists deletion intent across reopen, and only explicitly restores a missing default', async () => {
    await ensureDefaultMusic()
    await mediaDb.items.delete(DEFAULT_MUSIC_ID)
    mediaDb.close(); await mediaDb.open()
    await ensureDefaultMusic()
    expect(await mediaDb.items.get(DEFAULT_MUSIC_ID)).toBeUndefined()
    await ensureDefaultMusic({ restore: true })
    expect(await mediaDb.items.get(DEFAULT_MUSIC_ID)).toBeDefined()
    await mediaDb.items.update(DEFAULT_MUSIC_ID, { name: '我的晚风', favorite: true, collection: '私人歌单', artist: 'Custom' })
    const before = await mediaDb.items.get(DEFAULT_MUSIC_ID)
    await ensureDefaultMusic({ restore: true }); await ensureDefaultMusic()
    expect(await mediaDb.items.get(DEFAULT_MUSIC_ID)).toEqual(before)
  })
  it('adopts a legacy default without changing any bytes or metadata', async () => {
    const legacy = item(DEFAULT_MUSIC_ID)
    await mediaDb.items.add(legacy)
    await ensureDefaultMusic()
    expect(await mediaDb.items.get(DEFAULT_MUSIC_ID)).toEqual(legacy)
    expect(await marker()).toMatchObject({ value: { version: 1, initialized: true } })
  })
  it('deduplicates concurrent first-open and explicit restore calls', async () => {
    await Promise.all([ensureDefaultMusic(), ensureDefaultMusic(), ensureDefaultMusic({ restore: true })])
    expect(await mediaDb.items.count()).toBe(1)
    await mediaDb.items.delete(DEFAULT_MUSIC_ID)
    await Promise.all([ensureDefaultMusic({ restore: true }), ensureDefaultMusic({ restore: true })])
    expect(await mediaDb.items.count()).toBe(1)
  })
  it('rejects insufficient quota without changing old rows or writing a marker', async () => {
    // Quota accounting needs only Blob.size; do not allocate 200 MB in a unit test.
    const full = { ...item(), blob: { size: MAX_MEDIA_LIBRARY_BYTES - 1 } as Blob }
    await mediaDb.items.add(full)
    await expect(ensureDefaultMusic()).rejects.toThrow('200MB')
    expect(await mediaDb.items.toArray()).toEqual([full]); expect(await marker()).toBeUndefined()
    await mediaDb.settings.put({ key: DEFAULT_MUSIC_SETTING_KEY, value: { version: 1, initialized: true } })
    await expect(ensureDefaultMusic({ restore: true })).rejects.toThrow('200MB')
    expect(await marker()).toMatchObject({ value: { version: 1, initialized: true } })
    expect(await mediaDb.items.toArray()).toEqual([full])
  })
  it('rolls insertion back when writing the marker fails', async () => {
    const old = item(); await mediaDb.items.add(old)
    vi.spyOn(mediaDb.settings, 'put').mockRejectedValueOnce(new Error('database write failed'))
    await expect(ensureDefaultMusic()).rejects.toThrow('database write failed')
    expect(await mediaDb.items.toArray()).toEqual([old]); expect(await marker()).toBeUndefined()
  })
  it('rejects corrupt markers rather than silently resetting or restoring', async () => {
    for (const value of [true, { version: 2, initialized: true }, { version: 1, initialized: 'true' }, null]) {
      await mediaDb.settings.put({ key: DEFAULT_MUSIC_SETTING_KEY, value })
      await expect(ensureDefaultMusic()).rejects.toThrow('标记损坏')
      await expect(ensureDefaultMusic({ restore: true })).rejects.toThrow('标记损坏')
      expect(await marker()).toEqual({ key: DEFAULT_MUSIC_SETTING_KEY, value })
      expect(await mediaDb.items.count()).toBe(0)
    }
  })
  it('accepts a valid false marker and factory reset permits first-open seeding again', async () => {
    await mediaDb.settings.put({ key: DEFAULT_MUSIC_SETTING_KEY, value: { version: 1, initialized: false } })
    await ensureDefaultMusic()
    expect(await mediaDb.items.count()).toBe(1)
    await clearMediaLibrary()
    expect(await marker()).toBeUndefined()
    await ensureDefaultMusic()
    expect(await mediaDb.items.count()).toBe(1)
  })
})
