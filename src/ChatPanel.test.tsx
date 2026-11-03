import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPanel, { type ChatPanelProps } from './ChatPanel'
import { characters } from './data'

function panel() {
  const props: ChatPanelProps = {
    character: characters[0], messages: [], draft: '', setDraft: vi.fn(),
    send: vi.fn(async () => {}), saveMemory: vi.fn(async () => {}), withdraw: vi.fn(async () => {}),
    close: vi.fn(), stop: vi.fn(), replying: false, error: '', demo: true,
    openGame: vi.fn(), openStory: vi.fn(),
  }
  return render(<ChatPanel {...props} />)
}
function audio() {
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  return { stream, stop }
}
function microphone(getUserMedia: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
}
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
  else Reflect.deleteProperty(navigator, 'mediaDevices')
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

describe('chat microphone lifecycle', () => {
  it('stops a permission result received after unmount without constructing a recorder', async () => {
    const { stream, stop } = audio()
    let grant!: (stream: MediaStream) => void
    microphone(vi.fn(() => new Promise<MediaStream>(resolve => { grant = resolve })))
    const construct = vi.fn()
    vi.stubGlobal('MediaRecorder', class { constructor() { construct() } })
    const view = panel()
    fireEvent.click(screen.getByRole('button', { name: '录制语音' }))
    view.unmount()
    await act(async () => { grant(stream) })
    expect(stop).toHaveBeenCalledOnce()
    expect(construct).not.toHaveBeenCalled()
  })

  it.each(['constructor', 'start'])('stops acquired tracks when recorder %s throws', async failure => {
    const { stream, stop } = audio()
    microphone(vi.fn(async () => stream))
    vi.stubGlobal('MediaRecorder', class {
      state = 'inactive'
      constructor() { if (failure === 'constructor') throw new Error('unsupported recorder') }
      start() { throw new Error('cannot start recorder') }
    })
    panel()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '录制语音' })) })
    expect(stop).toHaveBeenCalledOnce()
    expect(screen.getByText(/无法开始录音/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '录制语音' })).toBeInTheDocument()
  })

  it('allows only one pending permission request and clears recording on unmount', async () => {
    vi.useFakeTimers()
    const { stream, stop: stopTrack } = audio()
    let grant!: (stream: MediaStream) => void
    const getUserMedia = vi.fn(() => new Promise<MediaStream>(resolve => { grant = resolve }))
    microphone(getUserMedia)
    const stopRecorder = vi.fn()
    vi.stubGlobal('MediaRecorder', class {
      state = 'inactive'
      mimeType = 'audio/webm'
      start() { this.state = 'recording' }
      stop() { stopRecorder(); this.state = 'inactive' }
    })
    const view = panel()
    const button = screen.getByRole('button', { name: '录制语音' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(getUserMedia).toHaveBeenCalledOnce()
    await act(async () => { grant(stream) })
    expect(screen.getByRole('button', { name: '结束录音' })).toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(1)
    view.unmount()
    expect(stopRecorder).toHaveBeenCalledOnce()
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
