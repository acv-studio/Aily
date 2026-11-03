import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VoicePlayer from './VoicePlayer'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('voice playback', () => {
  it('exposes native controls without autoplay and delegates exclusive playback', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const onPlay = vi.fn()
    render(<VoicePlayer src="data:audio/webm;base64,YQ==" onPlay={onPlay} />)
    const audio = screen.getByLabelText('播放语音消息')
    expect(audio).toHaveAttribute('controls')
    expect(audio).toHaveAttribute('preload', 'metadata')
    expect(audio).not.toHaveAttribute('autoplay')
    fireEvent.play(audio)
    expect(onPlay).toHaveBeenCalledWith(audio)
  })

  it('stops preview when removed and playback when the source changes', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const view = render(<VoicePlayer src="first" preview onPlay={vi.fn()} />)
    expect(screen.getByLabelText('预听语音消息')).toBeInTheDocument()
    view.rerender(<VoicePlayer src="second" preview onPlay={vi.fn()} />)
    expect(pause).toHaveBeenCalledOnce()
    view.unmount()
    expect(pause).toHaveBeenCalledTimes(2)
  })

  it('shows an accessible playback error and clears it for a replacement recording', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const view = render(<VoicePlayer src="broken" onPlay={vi.fn()} />)
    fireEvent.error(screen.getByLabelText('播放语音消息'))
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('无法播放这段语音')
    expect(screen.getByLabelText('播放语音消息')).toHaveAttribute('aria-describedby', alert.id)
    view.rerender(<VoicePlayer src="replacement" onPlay={vi.fn()} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
