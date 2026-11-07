import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeAudio, encodeWav, normalizeSegments, suggestSoundSegments } from './laughterAudio'

function fakeBuffer(channelSamples: number[][], sampleRate = 1000): AudioBuffer {
  const data = channelSamples.map(samples => Float32Array.from(samples))
  const length = data[0]?.length ?? 0
  return {
    sampleRate,
    numberOfChannels: data.length,
    length,
    duration: length / sampleRate,
    getChannelData: (channel: number) => data[channel],
  } as AudioBuffer
}

async function blobView(blob: Blob): Promise<DataView> {
  // jsdom's Blob does not implement arrayBuffer; inspect the actual Blob via FileReader.
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
  return new DataView(bytes)
}

function ascii(view: DataView, offset: number, length: number) {
  return Array.from({ length }, (_, index) => String.fromCharCode(view.getUint8(offset + index))).join('')
}

function samples(view: DataView) {
  return Array.from({ length: (view.byteLength - 44) / 2 }, (_, index) => view.getInt16(44 + index * 2, true))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('normalizeSegments', () => {
  it('clamps, sorts, merges overlaps and touching intervals without mutating input', () => {
    const input = [{ start: 3, end: 8 }, { start: -2, end: 1 }, { start: 1, end: 2 }, { start: 1.5, end: 4 }, { start: 9, end: 12 }]
    const snapshot = input.map(segment => ({ ...segment }))
    expect(normalizeSegments(input, 10)).toEqual([{ start: 0, end: 8 }, { start: 9, end: 10 }])
    expect(input).toEqual(snapshot)
  })

  it('discards clamped-away ranges and handles empty/zero-duration sources', () => {
    expect(normalizeSegments([{ start: -4, end: -2 }, { start: 8, end: 9 }], 5)).toEqual([])
    expect(normalizeSegments([{ start: 0, end: 1 }], 0)).toEqual([])
    expect(normalizeSegments([], 5)).toEqual([])
  })

  it.each([NaN, Infinity, -Infinity, -1])('rejects invalid duration %s', duration => {
    expect(() => normalizeSegments([], duration)).toThrow('duration')
  })

  it.each([
    { start: NaN, end: 1 }, { start: 0, end: Infinity }, { start: -Infinity, end: 2 },
    { start: 2, end: 1 }, { start: 1, end: 1 },
  ])('rejects invalid range %j', segment => {
    expect(() => normalizeSegments([segment], 5)).toThrow('segment')
  })

  it('rejects malformed runtime inputs', () => {
    expect(() => normalizeSegments(null as unknown as [], 5)).toThrow()
    expect(() => normalizeSegments([null as never], 5)).toThrow()
  })
})

describe('encodeWav', () => {
  it('writes a complete 16-bit stereo WAV header and interleaves selected samples', async () => {
    const buffer = fakeBuffer([[-1, 0, 0.5, 1], [1, 0.5, 0, -1]], 8000)
    const blob = encodeWav(buffer, [{ start: 0, end: buffer.duration }])
    const view = await blobView(blob)
    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBe(60)
    expect(ascii(view, 0, 4)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(blob.size - 8)
    expect(ascii(view, 8, 4)).toBe('WAVE')
    expect(ascii(view, 12, 4)).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16)
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(8000)
    expect(view.getUint32(28, true)).toBe(32000)
    expect(view.getUint16(32, true)).toBe(4)
    expect(view.getUint16(34, true)).toBe(16)
    expect(ascii(view, 36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(16)
    expect(samples(view)).toEqual([-32768, 32767, 0, 16384, 16384, 0, 32767, -32768])
  })

  it('concatenates sorted disjoint ranges, removes gaps, and does not duplicate overlaps', async () => {
    const buffer = fakeBuffer([[0.1, 0.2, 0.3, 0.4, 0.5, 0.6]], 10)
    const blob = encodeWav(buffer, [{ start: 0.4, end: 0.6 }, { start: 0, end: 0.1 }, { start: 0.1, end: 0.2 }, { start: 0.05, end: 0.15 }])
    const view = await blobView(blob)
    expect(view.getUint32(40, true)).toBe(8)
    expect(samples(view)).toEqual([3277, 6553, 16384, 19660])
  })

  it('clamps time boundaries and PCM amplitude, replacing nonfinite samples with silence', async () => {
    const buffer = fakeBuffer([[-2, 2, NaN, Infinity, -Infinity]], 10)
    expect(samples(await blobView(encodeWav(buffer, [{ start: -100, end: 100 }])))).toEqual([-32768, 32767, 0, 0, 0])
  })

  it('keeps the final frame when a full-duration boundary has floating-point rounding', async () => {
    const buffer = fakeBuffer([Array(15).fill(0.5)], 44100)
    const blob = encodeWav(buffer, [{ start: 0, end: buffer.duration }])
    expect(blob.size).toBe(44 + buffer.length * 2)
  })

  it('rounds boundaries down to frames', async () => {
    const buffer = fakeBuffer([[0, 1, -1]], 10)
    expect(samples(await blobView(encodeWav(buffer, [{ start: 0.11, end: 0.29 }])))).toEqual([32767])
  })

  it('rejects empty selections including ranges outside the buffer and sub-sample ranges', () => {
    const buffer = fakeBuffer([[0, 1]], 10)
    for (const selection of [[], [{ start: 1, end: 2 }], [{ start: 0.01, end: 0.02 }]]) {
      expect(() => encodeWav(buffer, selection)).toThrow('sample')
    }
  })

  it('rejects malformed or oversized buffers before allocating output', () => {
    const buffer = fakeBuffer([[0]], 10)
    for (const overrides of [{ sampleRate: 0 }, { sampleRate: NaN }, { numberOfChannels: 0 }, { numberOfChannels: 33 }, { length: -1 }, { length: 100_000_000 }]) {
      expect(() => encodeWav({ ...buffer, ...overrides } as AudioBuffer, [{ start: 0, end: 1 }])).toThrow('buffer')
    }
    expect(() => encodeWav({ ...buffer, length: 2 } as AudioBuffer, [{ start: 0, end: 0.2 }])).toThrow('shorter')
  })
})

describe('suggestSoundSegments (silence trimming, not laughter classification)', () => {
  it('returns no suggestions for silence, very quiet audio, or empty buffers', () => {
    expect(suggestSoundSegments(fakeBuffer([Array(1000).fill(0)]))).toEqual([])
    expect(suggestSoundSegments(fakeBuffer([Array(1000).fill(0.001)]))).toEqual([])
    expect(suggestSoundSegments(fakeBuffer([[]]))).toEqual([])
  })

  it('trims silent ends with padding and keeps separated sound bursts separate', () => {
    const signal = Array(2000).fill(0)
    signal.fill(0.5, 300, 500)
    signal.fill(0.3, 1300, 1500)
    const segments = suggestSoundSegments(fakeBuffer([signal]))
    expect(segments).toHaveLength(2)
    expect(segments[0].start).toBeCloseTo(0.18)
    expect(segments[0].end).toBeCloseTo(0.62)
    expect(segments[1].start).toBeCloseTo(1.18)
    expect(segments[1].end).toBeCloseTo(1.62)
  })

  it('merges nearby padded sounds and clamps suggestions to source duration', () => {
    const signal = Array(1000).fill(0)
    signal.fill(0.5, 0, 100)
    signal.fill(0.5, 200, 300)
    signal.fill(0.5, 940)
    const segments = suggestSoundSegments(fakeBuffer([signal]))
    expect(segments[0].start).toBe(0)
    expect(segments[0].end).toBeCloseTo(0.42)
    expect(segments[1].end).toBe(1)
  })

  it('uses all channels without cancelling opposite-phase audio', () => {
    expect(suggestSoundSegments(fakeBuffer([Array(100).fill(0.5), Array(100).fill(-0.5)]))).toEqual([{ start: 0, end: 0.1 }])
    expect(suggestSoundSegments(fakeBuffer([Array(100).fill(0), Array(100).fill(0.5)]))).toEqual([{ start: 0, end: 0.1 }])
  })

  it('treats nonfinite PCM as silence and handles partial final windows', () => {
    expect(suggestSoundSegments(fakeBuffer([[NaN, Infinity, -Infinity]]))).toEqual([])
    expect(suggestSoundSegments(fakeBuffer([[0.5, 0.5, 0.5]]))).toEqual([{ start: 0, end: 0.003 }])
  })
})

describe('decodeAudio', () => {
  function mockContext(result: AudioBuffer | Error, closeError = false) {
    const decodeAudioData = vi.fn(async () => {
      if (result instanceof Error) throw result
      return result
    })
    const close = vi.fn(async () => { if (closeError) throw new Error('close failed') })
    const Context = vi.fn(function () { return { decodeAudioData, close } })
    vi.stubGlobal('AudioContext', Context)
    return { Context, decodeAudioData, close }
  }

  it('decodes Blob bytes and closes its temporary context', async () => {
    const buffer = fakeBuffer([[0, 1]])
    const { decodeAudioData, close } = mockContext(buffer)
    expect(await decodeAudio(new Blob(['audio']))).toBe(buffer)
    const bytes = decodeAudioData.mock.calls[0] as unknown as [ArrayBuffer]
    expect(bytes[0].byteLength).toBe(5)
    expect(close).toHaveBeenCalledOnce()
  })

  it('closes after a decoder rejection and does not mask it with a cleanup error', async () => {
    const error = new Error('unsupported audio')
    const { close } = mockContext(error, true)
    await expect(decodeAudio(new Blob(['bad']))).rejects.toBe(error)
    expect(close).toHaveBeenCalledOnce()
  })

  it('closes after Blob reading fails', async () => {
    const { close, decodeAudioData } = mockContext(fakeBuffer([[0]]))
    const error = new Error('read failed')
    await expect(decodeAudio({ size: 1, arrayBuffer: async () => { throw error } } as unknown as Blob)).rejects.toBe(error)
    expect(decodeAudioData).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects oversized decoded PCM and still closes the context', async () => {
    const { close } = mockContext({ ...fakeBuffer([[0]]), length: 100_000_000 } as AudioBuffer)
    await expect(decodeAudio(new Blob(['audio']))).rejects.toThrow('oversized')
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects empty and oversized input without opening a context', async () => {
    const { Context } = mockContext(fakeBuffer([[0]]))
    await expect(decodeAudio(new Blob([]))).rejects.toThrow('nonempty')
    await expect(decodeAudio({ size: 64 * 1024 * 1024 + 1 } as Blob)).rejects.toThrow('64 MiB')
    expect(Context).not.toHaveBeenCalled()
  })

  it('reports unavailable Web Audio and supports the prefixed constructor', async () => {
    vi.stubGlobal('AudioContext', undefined)
    vi.stubGlobal('webkitAudioContext', undefined)
    await expect(decodeAudio(new Blob(['audio']))).rejects.toThrow('not supported')
    const buffer = fakeBuffer([[0]])
    const { Context, close } = mockContext(buffer)
    vi.stubGlobal('AudioContext', undefined)
    vi.stubGlobal('webkitAudioContext', Context)
    expect(await decodeAudio(new Blob(['audio']))).toBe(buffer)
    expect(close).toHaveBeenCalledOnce()
  })
})
