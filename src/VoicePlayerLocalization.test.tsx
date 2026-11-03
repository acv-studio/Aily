import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VoicePlayer from './VoicePlayer'
import ChatPanel, { type ChatPanelProps } from './ChatPanel'
import { characters } from './data'
import { setLocale } from './i18n'

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
beforeEach(() => {
  setLocale('en')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})
afterEach(() => {
  cleanup(); setLocale('zh-CN'); vi.restoreAllMocks()
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

describe('bilingual voice playback', () => {
  it('switches preview accessibility and playback errors without interrupting the audio lifecycle', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const onPlay = vi.fn()
    const view = render(<VoicePlayer src="broken" preview onPlay={onPlay} />)
    const audio = screen.getByLabelText('Preview voice message')
    expect(audio).toHaveAttribute('controls')
    expect(audio).not.toHaveAttribute('autoplay')
    fireEvent.play(audio)
    expect(onPlay).toHaveBeenCalledWith(audio)
    fireEvent.error(audio)
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to play this voice message.')
    expect(audio).toHaveAttribute('aria-describedby', screen.getByRole('alert').id)
    act(() => setLocale('zh-CN'))
    expect(screen.getByLabelText('预听语音消息')).toBe(audio)
    expect(screen.getByRole('alert')).toHaveTextContent('无法播放这段语音')
    expect(pause).not.toHaveBeenCalled()
    view.rerender(<VoicePlayer src="replacement" preview onPlay={onPlay} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(pause).toHaveBeenCalledOnce()
    view.unmount()
    expect(pause).toHaveBeenCalledTimes(2)
  })

  it('preserves original message and attachment names while translating missing audio notices', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const scroll = vi.mocked(HTMLElement.prototype.scrollIntoView)
    const original = '用户原话：语音附件不可用 — do not translate me'
    const filename = '我的照片.png'
    const props: ChatPanelProps = {
      character: characters[0], draft: '', setDraft: vi.fn(), send: vi.fn(async () => {}),
      saveMemory: vi.fn(async () => {}), withdraw: vi.fn(async () => {}), close: vi.fn(), stop: vi.fn(),
      replying: false, error: '', demo: true, openGame: vi.fn(), openStory: vi.fn(),
      messages: [
        { id: 1, from: 'user', text: original, time: '', kind: 'image', attachment: { dataUrl: 'data:image/png;base64,YQ==', mimeType: 'image/png', name: filename } },
        { id: 2, from: 'user', text: '', time: '', kind: 'audio' },
      ],
    }
    render(<ChatPanel {...props} />)
    expect(screen.getByText(original)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: filename })).toBeInTheDocument()
    expect(screen.getByText('Voice attachment unavailable')).toBeInTheDocument()
    act(() => setLocale('zh-CN'))
    expect(screen.getByText('语音附件不可用')).toBeInTheDocument()
    expect(screen.getByText(original)).toBeInTheDocument()
    expect(scroll).toHaveBeenCalled()
  })
})
