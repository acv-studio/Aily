import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRelationshipMotion } from './glassMotion'
import type { CharacterId } from './data'

function Surface({ role = 'lu', threshold, ids = ['seed'] }: { role?: CharacterId; threshold: number; ids?: string[] }) {
  const ref = useRelationshipMotion(role, threshold, ids)
  return <div ref={ref}><span className="glass-glint" /></div>
}
const cancel = vi.fn()
const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => ({ cancel }))
let reduced = false
let preferenceChanged: (() => void) | undefined
beforeEach(() => {
  reduced = false
  preferenceChanged = undefined
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return reduced },
    addEventListener: (_: string, listener: () => void) => { preferenceChanged = listener },
    removeEventListener: vi.fn(),
  })))
  vi.stubGlobal('Animation', class {})
  Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); Reflect.deleteProperty(Element.prototype, 'animate') })

describe('relationship motion', () => {
  it('does not celebrate initial load, same stage, downgrade or switching roles', () => {
    const view = render(<Surface threshold={5} />)
    view.rerender(<Surface threshold={5} />)
    view.rerender(<Surface threshold={2} />)
    view.rerender(<Surface role="chen" threshold={9} />)
    expect(animate).not.toHaveBeenCalled()
  })
  it('plays finite surface/glint animations only for a forward change, and cancels on unmount', () => {
    const view = render(<Surface threshold={2} />)
    view.rerender(<Surface threshold={5} ids={['seed', 'new']} />)
    expect(animate).toHaveBeenCalledTimes(2)
    expect(animate.mock.calls[0][1]).toMatchObject({ duration: 720 })
    view.unmount()
    expect(cancel).toHaveBeenCalledTimes(2)
  })
  it('respects reduced motion before and during an upgrade', () => {
    reduced = true
    const view = render(<Surface threshold={0} />)
    view.rerender(<Surface threshold={2} ids={['seed', 'second']} />)
    expect(animate).not.toHaveBeenCalled()
    reduced = false
    view.rerender(<Surface threshold={5} ids={['seed', 'second', 'third']} />)
    reduced = true
    preferenceChanged?.()
    expect(cancel).toHaveBeenCalledTimes(2)
  })
  it('does not celebrate restoring a category, paused memory, or previously deleted memory', () => {
    const view = render(<Surface threshold={5} ids={['seed', 'existing']} />)
    view.rerender(<Surface threshold={2} ids={['seed', 'existing']} />)
    view.rerender(<Surface threshold={5} ids={['seed', 'existing']} />)
    view.rerender(<Surface threshold={2} ids={['seed']} />)
    view.rerender(<Surface threshold={5} ids={['seed', 'existing']} />)
    expect(animate).not.toHaveBeenCalled()
  })
  it('leaves content functional when Web Animations is unavailable', () => {
    Reflect.deleteProperty(Element.prototype, 'animate')
    const view = render(<Surface threshold={0} />)
    expect(() => view.rerender(<Surface threshold={2} ids={['seed', 'new']} />)).not.toThrow()
  })
})
