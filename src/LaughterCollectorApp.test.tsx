import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ExtensionAppView } from './ExtensionStore'
import LaughterCollectorApp from './LaughterCollectorApp'
import { extensionApps } from './extensionApps'
import { laughterDb, saveLaughter } from './laughterStorage'
import { decodeAudio } from './laughterAudio'

vi.mock('./laughterAudio', async importOriginal => ({ ...await importOriginal<typeof import('./laughterAudio')>(), decodeAudio: vi.fn() }))
const stopTrack = vi.fn()
let media: FakeRecorder
class FakeRecorder {
  static isTypeSupported = () => true
  state = 'inactive'; mimeType = 'audio/webm'
  ondataavailable?: (event: { data: Blob }) => void
  onstop?: () => void
  onerror?: () => void
  constructor() { media = this }
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['original audio'], { type: 'audio/webm' }) }); this.onstop?.() }
}
beforeEach(async () => {
  await laughterDb.recordings.clear(); localStorage.clear()
  // Node Blob survives fake-indexeddb's structuredClone; jsdom Blob does not.
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) } })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:audio-test'), revokeObjectURL: vi.fn() }))
  vi.mocked(decodeAudio).mockResolvedValue({ duration: 4, length: 40, sampleRate: 10, numberOfChannels: 1, getChannelData: () => new Float32Array(40).fill(.5), copyFromChannel: vi.fn(), copyToChannel: vi.fn() } satisfies AudioBuffer)
  stopTrack.mockClear()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const startRecording = async () => {
  fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'Mom' } })
  fireEvent.change(screen.getByLabelText('Recording title (optional)'), { target: { value: 'Dinner' } })
  fireEvent.click(screen.getByRole('button', { name: 'Start recording' }))
  await screen.findByRole('button', { name: /Stop & save/ })
}
it('registers a lifestyle app and renders the actual collector route', () => {
  expect(extensionApps.find(app => app.id === 'laughter-collector')).toMatchObject({ name: '笑声收集器', category: 'life' })
  render(<ExtensionAppView id="laughter-collector" locale="en" />)
  expect(screen.getByRole('heading', { name: 'Keep their laughter close' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start recording' })).toBeDisabled()
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
})
it('uses one accessible import button and hides the native file control while preserving import', async () => {
  render(<LaughterCollectorApp locale="en" />)
  const button = screen.getByRole('button', { name: 'Import audio' })
  const picker = screen.getByLabelText('Choose audio file')
  expect(button).toBeDisabled(); expect(picker).not.toBeVisible()
  expect(button.querySelector('input')).toBeNull()
  fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'Mom' } })
  const choose = vi.spyOn(picker, 'click').mockImplementation(() => {})
  fireEvent.click(button); expect(choose).toHaveBeenCalledOnce()
  const file = new NodeFile(['audio'], 'laugh.wav', { type: 'audio/wav' })
  fireEvent.change(picker, { target: { files: [file] } })
  await screen.findByText('Audio imported to this device.')
  const saved = (await laughterDb.recordings.toArray())[0]
  expect(saved).toMatchObject({ person: 'Mom', name: 'laugh.wav', duration: 4 })
  expect(saved.blob.size).toBe(file.size)
  expect(picker).toHaveValue('')
})
it('records by person, saves original locally and stops the microphone', async () => {
  render(<LaughterCollectorApp locale="en" />); await startRecording()
  fireEvent.click(screen.getByRole('button', { name: /Stop & save/ }))
  await screen.findByText('Original saved on this device. You can now edit it.')
  const rows = await laughterDb.recordings.toArray()
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ person: 'Mom', name: 'Dinner' })
  expect(rows[0].blob.size).toBeGreaterThan(0); expect(stopTrack).toHaveBeenCalled()
  cleanup(); render(<LaughterCollectorApp locale="en" />)
  expect(await screen.findByRole('heading', { name: 'Dinner' })).toBeInTheDocument()
})
it('keeps the original and saves selected segments as a separate WAV', async () => {
  await saveLaughter({ id: 'original', person: 'Mom', name: 'Dinner', duration: 4, createdAt: new Date().toISOString(), blob: new Blob(['test'], { type: 'audio/webm' }) })
  render(<LaughterCollectorApp locale="en" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Dinner' }))
  await screen.findByRole('region', { name: 'Laughter editor' })
  expect(screen.getByRole('button', { name: 'Save edit as new' })).toBeEnabled()
  fireEvent.click(screen.getByText('Fine adjustment (optional)'))
  fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
  expect(screen.getByRole('button', { name: 'Save edit as new' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Start (seconds)'), { target: { value: '1' } })
  fireEvent.change(screen.getByLabelText('End (seconds)'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Keep this segment' }))
  fireEvent.change(screen.getByLabelText('Start (seconds)'), { target: { value: '3' } })
  fireEvent.change(screen.getByLabelText('End (seconds)'), { target: { value: '4' } })
  fireEvent.click(screen.getByRole('button', { name: 'Keep this segment' }))
  expect(screen.getByText('2 segments · 2.0 seconds')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Save edit as new' }))
  await screen.findByText('Edit saved as a new recording. Original retained.')
  const rows = await laughterDb.recordings.toArray()
  expect(rows).toHaveLength(2)
  expect(rows.find(row => row.sourceId === 'original')).toMatchObject({ duration: 2 })
  expect(rows.find(row => row.sourceId)?.blob.type).toBe('audio/wav')
  expect(await laughterDb.recordings.get('original')).toBeDefined()
})
it('saves visual split-and-delete edits without typing timestamps', async () => {
  await saveLaughter({ id: 'visual-original', person: 'Mom', name: 'Dinner', duration: 4, createdAt: new Date().toISOString(), blob: new Blob(['test'], { type: 'audio/webm' }) })
  render(<LaughterCollectorApp locale="en" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Dinner' }))
  await screen.findByRole('region', { name: 'Laughter editor' })
  fireEvent.change(screen.getByRole('slider', { name: 'Playhead' }), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Split here' }))
  expect(screen.getByRole('button', { name: /Clip 2/ })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Clip 2/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected clip' }))
  expect(screen.getByText('1 segments · 2.0 seconds')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Save edit as new' }))
  await screen.findByText('Edit saved as a new recording. Original retained.')
  const rows = await laughterDb.recordings.toArray()
  expect(rows).toHaveLength(2)
  expect(rows.find(row => row.sourceId === 'visual-original')).toMatchObject({ duration: 2 })
  expect(await laughterDb.recordings.get('visual-original')).toBeDefined()
})
it('surfaces denied permission and never invents a recording', async () => {
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(new Error('denied'))
  render(<LaughterCollectorApp locale="en" />)
  fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'Mom' } })
  fireEvent.click(screen.getByRole('button', { name: 'Start recording' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not start the microphone')
  expect(await laughterDb.recordings.count()).toBe(0)
})
it('releases a late microphone grant after closing the tool', async () => {
  let grant!: (value: MediaStream) => void
  vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(() => new Promise(resolve => { grant = resolve }))
  const view = render(<LaughterCollectorApp locale="en" />)
  fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'Mom' } })
  fireEvent.click(screen.getByRole('button', { name: 'Start recording' })); view.unmount()
  await act(async () => { grant({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream) })
  expect(stopTrack).toHaveBeenCalledOnce(); expect(await laughterDb.recordings.count()).toBe(0)
})
it('retains failed-save audio for retry instead of reporting success', async () => {
  const add = vi.spyOn(laughterDb.recordings, 'add').mockRejectedValueOnce(new Error('quota'))
  render(<LaughterCollectorApp locale="en" />); await startRecording()
  fireEvent.click(screen.getByRole('button', { name: /Stop & save/ }))
  expect(await screen.findByText('This recording is not saved. Keep this tool open.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start recording' })).toBeDisabled()
  add.mockRestore(); fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
  await waitFor(() => expect(screen.queryByText('This recording is not saved. Keep this tool open.')).toBeNull())
  expect(await laughterDb.recordings.count()).toBe(1)
})
it('closing during recording stops and saves the original', async () => {
  const view = render(<LaughterCollectorApp locale="en" />); await startRecording(); view.unmount()
  expect(media.state).toBe('inactive')
  await waitFor(async () => expect(await laughterDb.recordings.count()).toBe(1))
  expect(stopTrack).toHaveBeenCalled()
})
