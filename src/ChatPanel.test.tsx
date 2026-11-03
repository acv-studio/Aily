import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPanel, { type ChatPanelProps } from './ChatPanel'
import { characters } from './data'

function panel(overrides: Partial<ChatPanelProps> = {}) {
  const props: ChatPanelProps = {
    character: characters[0], messages: [], draft: '', setDraft: vi.fn(),
    send: vi.fn(async () => {}), saveMemory: vi.fn(async () => {}), withdraw: vi.fn(async () => {}),
    close: vi.fn(), stop: vi.fn(), replying: false, error: '', demo: true,
    openGame: vi.fn(), openStory: vi.fn(), ...overrides,
  }
  return { ...render(<ChatPanel {...props} />), props }
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

const voiceMessage = (id: number) => ({ id, from: 'user' as const, text: '', time: '', kind: 'audio' as const, attachment: { dataUrl: `data:audio/webm;base64,${id}`, mimeType: 'audio/webm', name: '语音消息' } })

describe('chat search, quote and withdrawal controls', () => {
  const messages = [{ id: 0, from: 'user' as const, text: 'Coffee on Sunday', time: '', status: 'sent' as const }, { id: 1, from: 'character' as const, text: '周六去海边', time: '', status: 'sent' as const }]

  it('searches case-insensitively, trims whitespace and clears hidden filters', () => {
    panel({ messages })
    fireEvent.click(screen.getByRole('button', { name: '搜索消息' }))
    fireEvent.change(screen.getByLabelText('搜索聊天记录'), { target: { value: ' coffee ' } })
    expect(screen.getByText('找到 1 条消息')).toBeInTheDocument()
    expect(screen.queryByText('周六去海边')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '搜索消息' }))
    expect(screen.queryByLabelText('搜索聊天记录')).not.toBeInTheDocument()
    expect(screen.getByText('周六去海边')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '搜索消息' }))
    expect(screen.getByLabelText('搜索聊天记录')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('搜索聊天记录'), { target: { value: '不存在' } })
    expect(screen.getByText('找到 0 条消息')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^关闭$/ }))
    expect(screen.getByText('Coffee on Sunday')).toBeInTheDocument()
  })

  it('sends the selected quote, supports id zero and cancels it', async () => {
    const view = panel({ messages, draft: '接着聊' })
    fireEvent.click(screen.getByRole('button', { name: '引用消息 0' }))
    expect(screen.getByText('引用：Coffee on Sunday')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })) })
    expect(view.props.send).toHaveBeenCalledWith({ replyToId: 0, attachment: undefined, kind: undefined })
    expect(screen.queryByText('引用：Coffee on Sunday')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '引用消息 1' }))
    fireEvent.click(screen.getByRole('button', { name: /^取消$/ }))
    expect(screen.queryByText('引用：周六去海边')).not.toBeInTheDocument()
  })

  it('clears a withdrawn selected quote and hides its retry and its own quote', async () => {
    const reply = { ...messages[0], id: 2, status: 'failed' as const, replyToId: 0 }
    const view = panel({ messages: [...messages, reply], draft: '继续聊' })
    expect(view.container.querySelector('blockquote')).toHaveTextContent('Coffee on Sunday')
    fireEvent.click(screen.getByRole('button', { name: '引用消息 2' }))
    view.rerender(<ChatPanel {...view.props} messages={[...messages, { ...reply, text: '', withdrawn: true }]} />)
    expect(view.container.querySelector('.quoted-preview')).toBeNull()
    expect(view.container.querySelector('blockquote')).toBeNull()
    expect(screen.queryByText('回复未完成 · 重试')).not.toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })) })
    expect(view.props.send).toHaveBeenCalledWith({ replyToId: undefined, attachment: undefined, kind: undefined })
  })

  it('excludes withdrawn search results and labels missing and audio quote references', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const view = panel({ messages: [{ ...messages[0], withdrawn: true }, voiceMessage(2), { ...messages[1], id: 3, replyToId: 0 }, { ...messages[1], id: 4, replyToId: 99 }] })
    expect(screen.getByText('引用的消息已撤回')).toBeInTheDocument()
    expect(screen.getByText('引用消息不可用')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '引用消息 2' }))
    expect(screen.getByText('引用：[语音]')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '搜索消息' }))
    fireEvent.change(screen.getByLabelText('搜索聊天记录'), { target: { value: 'Coffee' } })
    expect(screen.getByText('找到 0 条消息')).toBeInTheDocument()
    expect(view.container.querySelectorAll('.message-row')).toHaveLength(0)
  })

  it('disables withdrawal and retry while a reply is active', () => {
    panel({ messages: [{ ...messages[0], status: 'failed' }], replying: true })
    expect(screen.getByRole('button', { name: '撤回' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '回复未完成 · 重试' })).toBeDisabled()
  })
})

describe('chat voice playback', () => {
  it('pauses the previous message when another starts and stops withdrawn playback', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const messages = [voiceMessage(1), voiceMessage(2)]
    const view = panel({ messages })
    const [first, second] = screen.getAllByLabelText('播放语音消息')
    fireEvent.play(first)
    expect(pause).not.toHaveBeenCalled()
    fireEvent.play(second)
    expect(pause.mock.instances[0]).toBe(first)
    view.rerender(<ChatPanel {...view.props} messages={[{ ...messages[0], withdrawn: true }, messages[1]]} />)
    expect(pause.mock.instances[1]).toBe(first)
    view.unmount()
    expect(pause.mock.instances[2]).toBe(second)
  })

  it('pauses playback before microphone acquisition', async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    microphone(vi.fn(() => new Promise(() => {})))
    vi.stubGlobal('MediaRecorder', class {})
    panel({ messages: [voiceMessage(1)] })
    const playing = screen.getByLabelText('播放语音消息')
    fireEvent.play(playing)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '录制语音' })) })
    expect(pause.mock.instances[0]).toBe(playing)
  })

  it('does not render withdrawn attachments and explains missing audio', () => {
    panel({ messages: [{ ...voiceMessage(1), withdrawn: true }, { ...voiceMessage(2), attachment: undefined }] })
    expect(screen.queryByLabelText('播放语音消息')).not.toBeInTheDocument()
    expect(screen.getByText('语音附件不可用')).toBeInTheDocument()
  })
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

  it('rejects an empty recording instead of offering an unplayable attachment', async () => {
    const { stream } = audio()
    microphone(vi.fn(async () => stream))
    vi.stubGlobal('MediaRecorder', class {
      state = 'inactive'
      mimeType = 'audio/webm'
      onstop?: () => void
      start() { this.state = 'recording' }
      stop() { this.state = 'inactive'; this.onstop?.() }
    })
    panel()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '录制语音' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '结束录音' })) })
    expect(screen.getByText('没有录到声音，请重新录制')).toBeInTheDocument()
    expect(screen.queryByText(/待发送/)).not.toBeInTheDocument()
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
