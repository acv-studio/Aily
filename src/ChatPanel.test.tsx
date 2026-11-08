import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPanel, { type ChatPanelProps } from './ChatPanel'
import { characters } from './data'
import { REPLY_MODES, REPLY_MODE_LABELS } from './replyModes'

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

describe('chat settings menu', () => {
  it('replaces the header search with a collapsed three-dot menu and preserves search', () => {
    panel({ isPrimary: false, setPrimary: vi.fn(async () => {}), openMoments: vi.fn() })
    const trigger = screen.getByRole('button', { name: '聊天设置' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: '搜索消息' })).not.toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.getByText('当前不是主 Bot')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '搜索消息' }))
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('textbox', { name: '搜索聊天记录' })).toBeInTheDocument()
  })

  it('saves primary Bot without changing or sending the draft and reflects the saved status', async () => {
    const view = panel({ isPrimary: false, setPrimary: vi.fn(async () => {}), draft: '保留草稿' })
    fireEvent.click(screen.getByRole('button', { name: '聊天设置' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '设为主 Bot' })) })
    expect(view.props.setPrimary).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('发消息')).toHaveValue('保留草稿')
    expect(view.props.send).not.toHaveBeenCalled()
    expect(view.props.setDraft).not.toHaveBeenCalled()
    view.rerender(<ChatPanel {...view.props} isPrimary />)
    expect(screen.getByText('当前是主 Bot')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '已设为主 Bot' })).toBeDisabled()
  })

  it('shows a save failure and allows retry', async () => {
    const setPrimary = vi.fn(async () => { throw new Error('storage unavailable') })
    panel({ isPrimary: false, setPrimary })
    fireEvent.click(screen.getByRole('button', { name: '聊天设置' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '设为主 Bot' })) })
    expect(screen.getByText('主 Bot 设置未保存，请稍后重试。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '设为主 Bot' })).toBeEnabled()
  })

  it('opens Moments and closes the menu', () => {
    const view = panel({ openMoments: vi.fn() })
    const trigger = screen.getByRole('button', { name: '聊天设置' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: '查看朋友圈' }))
    expect(view.props.openMoments).toHaveBeenCalledOnce()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on Escape with focus restored and on outside pointer presses', () => {
    panel({ openMoments: vi.fn() })
    const trigger = screen.getByRole('button', { name: '聊天设置' })
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByLabelText('发消息'))
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('allows viewing status but prevents primary changes and navigation while replying', () => {
    const view = panel({ replying: true, setPrimary: vi.fn(async () => {}), openMoments: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: '聊天设置' }))
    expect(screen.getByText('当前不是主 Bot')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '设为主 Bot' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '查看朋友圈' })).toBeDisabled()
    expect(view.props.setPrimary).not.toHaveBeenCalled()
  })
})

describe('reply mode selection', () => {
  it('dismisses the compact menu on outside press or Escape', () => {
    panel({ setReplyMode: vi.fn(async () => {}) })
    const toggle = screen.getByRole('button', { name: `回复模式：${REPLY_MODE_LABELS.brief}` })
    fireEvent.click(toggle)
    fireEvent.pointerDown(document.body)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
  })
  it('starts collapsed with the current Chinese label and reveals three options and the selected description', () => {
    panel({ replyMode: 'deep', setReplyMode: vi.fn(async () => {}) })
    const toggle = screen.getByRole('button', { name: `回复模式：${REPLY_MODE_LABELS.deep}` })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    for (const mode of REPLY_MODES) expect(screen.queryByRole('button', { name: REPLY_MODE_LABELS[mode] })).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    for (const mode of REPLY_MODES) {
      expect(screen.getByRole('button', { name: REPLY_MODE_LABELS[mode] })).toHaveAttribute('aria-pressed', String(mode === 'deep'))
    }
    expect(screen.getByText('认真倾听，一起梳理')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '关闭回复模式' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '回复模式' }).querySelectorAll('header')).toHaveLength(0)
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('preserves draft and transcript and dismisses immediately while saving the selected mode', async () => {
    let finishSaving!: () => void
    const setReplyMode = vi.fn(() => new Promise<void>(resolve => { finishSaving = resolve }))
    const messages = [{ id: 1, from: 'user' as const, text: '已经发送的消息', time: '' }]
    const view = panel({ replyMode: 'deep', setReplyMode, draft: '未发送文字', messages })
    const toggle = screen.getByRole('button', { name: `回复模式：${REPLY_MODE_LABELS.deep}` })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: REPLY_MODE_LABELS.story }))
    expect(setReplyMode).toHaveBeenCalledExactlyOnceWith('story')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await act(async () => { finishSaving() })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: REPLY_MODE_LABELS.story })).not.toBeInTheDocument()
    expect(screen.getByLabelText('发消息')).toHaveValue('未发送文字')
    expect(screen.getByText('已经发送的消息')).toBeInTheDocument()
    expect(view.container.querySelectorAll('.message-row')).toHaveLength(1)
    expect(messages).toEqual([{ id: 1, from: 'user', text: '已经发送的消息', time: '' }])
    expect(view.props.setDraft).not.toHaveBeenCalled()
    expect(view.props.send).not.toHaveBeenCalled()
  })

  it('keeps the picker dismissed and shows an error notice when saving the mode fails', async () => {
    const setReplyMode = vi.fn(async () => { throw new Error('storage unavailable') })
    panel({ replyMode: 'deep', setReplyMode })
    const toggle = screen.getByRole('button', { name: `回复模式：${REPLY_MODE_LABELS.deep}` })
    fireEvent.click(toggle)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: REPLY_MODE_LABELS.story })) })
    expect(setReplyMode).toHaveBeenCalledExactlyOnceWith('story')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent(REPLY_MODE_LABELS.deep)
    expect(screen.getByText('回复模式未切换，请停止回复或检查本机存储后重试。')).toBeInTheDocument()
  })

  it.each([{ replying: true }, { modeSaving: true }])('keeps the toggle enabled but disables expanded selection while busy %j', busy => {
    const setReplyMode = vi.fn(async () => {})
    panel({ setReplyMode, ...busy })
    const toggle = screen.getByRole('button', { name: `回复模式：${REPLY_MODE_LABELS.brief}` })
    expect(toggle).toBeEnabled()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    for (const mode of REPLY_MODES) {
      const option = screen.getByRole('button', { name: REPLY_MODE_LABELS[mode] })
      expect(option).toBeDisabled()
      fireEvent.click(option)
    }
    expect(setReplyMode).not.toHaveBeenCalled()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('chat privacy controls', () => {
  it('does not offer temporary chat mode in settings', () => {
    const toggleTemporary = vi.fn()
    panel({ toggleTemporary })
    fireEvent.click(screen.getByRole('button', { name: '聊天设置' }))
    expect(screen.queryByRole('button', { name: '临时会话' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '结束临时会话' })).not.toBeInTheDocument()
    expect(toggleTemporary).not.toHaveBeenCalled()
  })
})

describe('model response whitespace rendering', () => {
  it('removes legacy outer blank lines from character bubbles while preserving internal paragraphs', () => {
    const view = panel({ messages: [{ id: 1, from: 'character', text: '\n\n【虚构场景】\n第一段。\n\n第二段。  \n', time: '21:05', status: 'sent' }] })
    const bubble = view.container.querySelector('.bubble')
    expect(bubble?.textContent).toBe('【虚构场景】\n第一段。\n\n第二段。')
  })
  it('does not rewrite user-authored whitespace', () => {
    const view = panel({ messages: [{ id: 1, from: 'user', text: '\n用户原文\n', time: '21:05', status: 'sent' }] })
    expect(view.container.querySelector('.bubble')?.textContent).toBe('\n用户原文\n')
  })
})

describe('empty conversation introduction', () => {
  it('shows the character introduction and three starter buttons that only populate the draft', () => {
    const messages: ChatPanelProps['messages'] = []
    const view = panel({ messages })
    const intro = view.container.querySelector('.chat-intro')
    expect(intro).toBeInTheDocument()
    expect(within(intro as HTMLElement).getByText(view.props.character.quote)).toBeInTheDocument()
    expect(within(intro as HTMLElement).getAllByRole('button')).toHaveLength(3)
    fireEvent.click(within(intro as HTMLElement).getByRole('button', { name: '你好，很高兴认识你。' }))
    expect(view.props.setDraft).toHaveBeenCalledExactlyOnceWith('你好，很高兴认识你。')
    expect(view.props.send).not.toHaveBeenCalled()
    expect(messages).toEqual([])
    expect(view.container.querySelectorAll('.message-row')).toHaveLength(0)
  })
})

describe('chat visual viewport', () => {
  it('updates viewport height and top on resize and scroll and removes listeners on unmount', () => {
    const viewport = Object.assign(new EventTarget(), { height: 720, offsetTop: 0 })
    vi.stubGlobal('visualViewport', viewport)
    const addViewportListener = vi.spyOn(viewport, 'addEventListener')
    const removeViewportListener = vi.spyOn(viewport, 'removeEventListener')
    const addWindowListener = vi.spyOn(window, 'addEventListener')
    const removeWindowListener = vi.spyOn(window, 'removeEventListener')
    const view = panel()
    const main = screen.getByRole('main')
    expect(main.style.getPropertyValue('--chat-view-height')).toBe('720px')
    expect(main.style.getPropertyValue('--chat-view-top')).toBe('0px')

    viewport.height = 380
    viewport.offsetTop = 12
    act(() => { viewport.dispatchEvent(new Event('resize')) })
    expect(main.style.getPropertyValue('--chat-view-height')).toBe('380px')
    expect(main.style.getPropertyValue('--chat-view-top')).toBe('12px')

    viewport.height = 360
    viewport.offsetTop = 44
    act(() => { viewport.dispatchEvent(new Event('scroll')) })
    expect(main.style.getPropertyValue('--chat-view-height')).toBe('360px')
    expect(main.style.getPropertyValue('--chat-view-top')).toBe('44px')

    const resizeListener = addViewportListener.mock.calls.find(([event]) => event === 'resize')?.[1]
    const scrollListener = addViewportListener.mock.calls.find(([event]) => event === 'scroll')?.[1]
    expect(resizeListener).toEqual(expect.any(Function))
    expect(scrollListener).toEqual(expect.any(Function))
    expect(addWindowListener).toHaveBeenCalledWith('resize', resizeListener)
    view.unmount()
    expect(removeViewportListener).toHaveBeenCalledWith('resize', resizeListener)
    expect(removeViewportListener).toHaveBeenCalledWith('scroll', scrollListener)
    expect(removeWindowListener).toHaveBeenCalledWith('resize', resizeListener)
    viewport.height = 800
    viewport.offsetTop = 0
    viewport.dispatchEvent(new Event('resize'))
    viewport.dispatchEvent(new Event('scroll'))
    expect(main.style.getPropertyValue('--chat-view-height')).toBe('360px')
    expect(main.style.getPropertyValue('--chat-view-top')).toBe('44px')
  })
})

it('clears a quote when switching companions even when message IDs overlap', () => {
  const view = panel({ messages: [{ id: 1, from: 'user', text: '旧角色消息', time: '' }] })
  fireEvent.keyDown(screen.getByRole('button', { name: '消息操作' }), { key: 'Enter' })
  fireEvent.click(screen.getByRole('button', { name: '引用消息 1' }))
  expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()
  view.rerender(<ChatPanel {...view.props} character={characters[1]} messages={[{ id: 1, from: 'user', text: '新角色消息', time: '' }]} />)
  expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument()
  expect(screen.getByText('新角色消息')).toBeInTheDocument()
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
