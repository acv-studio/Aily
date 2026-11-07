import { MAX_MEDIA_LIBRARY_BYTES, mediaDb, type LibraryMedia, type MediaSetting } from './mediaLibrary'

export const DEFAULT_MUSIC_ID = 'aily-default-evening-breeze-v1'
export const DEFAULT_MUSIC_NAME = '晚风慢调'
export const DEFAULT_MUSIC_ARTIST = 'Aily Studio'
export const DEFAULT_MUSIC_SETTING_KEY = 'default-music-initialized-v1'
const SAMPLE_RATE = 22050
const TRACK_SECONDS = 72
const TAU = Math.PI * 2
const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
// Original Cmaj7 / Am7 / Fmaj7 / Gsus2 voicings, with a slow, floating top line.
const CHORDS = [[48, 55, 59, 64], [45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 57, 62]].map(chord => chord.map(frequency))
const MELODY = [76, 79, 74, 71, 72, 76, 79, 76, 76, 72, 69, 72, 79, 76, 72, 69,
  69, 72, 76, 79, 76, 72, 69, 67, 74, 69, 67, 69, 74, 79, 74, 71].map(frequency)

/** Locally synthesizes original music. No fetch, AudioContext, or playback side effects. */
export async function createDefaultMusicWav(durationSeconds = TRACK_SECONDS): Promise<Blob> {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 90) {
    throw new RangeError('Music duration must be greater than zero and at most 90 seconds.')
  }
  const frames = Math.max(1, Math.round(durationSeconds * SAMPLE_RATE))
  const duration = frames / SAMPLE_RATE
  const buffer = new ArrayBuffer(44 + frames * 2)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE')
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true); view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, frames * 2, true)
  const fadeSeconds = Math.min(2.5, duration / 3)
  const chunkFrames = Math.floor(SAMPLE_RATE * 0.75)
  const padTone = (hz: number, t: number) => Math.sin(TAU * hz * t) + 0.16 * Math.sin(TAU * hz * 2 * t)
  for (let start = 0; start < frames; start += chunkFrames) {
    const end = Math.min(frames, start + chunkFrames)
    for (let frame = start; frame < end; frame++) {
      const t = frame / SAMPLE_RATE
      const chordIndex = Math.floor(t / 6) % CHORDS.length
      const chord = CHORDS[chordIndex]
      const previous = CHORDS[(chordIndex + CHORDS.length - 1) % CHORDS.length]
      const crossfade = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, (t % 6) / 1.5))
      let pad = 0
      for (let n = 0; n < chord.length; n++) {
        pad += (padTone(chord[n], t) * crossfade + padTone(previous[n], t) * (1 - crossfade)) * 0.034
      }
      const noteTime = t % 0.75
      const leadHz = MELODY[Math.floor(t / 0.75) % MELODY.length]
      const leadEnvelope = (1 - Math.exp(-noteTime / 0.065)) * Math.exp(-noteTime / 0.48)
        * Math.min(1, (0.75 - noteTime) / 0.12)
      const lead = (Math.sin(TAU * leadHz * noteTime) + 0.12 * Math.sin(TAU * leadHz * 2 * noteTime)) * leadEnvelope * 0.15
      const arpTime = t % 0.375
      const arpHz = chord[[0, 2, 1, 3, 2, 1, 3, 1][Math.floor(t / 0.375) % 8]] * 2
      const arpEnvelope = (1 - Math.exp(-arpTime / 0.025)) * Math.exp(-arpTime / 0.18)
        * Math.min(1, (0.375 - arpTime) / 0.06)
      const arp = Math.sin(TAU * arpHz * arpTime) * arpEnvelope * 0.07
      const fadeIn = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, t / fadeSeconds))
      const fadeOut = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, (duration - t) / fadeSeconds))
      const sample = (pad * (0.94 + 0.06 * Math.sin(TAU * 0.12 * t)) + lead + arp) * fadeIn * fadeOut
      // Analytic amplitude bound is below 0.4; guard the encoder too.
      view.setInt16(44 + frame * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true)
    }
    // Yield only outside IndexedDB transactions, keeping rendering responsive.
    if (end < frames) await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

function isInitialized(setting: MediaSetting | undefined): boolean {
  if (!setting) return false
  const value = setting.value
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
    || !('initialized' in value) || typeof value.initialized !== 'boolean') {
    throw new Error('默认音乐初始化标记损坏，请勿自动重置本机媒体数据。')
  }
  return value.initialized
}

/** Seed on MusicApp open only. A persisted marker respects subsequent user deletion. */
export async function ensureDefaultMusic({ restore = false }: { restore?: boolean } = {}): Promise<void> {
  const initial = await mediaDb.transaction('r', mediaDb.items, mediaDb.settings, async () => ({
    initialized: isInitialized(await mediaDb.settings.get(DEFAULT_MUSIC_SETTING_KEY)),
    existing: await mediaDb.items.get(DEFAULT_MUSIC_ID),
  }))
  if (initial.initialized && !restore) return

  // Adopt a legacy default row without changing its bytes or customized metadata.
  if (initial.existing) {
    const done = await mediaDb.transaction('rw', mediaDb.items, mediaDb.settings, async () => {
      const initialized = isInitialized(await mediaDb.settings.get(DEFAULT_MUSIC_SETTING_KEY))
      if (initialized && !restore) return true
      if (!await mediaDb.items.get(DEFAULT_MUSIC_ID)) return false
      if (!initialized) await mediaDb.settings.put({ key: DEFAULT_MUSIC_SETTING_KEY, value: { version: 1, initialized: true } })
      return true
    })
    if (done) return
  }

  const blob = await createDefaultMusicWav()
  await mediaDb.transaction('rw', mediaDb.items, mediaDb.settings, async () => {
    const initialized = isInitialized(await mediaDb.settings.get(DEFAULT_MUSIC_SETTING_KEY))
    if (initialized && !restore) return
    if (!await mediaDb.items.get(DEFAULT_MUSIC_ID)) {
      const total = (await mediaDb.items.toArray()).reduce((bytes, item) => bytes + item.blob.size, 0)
      if (total + blob.size > MAX_MEDIA_LIBRARY_BYTES) throw new Error('本机媒体库已超过 200MB，请先移除不需要的媒体。')
      await mediaDb.items.add({
        id: DEFAULT_MUSIC_ID, kind: 'music', name: DEFAULT_MUSIC_NAME, artist: DEFAULT_MUSIC_ARTIST,
        blob, mime: 'audio/wav', addedAt: new Date().toISOString(), favorite: false, collection: '',
      } satisfies LibraryMedia)
    }
    if (!initialized) await mediaDb.settings.put({ key: DEFAULT_MUSIC_SETTING_KEY, value: { version: 1, initialized: true } })
  })
}
