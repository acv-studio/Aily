import { useEffect, useRef } from 'react'
import type { CharacterId } from './data'

/** Celebrate only a forward transition in the currently displayed relationship.
 * Initial loads, role switches, policy changes that lower the stage and deletions
 * must not look like earned upgrades. Nothing is persisted by this visual hook.
 */
export function useRelationshipMotion(role: CharacterId, threshold: number, confirmedIds: readonly string[]) {
  const surface = useRef<HTMLDivElement>(null)
  const previous = useRef({ role, threshold, seen: new Set(confirmedIds) })
  const eventKey = JSON.stringify([...new Set(confirmedIds)].sort())
  useEffect(() => {
    const ids: string[] = JSON.parse(eventKey)
    const sameRole = previous.current.role === role
    const newConfirmation = ids.some(id => !previous.current.seen.has(id))
    const upgraded = sameRole && threshold > previous.current.threshold && newConfirmation
    const seen = sameRole ? previous.current.seen : new Set<string>()
    ids.forEach(id => seen.add(id))
    previous.current = { role, threshold, seen }
    const element = surface.current
    if (!upgraded || !element?.animate || !window.matchMedia) return
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (preference.matches) return
    const options = { duration: 720, easing: 'cubic-bezier(.2,.7,.2,1)' }
    const animations = [element.animate([
      { transform: 'translateY(5px) scale(.985)', opacity: .8 },
      { transform: 'translateY(-1px) scale(1.008)', opacity: 1, offset: .55 },
      { transform: 'none', opacity: 1 },
    ], options)]
    const glint = element.querySelector('.glass-glint')
    if (glint?.animate) animations.push(glint.animate([
      { transform: 'translateX(-100%)', opacity: 0 },
      { opacity: .45, offset: .35 },
      { transform: 'translateX(100%)', opacity: 0 },
    ], options))
    const cancel = () => animations.forEach(animation => animation.cancel())
    const onPreference = () => { if (preference.matches) cancel() }
    preference.addEventListener('change', onPreference)
    return () => { cancel(); preference.removeEventListener('change', onPreference) }
  }, [role, threshold, eventKey])
  return surface
}
