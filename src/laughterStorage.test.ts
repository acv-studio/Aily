import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearLaughterLibrary, laughterDb, MAX_LAUGHTER_BYTES, saveLaughter, type LaughterRecording } from './laughterStorage'
beforeEach(async () => { vi.stubGlobal('Blob', NodeBlob); await laughterDb.recordings.clear() })
afterEach(() => vi.unstubAllGlobals())
const record = (): LaughterRecording => ({ id: crypto.randomUUID(), person: 'Mom', name: 'Laugh', duration: 2, createdAt: new Date().toISOString(), blob: new Blob(['audio'], { type: 'audio/wav' }) })
it('persists real audio bytes across database reopen, not just metadata', async () => {
  const item = record(); await saveLaughter(item); laughterDb.close(); await laughterDb.open()
  const saved = await laughterDb.recordings.get(item.id)
  expect(saved?.blob.size).toBe(item.blob.size); expect(saved?.blob.type).toBe('audio/wav')
  expect(await saved?.blob.text()).toBe('audio')
})
it('rejects empty people, empty audio and invalid durations without writes', async () => {
  for (const overrides of [{ person: ' ' }, { blob: new Blob([]) }, { duration: NaN }, { duration: 0 }, { blob: { size: MAX_LAUGHTER_BYTES + 1 } as Blob }]) {
    await expect(saveLaughter({ ...record(), ...overrides })).rejects.toThrow()
  }
  expect(await laughterDb.recordings.count()).toBe(0)
})
it('rejects exceeding the collection quota atomically', async () => {
  // Existing oversized fixture avoids allocating hundreds of MB in this test.
  await laughterDb.recordings.add({ ...record(), blob: { size: 200 * 1024 * 1024 } as Blob })
  await expect(saveLaughter(record())).rejects.toThrow('Local library full')
  expect(await laughterDb.recordings.count()).toBe(1)
})
it('clears the dedicated library for local-profile deletion', async () => {
  await saveLaughter(record()); await clearLaughterLibrary(); expect(await laughterDb.recordings.count()).toBe(0)
})
