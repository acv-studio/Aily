import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import LaughterTimelineEditor from './LaughterTimelineEditor'
import type { AudioSegment } from './laughterAudio'
const buffer: AudioBuffer = { duration: 4, length: 40, numberOfChannels: 1, sampleRate: 10, getChannelData: () => new Float32Array(40).fill(.5), copyFromChannel: vi.fn(), copyToChannel: vi.fn() }
function Harness({ disabled = false }: { disabled?: boolean }) {
  const [segments, setSegments] = useState<AudioSegment[]>([{ start: 0, end: 4 }])
  return <><LaughterTimelineEditor buffer={buffer} blob={new Blob(['audio'])} segments={segments} onChange={setSegments} disabled={disabled} copy={(_, en) => en}/><output data-testid="segments">{JSON.stringify(segments)}</output></>
}
beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent)
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test-timeline'), revokeObjectURL: vi.fn() }))
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const ranges = () => JSON.parse(screen.getByTestId('segments').textContent || '[]')
const seek = (value: number) => fireEvent.change(screen.getByRole('slider', { name: 'Playhead' }), { target: { value } })
it('starts with a full clip and exposes large keyboard-accessible trim handles', () => {
  render(<Harness/>); expect(ranges()).toEqual([{ start: 0, end: 4 }])
  expect(screen.getByRole('slider', { name: 'Left trim handle' })).toHaveAttribute('aria-valuenow', '0')
  expect(screen.getByRole('slider', { name: 'Right trim handle' })).toHaveAttribute('aria-valuenow', '4')
  expect(screen.getByRole('button', { name: 'Split here' })).toBeDisabled()
})
it('splits and removes a middle portion without merging adjacent clip selections', () => {
  render(<Harness/>); seek(1); fireEvent.click(screen.getByRole('button', { name: 'Split here' }))
  expect(ranges()).toEqual([{ start: 0, end: 1 }, { start: 1, end: 4 }])
  fireEvent.click(screen.getByRole('button', { name: /Clip 2/ })); seek(3)
  fireEvent.click(screen.getByRole('button', { name: 'Split here' }))
  expect(ranges()).toEqual([{ start: 0, end: 1 }, { start: 1, end: 3 }, { start: 3, end: 4 }])
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected clip' }))
  expect(ranges()).toEqual([{ start: 0, end: 1 }, { start: 3, end: 4 }])
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(ranges()).toHaveLength(3)
})
it('trims with touch pointer movement and undoes an entire drag in one step', () => {
  render(<Harness/>); const timeline = screen.getByTestId('laughter-timeline')
  vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 400, top: 0, bottom: 100, right: 500, height: 100, x: 100, y: 0, toJSON: () => {} })
  const left = screen.getByRole('slider', { name: 'Left trim handle' })
  fireEvent.pointerDown(left, { clientX: 100 }); fireEvent.pointerMove(left, { clientX: 180 }); fireEvent.pointerMove(left, { clientX: 200 }); fireEvent.pointerUp(left)
  expect(ranges()).toEqual([{ start: 1, end: 4 }])
  expect(left).toHaveAttribute('aria-valuenow', '1')
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(ranges()).toEqual([{ start: 0, end: 4 }])
})
it('supports right-edge trimming and guards against crossed handles', () => {
  render(<Harness/>); const right = screen.getByRole('slider', { name: 'Right trim handle' })
  fireEvent.keyDown(right, { key: 'ArrowLeft' }); expect(ranges()[0].end).toBeCloseTo(3.95)
  fireEvent.keyDown(right, { key: 'Home' }); expect(ranges()[0].end).toBeGreaterThan(0)
  expect(screen.getByRole('slider', { name: 'Left trim handle' })).toHaveAttribute('aria-valuenow', '0')
})
it('can remove every clip and restore the original without touching saved audio', () => {
  render(<Harness/>); fireEvent.click(screen.getByRole('button', { name: 'Delete selected clip' }))
  expect(ranges()).toEqual([]); expect(screen.getByRole('button', { name: 'Split here' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Restore full recording' })); expect(ranges()).toEqual([{ start: 0, end: 4 }])
})
it('seeks from a waveform tap without entering seconds', () => {
  render(<Harness/>); const track = screen.getByTestId('laughter-timeline')
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 400, top: 0, bottom: 100, right: 400, height: 100, x: 0, y: 0, toJSON: () => {} })
  fireEvent.pointerDown(track, { clientX: 200 }); expect(screen.getByRole('slider', { name: 'Playhead' })).toHaveValue('2')
  fireEvent.click(screen.getByRole('button', { name: 'Split here' })); expect(ranges()).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }])
})
it('disables timeline mutations during a save or recording', () => {
  render(<Harness disabled/>); const left = screen.getByRole('slider', { name: 'Left trim handle' })
  expect(left).toBeDisabled(); fireEvent.keyDown(left, { key: 'ArrowRight' }); expect(ranges()).toEqual([{ start: 0, end: 4 }])
  expect(screen.getByRole('button', { name: 'Delete selected clip' })).toBeDisabled()
})
it('plays only the selected source range and stops at its end', async () => {
  const view = render(<Harness/>); seek(2); fireEvent.click(screen.getByRole('button', { name: 'Split here' }))
  fireEvent.click(screen.getByRole('button', { name: /Clip 2/ })); fireEvent.click(screen.getByRole('button', { name: 'Play selected clip' }))
  const audio = view.container.querySelector('audio')!
  expect(audio.currentTime).toBe(2); expect(audio.play).toHaveBeenCalled()
  audio.currentTime = 4; fireEvent.timeUpdate(audio); expect(audio.pause).toHaveBeenCalled()
})
