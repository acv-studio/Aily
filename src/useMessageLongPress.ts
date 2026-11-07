import { useEffect, useRef } from 'react'
import type { KeyboardEvent, PointerEvent, MouseEvent } from 'react'
import type { ChatMessage } from './chatService'

export const MESSAGE_LONG_PRESS_MS = 450
export const MESSAGE_LONG_PRESS_MOVE_PX = 10
const interactive = (target: EventTarget | null) => target instanceof Element && !!target.closest('button,input,textarea,select,a,audio,video,[data-no-message-actions]')

/** Native scrolling remains enabled; a tap never opens the menu. Keyboard/right-click remain accessible. */
export default function useMessageLongPress(messages: ChatMessage[], context: string, open: (id: number) => void) {
  const live = useRef({ messages, context, open }); live.current = { messages, context, open }
  const pending = useRef<{ id: number; pointer: number; x: number; y: number; context: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancel = () => { if (timer.current !== undefined) clearTimeout(timer.current); timer.current = undefined; pending.current = null }
  const eligible = (id: number) => { const message = live.current.messages.find(message => message.id === id); return !!message && !message.withdrawn && message.status !== 'sending' }
  useEffect(() => {
    const stop = () => cancel()
    const extraPointer = (event: globalThis.PointerEvent) => { if (event.isPrimary === false) cancel() }
    document.addEventListener('pointerup', stop, true)
    document.addEventListener('pointercancel', stop, true)
    document.addEventListener('pointerdown', extraPointer, true)
    document.addEventListener('scroll', stop, true)
    window.addEventListener('blur', stop)
    return () => {
      cancel(); document.removeEventListener('pointerup', stop, true); document.removeEventListener('pointercancel', stop, true)
      document.removeEventListener('pointerdown', extraPointer, true); document.removeEventListener('scroll', stop, true); window.removeEventListener('blur', stop)
    }
  }, [])
  useEffect(() => { cancel() }, [context])
  return {
    pointerDown(id: number, event: PointerEvent<HTMLElement>) {
      cancel()
      if (!eligible(id) || interactive(event.target) || event.isPrimary === false || (event.button ?? 0) !== 0) return
      const hold = { id, pointer: event.pointerId ?? 0, x: event.clientX ?? 0, y: event.clientY ?? 0, context: live.current.context }
      pending.current = hold
      timer.current = setTimeout(() => {
        timer.current = undefined
        if (pending.current === hold && live.current.context === hold.context && eligible(id)) live.current.open(id)
      }, MESSAGE_LONG_PRESS_MS)
    },
    pointerMove(event: PointerEvent<HTMLElement>) {
      const hold = pending.current
      if (hold && hold.pointer === (event.pointerId ?? 0) && Math.hypot((event.clientX ?? 0) - hold.x, (event.clientY ?? 0) - hold.y) > MESSAGE_LONG_PRESS_MOVE_PX) cancel()
    },
    cancel,
    contextMenu(id: number, event: MouseEvent<HTMLElement>) {
      if (!eligible(id) || interactive(event.target)) return
      event.preventDefault(); cancel(); live.current.open(id)
    },
    keyDown(id: number, event: KeyboardEvent<HTMLElement>) {
      if (!eligible(id) || interactive(event.target) || !['Enter', ' '].includes(event.key)) return
      event.preventDefault(); cancel(); live.current.open(id)
    },
  }
}
