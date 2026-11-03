import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CharacterSplash from './CharacterSplash'
import { characters } from './data'
import { getCharacterActivity } from './characterPresence'

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })
const props = () => ({ character: characters[0], activity: getCharacterActivity('lu'), staticScene: false, onChat: vi.fn(), onHome: vi.fn() })
describe('splash controls and bounded lifetime', () => {
  it('focuses skip and allows immediate character navigation', () => {
    const options = props(); render(<CharacterSplash {...options} />)
    expect(screen.getByRole('button', { name: '跳过，进入消息' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '与陆听澜继续聊天' }))
    vi.advanceTimersByTime(20_000)
    expect(options.onChat).toHaveBeenCalledTimes(1)
    expect(options.onHome).not.toHaveBeenCalled()
  })
  it('does not restart the deadline on callback rerenders; uses the latest callback', () => {
    const options = props(); const app = render(<CharacterSplash {...options} />)
    vi.advanceTimersByTime(10_000)
    const latest = vi.fn(); app.rerender(<CharacterSplash {...options} onHome={latest} />)
    vi.advanceTimersByTime(5_000)
    expect(latest).toHaveBeenCalledTimes(1)
    expect(options.onHome).not.toHaveBeenCalled()
  })
  it('does not timeout hidden and grants a fresh deadline on return', () => {
    const options = props(); render(<CharacterSplash {...options} />)
    vi.advanceTimersByTime(10_000)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    fireEvent(document, new Event('visibilitychange'))
    vi.advanceTimersByTime(60_000)
    expect(options.onHome).not.toHaveBeenCalled()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    fireEvent(document, new Event('visibilitychange'))
    vi.advanceTimersByTime(14_999)
    expect(options.onHome).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(options.onHome).toHaveBeenCalledTimes(1)
  })
  it('supports dominant upward swipe, ignores small/sideways gestures and respects static mode', () => {
    const options = props(); const { container } = render(<CharacterSplash {...options} staticScene />)
    const scene = screen.getByRole('region', { name: '陆听澜的 AI 角色场景' })
    expect(container.firstChild).toHaveClass('character-splash--static')
    const swipe = (x: number, y: number) => {
      fireEvent.touchStart(scene, { touches: [{ identifier: 1, clientX: 100, clientY: 300 }] })
      fireEvent.touchEnd(scene, { touches: [], changedTouches: [{ identifier: 1, clientX: x, clientY: y }] })
    }
    swipe(105, 270); swipe(200, 230)
    expect(options.onHome).not.toHaveBeenCalled()
    swipe(105, 200)
    expect(options.onHome).toHaveBeenCalledTimes(1)
  })
  it('supports Escape and cleans timers on unmount', () => {
    const options = props(); const app = render(<CharacterSplash {...options} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(options.onHome).toHaveBeenCalledTimes(1)
    app.unmount(); vi.advanceTimersByTime(30_000)
    expect(options.onHome).toHaveBeenCalledTimes(1)
  })
})
