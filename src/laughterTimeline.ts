import type { AudioSegment } from './laughterAudio'

function cloneSegments(segments: AudioSegment[]): AudioSegment[] {
  return segments.map(segment => ({ ...segment }))
}

function validIndex(segments: AudioSegment[], index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < segments.length
}

/** Editor ranges stay in source order, with touching ranges kept distinct. */
function validTimeline(segments: AudioSegment[], duration = Infinity): boolean {
  return segments.every((segment, index) => segment &&
    Number.isFinite(segment.start) && Number.isFinite(segment.end) &&
    segment.start >= 0 && segment.end > segment.start && segment.end <= duration &&
    (index === 0 || segments[index - 1].end <= segment.start))
}

/** Split a clip at a source time, retaining the shared boundary for later editing.
 * `minimum` is a positive duration in seconds (normally one audio sample).
 * Invalid edits return an unchanged deep clone; no ranges are merged or sorted.
 */
export function splitTimelineSegment(
  segments: AudioSegment[], index: number, at: number, minimum: number,
): AudioSegment[] {
  const result = cloneSegments(segments)
  if (!validIndex(segments, index) || !validTimeline(segments) ||
      !Number.isFinite(at) || !Number.isFinite(minimum) || minimum <= 0) return result
  const segment = segments[index]
  if (at <= segment.start || at >= segment.end ||
      at - segment.start < minimum || segment.end - at < minimum) return result
  result.splice(index, 1, { ...segment, end: at }, { ...segment, start: at })
  return result
}

/** Move one clip edge within the source and its neighboring clip boundaries.
 * The opposite edge remains fixed, and at least `minimum` seconds remain.
 * Edges may expand into gaps but never overlap neighbors; touching is allowed.
 * Invalid edits return an unchanged deep clone without normalization.
 */
export function trimTimelineSegment(
  segments: AudioSegment[], index: number, edge: 'start' | 'end', at: number,
  duration: number, minimum: number,
): AudioSegment[] {
  const result = cloneSegments(segments)
  if (!validIndex(segments, index) || (edge !== 'start' && edge !== 'end') ||
      !Number.isFinite(at) || !Number.isFinite(duration) || duration <= 0 ||
      !Number.isFinite(minimum) || minimum <= 0 ||
      !validTimeline(segments, duration)) return result
  const segment = segments[index]
  if (segment.end - segment.start < minimum) return result
  if (edge === 'start') {
    const lower = index === 0 ? 0 : segments[index - 1].end
    const upper = segment.end - minimum
    const start = Math.max(lower, Math.min(upper, at))
    // Very small minima may round away at large source times.
    if (start >= segment.end) return result
    result[index].start = start
  } else {
    const lower = segment.start + minimum
    const upper = index === segments.length - 1 ? duration : segments[index + 1].start
    const end = Math.max(lower, Math.min(upper, at))
    if (end <= segment.start) return result
    result[index].end = end
  }
  return result
}

/** Delete only the indexed clip; preserve all remaining ranges and split boundaries. */
export function removeTimelineSegment(segments: AudioSegment[], index: number): AudioSegment[] {
  const result = cloneSegments(segments)
  if (validIndex(segments, index)) result.splice(index, 1)
  return result
}
