import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef, useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PhotoSwipeStage, { type PhotoSwipeStageHandle } from './PhotoSwipeStage'

type Motion = { frames: Keyframe[]; options: KeyframeAnimationOptions; finish: () => void; cancel: ReturnType<typeof vi.fn> }
let motions: Motion[] = []
const pointerDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture')
const animateDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
beforeEach(() => {
  motions = []
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  class TestPointerEvent extends MouseEvent { pointerId = 1; isPrimary = true }
  vi.stubGlobal('PointerEvent', TestPointerEvent)
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: vi.fn((frames: Keyframe[], options: KeyframeAnimationOptions) => {
    let finish!: () => void
    const finished = new Promise<void>(resolve => { finish = resolve }), cancel = vi.fn()
    motions.push({ frames, options, finish, cancel })
    return { finished, cancel }
  }) })
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
  for (const [key, descriptor] of [['animate', animateDescriptor], ['setPointerCapture', pointerDescriptor]] as const) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, key)
  }
})
function mount() {
  const ref = createRef<PhotoSwipeStageHandle>(), onAction = vi.fn(), onMotionChange = vi.fn()
  const view = render(<PhotoSwipeStage ref={ref} photoKey="library:a" src="blob:a" name="Test photo" loading={false} busy={false} canDecide copy={zh => zh} onAction={onAction} onLoaded={vi.fn()} onError={vi.fn()} onMotionChange={onMotionChange}/>)
  return { ...view, ref, onAction, onMotionChange }
}
const finishMotion = async (index = motions.length - 1) => { await act(async () => { motions[index].finish(); await Promise.resolve() }) }
describe('restrained photo swipe motion', () => {
  it('slides out before committing, rejects a second action, and never rotates', async () => {
    const { ref, onAction } = mount()
    act(() => ref.current?.perform('pending'))
    act(() => ref.current?.perform('keep'))
    expect(onAction).not.toHaveBeenCalled()
    expect(motions).toHaveLength(1)
    expect(motions[0].options.duration).toBe(220)
    expect(motions[0].frames[1].transform).toContain('translate3d(0px, -340px, 0)')
    expect(JSON.stringify(motions[0].frames)).not.toContain('rotate')
    await finishMotion(0)
    expect(onAction).toHaveBeenCalledExactlyOnceWith('pending')
  })
  it('keeps cached photos visible when load fires before passive effects', async () => {
    const onLoaded = vi.fn()
    function CachedPhoto() {
      useLayoutEffect(() => { screen.getByRole('img').dispatchEvent(new Event('load')) }, [])
      return <PhotoSwipeStage photoKey="native:cached" src="data:image/jpeg;base64,AA==" name="Cached photo" loading={false} busy={false} canDecide copy={zh => zh} onAction={vi.fn()} onLoaded={onLoaded} onError={vi.fn()} onMotionChange={vi.fn()}/>
    }
    render(<CachedPhoto/>)
    expect(onLoaded).toHaveBeenCalledOnce()
    expect(screen.getByRole('img').style.opacity).toBe('1')
  })
  it('restores a decoded cached photo even if the load event was already dispatched', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(20)
    const onLoaded = vi.fn()
    render(<PhotoSwipeStage photoKey="native:cached" src="data:image/jpeg;base64,AA==" name="Cached photo" loading busy={false} canDecide={false} copy={zh => zh} onAction={vi.fn()} onLoaded={onLoaded} onError={vi.fn()} onMotionChange={vi.fn()}/>)
    expect(onLoaded).toHaveBeenCalledOnce()
    expect(screen.getByRole('img').style.opacity).toBe('1')
    fireEvent.load(screen.getByRole('img'))
    expect(onLoaded).toHaveBeenCalledOnce()
  })
  it('gently enters only after the image loads, with a small displacement', async () => {
    const { onAction } = mount()
    expect(motions).toHaveLength(0)
    fireEvent.load(screen.getByRole('img'))
    expect(motions[0].options.duration).toBe(240)
    expect(motions[0].frames[0]).toMatchObject({ opacity: 0, transform: 'translate3d(0px, 0px, 0) scale(.985)' })
    await finishMotion()
    expect(onAction).not.toHaveBeenCalled()
  })
  it('follows the finger on the dominant axis and springs back on a short drag', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(16), 16))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
    const { onAction } = mount(), area = screen.getByRole('group')
    fireEvent.pointerDown(area, { clientX: 100, clientY: 100, button: 0 })
    fireEvent.pointerMove(area, { clientX: 140, clientY: 110 })
    act(() => vi.advanceTimersByTime(16))
    expect(screen.getByRole('img').style.transform).toContain('translate3d(40px, 1.2px, 0)')
    fireEvent.pointerUp(area, { clientX: 140, clientY: 110 })
    expect(motions[0].options.duration).toBe(260)
    await finishMotion()
    expect(screen.getByRole('img').style.transform).toBe('translate3d(0, 0, 0) scale(1)')
    expect(onAction).not.toHaveBeenCalled()
  })
  it('honors reduced motion without delaying the decision', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const { ref, onAction } = mount()
    act(() => ref.current?.perform('keep'))
    expect(motions).toHaveLength(0)
    expect(onAction).toHaveBeenCalledExactlyOnceWith('keep')
  })
  it('does not save an outgoing gesture after unmount', async () => {
    const { ref, onAction, unmount } = mount()
    act(() => ref.current?.perform('pending'))
    unmount(); await finishMotion()
    expect(onAction).not.toHaveBeenCalled()
    expect(motions[0].cancel).toHaveBeenCalled()
  })
})
