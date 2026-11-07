import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { photoSwipe, type SwipeAction } from './photoOrganizer'

type Copy = (zh: string, en: string) => string
export type PhotoSwipeStageHandle = { perform: (action: SwipeAction) => void }
type Props = {
  photoKey: string; src: string; name: string; loading: boolean
  busy: boolean; canDecide: boolean; copy: Copy
  onAction: (action: SwipeAction) => void | Promise<void>; onLoaded: () => void; onError: () => void
  onMotionChange: (moving: boolean) => void
}
const rest = 'translate3d(0, 0, 0) scale(1)'
const ease = 'cubic-bezier(.22, .72, .22, 1)'
/** Keep pointer frames and compositor animations inside the stage, not the album list. */
const PhotoSwipeStage = forwardRef<PhotoSwipeStageHandle, Props>(function PhotoSwipeStage(props, ref) {
  const stage = useRef<HTMLDivElement>(null), image = useRef<HTMLImageElement>(null)
  const gesture = useRef<{ id: number; x: number; y: number } | null>(null)
  const offset = useRef({ x: 0, y: 0 }), frame = useRef<number | null>(null)
  const animation = useRef<Animation | null>(null), locked = useRef(false), alive = useRef(false)
  const lastAction = useRef<SwipeAction | null>(null), reduced = useRef(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const loadedImage = useRef<{ node: HTMLImageElement; photoKey: string; src: string } | null>(null)
  const current = useRef(props); current.current = props
  const [cue, setCue] = useState<SwipeAction | null>(null)
  const [cueStrength, setCueStrength] = useState(0)
  useEffect(() => {
    alive.current = true
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const sync = () => { reduced.current = !!query?.matches }
    sync(); query?.addEventListener('change', sync)
    return () => { alive.current = false; query?.removeEventListener('change', sync); animation.current?.cancel(); if (frame.current !== null) cancelAnimationFrame(frame.current) }
  }, [])
  const unlock = () => { locked.current = false; if (alive.current) current.current.onMotionChange(false) }
  const animate = (keyframes: Keyframe[], duration: number, done: () => void) => {
    const node = image.current
    animation.current?.cancel(); animation.current = null
    if (!node || reduced.current || typeof node.animate !== 'function') { done(); return }
    const motion = node.animate(keyframes, { duration, easing: ease, fill: 'forwards' })
    animation.current = motion
    void motion.finished.then(() => {
      if (!alive.current || animation.current !== motion) return
      animation.current = null; motion.cancel(); done()
    }).catch(() => {
      // An unexpected browser animation cancellation must not strand a decoded image hidden.
      if (alive.current && animation.current === motion) {
        animation.current = null
        if (image.current) { image.current.style.opacity = '1'; image.current.style.transform = rest }
        unlock()
      }
    })
  }
  const resetFrames = () => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; gesture.current = null }
  useLayoutEffect(() => {
    // Reset before cached data-URL load events, never hide the image in a passive effect.
    animation.current?.cancel(); animation.current = null; resetFrames(); loadedImage.current = null
    offset.current = { x: 0, y: 0 }; setCue(null); setCueStrength(0); unlock()
    const node = image.current
    if (node) {
      node.style.transform = rest; node.style.opacity = '1'
      // WebKit may have decoded a cached image before React receives its load event.
      if (node.complete && node.naturalWidth > 0) loaded(node)
    }
  }, [props.photoKey, props.src])
  const release = () => {
    resetFrames(); setCue(null); setCueStrength(0)
    const node = image.current
    if (!node) { unlock(); return }
    const from = node.style.transform || rest
    offset.current = { x: 0, y: 0 }
    locked.current = true; current.current.onMotionChange(true)
    animate([{ transform: from }, { transform: rest }], 260, () => { if (image.current) image.current.style.transform = rest; unlock() })
  }
  const perform = (action: SwipeAction) => {
    const data = current.current
    if (locked.current || data.busy || ((action === 'pending' || action === 'keep') && !data.canDecide)) { if (gesture.current) release(); return }
    resetFrames(); lastAction.current = action
    locked.current = true; data.onMotionChange(true)
    setCue(action); setCueStrength(1)
    const width = stage.current?.clientWidth || 400, height = stage.current?.clientHeight || 400
    const x = action === 'next' ? -width * .85 : action === 'previous' ? width * .85 : 0
    const y = action === 'pending' ? -height * .85 : action === 'keep' ? height * .85 : 0
    const from = image.current?.style.transform || rest
    animate([{ transform: from, opacity: 1 }, { transform: `translate3d(${x}px, ${y}px, 0) scale(.98)`, opacity: 0 }], 220, () => {
      if (!alive.current) return
      if (image.current) { image.current.style.transform = rest; image.current.style.opacity = '0' }
      offset.current = { x: 0, y: 0 }; setCue(null); setCueStrength(0); unlock()
      const key = current.current.photoKey
      void Promise.resolve(current.current.onAction(action)).then(() => {
        // A failed write or single-photo decision keeps the same photo. Restore gently.
        if (alive.current && current.current.photoKey === key && image.current) reveal(image.current)
      }).catch(() => { if (alive.current && image.current) { image.current.style.opacity = '1'; unlock() } })
    })
  }
  useImperativeHandle(ref, () => ({ perform }))
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || locked.current || current.current.busy) return
    animation.current?.cancel(); animation.current = null
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    offset.current = { x: 0, y: 0 }; event.currentTarget.setPointerCapture(event.pointerId)
  }
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = gesture.current
    if (!start || start.id !== event.pointerId) return
    offset.current = { x: event.clientX - start.x, y: event.clientY - start.y }
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      if (!gesture.current) return
      const { x, y } = offset.current, vertical = Math.abs(y) > Math.abs(x)
      // Follow the dominant axis 1:1; damp only the perpendicular drift. No rotation.
      const tx = vertical ? x * .12 : x, ty = vertical ? y : y * .12
      const progress = Math.min(1, Math.max(Math.abs(x), Math.abs(y)) / 180)
      if (image.current) image.current.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${1 - progress * .015})`
      const action = photoSwipe(x, y)
      setCue(action); setCueStrength(Math.min(1, Math.max(0, (Math.max(Math.abs(x), Math.abs(y)) - 36) / 70)))
    })
  }
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = gesture.current
    if (!start || start.id !== event.pointerId) return
    const action = photoSwipe(event.clientX - start.x, event.clientY - start.y)
    if (action) perform(action)
    else release()
  }
  const reveal = (node: HTMLImageElement) => {
    node.style.opacity = '1'; node.style.transform = rest
    const action = lastAction.current
    lastAction.current = null
    const x = action === 'next' ? 24 : action === 'previous' ? -24 : 0
    const y = action === 'pending' ? 14 : action === 'keep' ? -14 : 0
    // Incoming photos appear only after decoding; no blank flash or spinning stack.
    animate([{ opacity: 0, transform: `translate3d(${x}px, ${y}px, 0) scale(.985)` }, { opacity: 1, transform: rest }], 240, () => { if (image.current === node) { node.style.opacity = '1'; node.style.transform = rest }; unlock() })
  }
  const loaded = (node: HTMLImageElement) => {
    const data = current.current
    if (node !== image.current || node.getAttribute('src') !== data.src) return
    const previous = loadedImage.current
    if (previous?.node === node && previous.photoKey === data.photoKey && previous.src === data.src) return
    loadedImage.current = { node, photoKey: data.photoKey, src: data.src }
    data.onLoaded(); reveal(node)
  }
  return <div ref={stage} className="organizer-photo organizer-smooth-stage" tabIndex={0} role="group" aria-label={props.copy('照片手势区域', 'Photo swipe area')}
    onKeyDown={event => { const action: Record<string, SwipeAction> = { ArrowLeft: 'previous', ArrowRight: 'next', ArrowUp: 'pending', ArrowDown: 'keep' }; if (action[event.key]) { event.preventDefault(); perform(action[event.key]) } }}
    onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { if (gesture.current) release() }} onLostPointerCapture={() => { if (gesture.current) release() }}>
    {props.src && <img key={props.photoKey} ref={image} className="organizer-stage-image" src={props.src} alt={props.name} draggable={false} onLoad={event => loaded(event.currentTarget)} onError={event => { if (event.currentTarget !== image.current || event.currentTarget.getAttribute('src') !== current.current.src) return; animation.current?.cancel(); animation.current = null; unlock(); current.current.onError() }}/>}
    {props.loading && <span className="organizer-loading" role="status">{props.copy('正在读取照片…', 'Loading photo…')}</span>}
    {cue && <span className={`organizer-swipe-label ${cue}`} style={{ opacity: cueStrength }} aria-hidden="true">{props.copy(({ pending: '↑ 待删除', keep: '↓ 保留', previous: '← 上一张', next: '→ 下一张' })[cue], ({ pending: '↑ Flag', keep: '↓ Keep', previous: '← Previous', next: '→ Next' })[cue])}</span>}
  </div>
})
export default PhotoSwipeStage
