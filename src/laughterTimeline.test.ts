import { describe, expect, it } from 'vitest'
import type { AudioSegment } from './laughterAudio'
import { removeTimelineSegment, splitTimelineSegment, trimTimelineSegment } from './laughterTimeline'

function expectClone(result: AudioSegment[], input: AudioSegment[]) {
  expect(result).toEqual(input)
  expect(result).not.toBe(input)
  result.forEach((segment, index) => expect(segment).not.toBe(input[index]))
}

function frozenTimeline(): AudioSegment[] {
  return Object.freeze([
    Object.freeze({ start: 0, end: 2 }),
    Object.freeze({ start: 3, end: 7 }),
    Object.freeze({ start: 8, end: 10 }),
  ]) as unknown as AudioSegment[]
}

describe('splitTimelineSegment', () => {
  it('keeps adjacent split boundaries, then deleting the middle leaves two kept regions', () => {
    const input = [{ start: 0, end: 10 }]
    const first = splitTimelineSegment(input, 0, 3, 0.125)
    expect(first).toEqual([{ start: 0, end: 3 }, { start: 3, end: 10 }])
    const second = splitTimelineSegment(first, 1, 7, 0.125)
    expect(second).toEqual([{ start: 0, end: 3 }, { start: 3, end: 7 }, { start: 7, end: 10 }])
    expect(removeTimelineSegment(second, 1)).toEqual([{ start: 0, end: 3 }, { start: 7, end: 10 }])
    expect(input).toEqual([{ start: 0, end: 10 }])
    expect(first).toEqual([{ start: 0, end: 3 }, { start: 3, end: 10 }])
    expect(second).toHaveLength(3)
  })

  it('accepts splits leaving exactly the minimum sample on each side', () => {
    expect(splitTimelineSegment([{ start: 1, end: 1.25 }], 0, 1.125, 0.125))
      .toEqual([{ start: 1, end: 1.125 }, { start: 1.125, end: 1.25 }])
  })

  it.each([-Infinity, Infinity, NaN, 0, 2, -1, 3, 0.0625, 1.9375])(
    'returns an unchanged clone for invalid split time %s', at => {
      const input = [{ start: 0, end: 2 }]
      expectClone(splitTimelineSegment(input, 0, at, 0.125), input)
    },
  )

  it.each([-1, 1, 0.5, NaN, Infinity])('rejects invalid index %s', index => {
    const input = [{ start: 0, end: 2 }]
    expectClone(splitTimelineSegment(input, index, 1, 0.125), input)
  })

  it.each([0, -1, NaN, Infinity, -Infinity, 2])('rejects invalid or excessive minimum %s', minimum => {
    const input = [{ start: 0, end: 2 }]
    expectClone(splitTimelineSegment(input, 0, 1, minimum), input)
  })

  it('does not mutate frozen inputs or retain references to any input clip', () => {
    const input = frozenTimeline()
    const result = splitTimelineSegment(input, 1, 5, 0.125)
    expect(result).toEqual([{ start: 0, end: 2 }, { start: 3, end: 5 }, { start: 5, end: 7 }, { start: 8, end: 10 }])
    result.forEach(segment => expect(input).not.toContain(segment))
    result[0].end = 1
    expect(input[0].end).toBe(2)
  })
})

describe('trimTimelineSegment', () => {
  it('clamps the start to the previous clip and to the minimum remaining length', () => {
    const input = frozenTimeline()
    expect(trimTimelineSegment(input, 1, 'start', -10, 10, 0.125)[1]).toEqual({ start: 2, end: 7 })
    expect(trimTimelineSegment(input, 1, 'start', 20, 10, 0.125)[1]).toEqual({ start: 6.875, end: 7 })
    expect(trimTimelineSegment(input, 1, 'start', 4, 10, 0.125)[1]).toEqual({ start: 4, end: 7 })
  })

  it('clamps the end to the next clip and to the minimum remaining length', () => {
    const input = frozenTimeline()
    expect(trimTimelineSegment(input, 1, 'end', 20, 10, 0.125)[1]).toEqual({ start: 3, end: 8 })
    expect(trimTimelineSegment(input, 1, 'end', -10, 10, 0.125)[1]).toEqual({ start: 3, end: 3.125 })
    expect(trimTimelineSegment(input, 1, 'end', 6, 10, 0.125)[1]).toEqual({ start: 3, end: 6 })
  })

  it('clamps the first and last clips to source bounds, preserving touching splits', () => {
    const input = [{ start: 1, end: 4 }, { start: 4, end: 8 }]
    expect(trimTimelineSegment(input, 0, 'start', -10, 10, 0.125))
      .toEqual([{ start: 0, end: 4 }, { start: 4, end: 8 }])
    expect(trimTimelineSegment(input, 1, 'end', 20, 10, 0.125))
      .toEqual([{ start: 1, end: 4 }, { start: 4, end: 10 }])
    expectClone(trimTimelineSegment(input, 0, 'end', 9, 10, 0.125), input)
    expectClone(trimTimelineSegment(input, 1, 'start', 0, 10, 0.125), input)
  })

  it('returns unchanged independent clones for invalid arguments', () => {
    const input = frozenTimeline()
    for (const index of [-1, 3, 0.5, NaN, Infinity]) {
      expectClone(trimTimelineSegment(input, index, 'start', 4, 10, 0.125), input)
    }
    for (const at of [NaN, Infinity, -Infinity]) {
      expectClone(trimTimelineSegment(input, 1, 'start', at, 10, 0.125), input)
    }
    for (const duration of [0, -1, 9, NaN, Infinity, -Infinity]) {
      expectClone(trimTimelineSegment(input, 1, 'start', 4, duration, 0.125), input)
    }
    for (const minimum of [0, -1, 5, NaN, Infinity, -Infinity]) {
      expectClone(trimTimelineSegment(input, 1, 'start', 4, 10, minimum), input)
    }
    expectClone(trimTimelineSegment(input, 1, 'other' as 'start', 4, 10, 0.125), input)
  })

  it('does not mutate frozen clips and clones untouched neighbors', () => {
    const input = frozenTimeline()
    const result = trimTimelineSegment(input, 1, 'end', 6, 10, 0.125)
    result.forEach(segment => expect(input).not.toContain(segment))
    expect(input[1]).toEqual({ start: 3, end: 7 })
    result[0].end = 1
    expect(input[0].end).toBe(2)
  })
})

describe('invalid timelines', () => {
  it.each([
    [{ start: NaN, end: 2 }], [{ start: 0, end: Infinity }],
    [{ start: -1, end: 2 }], [{ start: 2, end: 2 }], [{ start: 3, end: 2 }],
    [{ start: 0, end: 3 }, { start: 2, end: 4 }],
    [{ start: 3, end: 4 }, { start: 0, end: 2 }],
  ])('leaves malformed, overlapping or unsorted ranges unchanged: %j', (...input) => {
    expectClone(splitTimelineSegment(input, 0, 1, 0.125), input)
    expectClone(trimTimelineSegment(input, 0, 'end', 1, 10, 0.125), input)
  })
})

describe('removeTimelineSegment', () => {
  it('removes the selected clip without merging touching retained clips', () => {
    const input = frozenTimeline()
    const result = removeTimelineSegment(input, 1)
    expect(result).toEqual([{ start: 0, end: 2 }, { start: 8, end: 10 }])
    result.forEach(segment => expect(input).not.toContain(segment))
    expect(removeTimelineSegment([{ start: 0, end: 1 }], 0)).toEqual([])
  })

  it.each([-1, 3, 0.5, NaN, Infinity])('returns an unchanged clone for invalid index %s', index => {
    const input = frozenTimeline()
    expectClone(removeTimelineSegment(input, index), input)
  })

  it('handles empty timelines in every operation', () => {
    expectClone(removeTimelineSegment([], 0), [])
    expectClone(splitTimelineSegment([], 0, 1, 0.125), [])
    expectClone(trimTimelineSegment([], 0, 'start', 1, 10, 0.125), [])
  })
})
