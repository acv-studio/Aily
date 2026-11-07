import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { Character } from './data'
import { useI18n } from './i18n'
import './resumeScreenSaver.css'

export type ResumeScreenSaverProps = {
  character: Character
  name: string
  replying: boolean
  entering: boolean
  error: string
  onEnter: () => void
}

type BackgroundState = {
  inertAttribute: string | null
  ariaHidden: string | null
  hasInert: boolean
  inertValue: boolean
  ownInert: PropertyDescriptor | undefined
}

/** A presentation-only resume cover: background React trees stay mounted. */
export default function ResumeScreenSaver({ character, name, replying, entering, error, onEnter }: ResumeScreenSaverProps) {
  const { locale } = useI18n()
  const copy = (zh: string, en: string) => locale === 'en' ? en : zh
  const titleId = useId(), statusId = useId(), errorId = useId()
  const coverRef = useRef<HTMLElement>(null)
  const enterRef = useRef<HTMLButtonElement>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const cover = coverRef.current
    if (!cover) return
    const saved = new Map<HTMLElement, BackgroundState>()
    const isolateBackground = () => {
      for (const child of Array.from(document.body.children)) {
        if (!(child instanceof HTMLElement) || child === cover || child.contains(cover)) continue
        if (!saved.has(child)) {
          saved.set(child, {
            inertAttribute: child.getAttribute('inert'), ariaHidden: child.getAttribute('aria-hidden'),
            hasInert: 'inert' in child, inertValue: child.inert,
            ownInert: Object.getOwnPropertyDescriptor(child, 'inert'),
          })
        }
        child.inert = true
        child.setAttribute('inert', '')
        child.setAttribute('aria-hidden', 'true')
      }
    }
    const focusCover = () => {
      // A disabled native button is not focusable; retain the dialog as the sole fallback.
      const target = enterRef.current?.disabled ? cover : enterRef.current
      target?.focus({ preventScroll: true })
    }
    const guardFocus = (event: FocusEvent) => {
      // Window capture precedes old document capture/bubble traps (DesktopTools, etc.).
      event.stopImmediatePropagation()
      if (!(event.target instanceof Node) || !cover.contains(event.target)) focusCover()
    }
    const guardKeys = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' && event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.key === 'Tab') focusCover()
      // Escape intentionally does not enter chat or dismiss an underlying dialog.
    }
    window.addEventListener('focusin', guardFocus, true)
    window.addEventListener('keydown', guardKeys, true)
    const previous = document.activeElement
    if (previous instanceof HTMLElement && !cover.contains(previous)) previous.blur()
    isolateBackground()
    const observer = new MutationObserver(isolateBackground)
    observer.observe(document.body, { childList: true, subtree: true })
    focusCover()
    const clock = window.setInterval(() => setNow(new Date()), 30_000)

    return () => {
      observer.disconnect()
      window.clearInterval(clock)
      window.removeEventListener('focusin', guardFocus, true)
      window.removeEventListener('keydown', guardKeys, true)
      for (const [node, state] of saved) {
        if (state.ownInert) Object.defineProperty(node, 'inert', state.ownInert)
        else if (state.hasInert) node.inert = state.inertValue
        else Reflect.deleteProperty(node, 'inert')
        if (state.inertAttribute === null) node.removeAttribute('inert')
        else node.setAttribute('inert', state.inertAttribute)
        if (state.ariaHidden === null) node.removeAttribute('aria-hidden')
        else node.setAttribute('aria-hidden', state.ariaHidden)
      }
      // Do not restore an old input's focus: that would reopen the mobile keyboard.
      // Do not touch body overflow: background modals own that lifecycle.
    }
  }, [])

  useEffect(() => {
    if (entering) coverRef.current?.focus({ preventScroll: true })
    else enterRef.current?.focus({ preventScroll: true })
  }, [entering])

  return createPortal(
    <section ref={coverRef} className="resume-screensaver" role="dialog" aria-modal="true"
      aria-labelledby={titleId} aria-describedby={statusId} tabIndex={-1}
      style={{ '--resume-accent': character.accent } as CSSProperties}>
      <header className="resume-screensaver-header">
        <span>Aily</span>
        <div className="resume-screensaver-clock">
          <time dateTime={now.toISOString()}>{now.toLocaleTimeString(locale === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
          <small>{copy('本机时间', 'Device time')}</small>
        </div>
      </header>
      <div className="resume-screensaver-content">
        <p className="resume-screensaver-eyebrow">{copy('欢迎回来', 'Welcome back')}</p>
        <div className="resume-screensaver-orb" aria-hidden="true">
          <div className="resume-screensaver-halo" />
          <span className="resume-screensaver-avatar">{character.avatar}</span>
        </div>
        <h1 id={titleId}>{name.trim() || character.name}</h1>
        <div id={statusId} className="resume-screensaver-status" aria-live="polite" aria-atomic="true">
          <p className="resume-screensaver-state-label">{copy(replying ? '当前会话状态' : 'AI角色场景 · 本机演示/非真人', replying ? 'Current conversation status' : 'AI character scene · Local demo / Not a real person')}</p>
          <p className="resume-screensaver-activity">{replying ? copy('正在回复你的消息', 'Replying to your message') : character.status}</p>
          {!replying && <p className="resume-screensaver-disclosure">{copy('角色设定展示，不代表真实后台任务。', 'A character scene, not a real background task.')}</p>}
        </div>
        <button ref={enterRef} type="button" className="resume-screensaver-enter" disabled={entering}
          aria-busy={entering} aria-describedby={error ? errorId : undefined} onClick={onEnter}>
          {entering && <span className="resume-screensaver-spinner" aria-hidden="true" />}
          {copy(entering ? '正在进入聊天…' : '进入聊天', entering ? 'Entering chat…' : 'Enter chat')}
        </button>
        {error && <p id={errorId} role="alert" className="resume-screensaver-error">{error}</p>}
      </div>
      <footer className="resume-screensaver-footer">{copy('AI 陪伴 · 由你决定何时继续', 'AI companionship · Continue when you choose')}</footer>
    </section>, document.body,
  )
}
