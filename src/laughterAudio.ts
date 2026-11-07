/** A selected time range, in seconds, in the original decoded audio. */
export interface AudioSegment {
  start: number
  end: number
}

const MAX_AUDIO_BYTES = 256 * 1024 * 1024
const MAX_INPUT_BYTES = 64 * 1024 * 1024
const MAX_CHANNELS = 32

/** Validate, clamp to the source duration, sort, and merge overlapping/touching ranges.
 * Invalid ranges throw; valid ranges entirely outside the source are discarded.
 * The input array and its objects are never mutated.
 */
export function normalizeSegments(segments: AudioSegment[], duration: number): AudioSegment[] {
  if (!Number.isFinite(duration) || duration < 0) throw new RangeError('Invalid audio duration')
  if (!Array.isArray(segments)) throw new TypeError('Audio segments must be an array')
  const clamped: AudioSegment[] = []
  for (const segment of segments) {
    if (!segment || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.end <= segment.start) {
      throw new RangeError('Invalid audio segment: expected finite start < end')
    }
    const start = Math.max(0, Math.min(duration, segment.start))
    const end = Math.max(0, Math.min(duration, segment.end))
    if (end > start) clamped.push({ start, end })
  }
  clamped.sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: AudioSegment[] = []
  for (const segment of clamped) {
    const previous = merged[merged.length - 1]
    if (previous && segment.start <= previous.end) previous.end = Math.max(previous.end, segment.end)
    else merged.push(segment)
  }
  return merged
}

function audioShape(buffer: AudioBuffer) {
  const { sampleRate, numberOfChannels: channels, length } = buffer
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0 || sampleRate > 0xffffffff ||
      !Number.isSafeInteger(channels) || channels < 1 || channels > MAX_CHANNELS ||
      !Number.isSafeInteger(length) || length < 0 || length * channels * 4 > MAX_AUDIO_BYTES) {
    throw new RangeError('Invalid or oversized audio buffer (maximum 256 MiB PCM)')
  }
  return { sampleRate, channels, length, duration: length / sampleRate }
}

function channelData(buffer: AudioBuffer, channels: number, length: number) {
  return Array.from({ length: channels }, (_, index) => {
    const data = buffer.getChannelData(index)
    if (data.length < length) throw new RangeError('Audio channel is shorter than the buffer')
    return data
  })
}

/** Concatenate selections chronologically into an interleaved, little-endian 16-bit PCM WAV.
 * Start/end times are rounded down to sample boundaries; sub-sample/empty selections throw.
 * Overlapping selections are merged, so no sample is duplicated. Nonfinite PCM becomes silence.
 */
export function encodeWav(buffer: AudioBuffer, segments: AudioSegment[]): Blob {
  const { sampleRate, channels, length, duration } = audioShape(buffer)
  const ranges = normalizeSegments(segments, duration).map(segment => ({
    start: Math.min(length, Math.floor(segment.start * sampleRate)),
    end: segment.end === duration ? length : Math.min(length, Math.floor(segment.end * sampleRate)),
  })).filter(range => range.end > range.start)
  const frames = ranges.reduce((total, range) => total + range.end - range.start, 0)
  if (!frames) throw new RangeError('Select at least one audio sample to export')
  const blockAlign = channels * 2
  const dataBytes = frames * blockAlign
  if (dataBytes + 44 > MAX_AUDIO_BYTES || dataBytes + 36 > 0xffffffff || sampleRate * blockAlign > 0xffffffff) {
    throw new RangeError('WAV export exceeds size limits')
  }
  const source = channelData(buffer, channels, length)
  const bytes = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(bytes)
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, dataBytes, true)
  let offset = 44
  for (const range of ranges) {
    for (let frame = range.start; frame < range.end; frame++) {
      for (let channel = 0; channel < channels; channel++) {
        const raw = source[channel][frame]
        const value = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0
        view.setInt16(offset, Math.round(value * (value < 0 ? 32768 : 32767)), true)
        offset += 2
      }
    }
  }
  return new Blob([bytes], { type: 'audio/wav' })
}

/** Suggest audible regions using 20 ms RMS windows and 120 ms edge padding.
 * This is ONLY a basic silence trimmer, NOT a laughter classifier: speech, music,
 * noise, and laughter can all be suggested. Users must review the selections.
 */
export function suggestSoundSegments(buffer: AudioBuffer): AudioSegment[] {
  const { sampleRate, channels, length, duration } = audioShape(buffer)
  if (!length) return []
  const source = channelData(buffer, channels, length)
  const windowSize = Math.max(1, Math.round(sampleRate * 0.02))
  const rms = new Float32Array(Math.ceil(length / windowSize))
  let peak = 0
  for (let start = 0; start < length; start += windowSize) {
    const end = Math.min(length, start + windowSize)
    let energy = 0
    for (let channel = 0; channel < channels; channel++) {
      for (let frame = start; frame < end; frame++) {
        const value = source[channel][frame]
        if (Number.isFinite(value)) energy += Math.min(1, Math.abs(value)) ** 2
      }
    }
    const level = Math.sqrt(energy / ((end - start) * channels))
    rms[Math.floor(start / windowSize)] = level
    peak = Math.max(peak, level)
  }
  const threshold = Math.max(0.015, peak * 0.12)
  const segments: AudioSegment[] = []
  let activeStart: number | undefined
  for (let index = 0; index <= rms.length; index++) {
    if (index < rms.length && rms[index] >= threshold) {
      if (activeStart === undefined) activeStart = index * windowSize / sampleRate
    } else if (activeStart !== undefined) {
      segments.push({ start: activeStart - 0.12, end: Math.min(length, index * windowSize) / sampleRate + 0.12 })
      activeStart = undefined
    }
  }
  return normalizeSegments(segments, duration)
}

async function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read audio file'))
    reader.onabort = () => reject(new Error('Audio file reading was aborted'))
    reader.readAsArrayBuffer(blob)
  })
}

/** Decode locally using Web Audio; always close the temporary AudioContext.
 * Compressed inputs are capped at 64 MiB and decoded PCM at 256 MiB.
 */
export async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  if (!Number.isFinite(blob.size) || blob.size <= 0 || blob.size > MAX_INPUT_BYTES) {
    throw new RangeError('Audio file must be nonempty and at most 64 MiB')
  }
  const constructors = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }
  const Context = constructors.AudioContext ?? constructors.webkitAudioContext
  if (!Context) throw new Error('Audio decoding is not supported in this browser')
  const context = new Context()
  try {
    const buffer = await context.decodeAudioData(await readBlob(blob))
    audioShape(buffer)
    return buffer
  } finally {
    // A browser cleanup error must not hide the original decoding error.
    try { await context.close() } catch { /* already closed or browser cleanup failure */ }
  }
}
