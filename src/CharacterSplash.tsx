import { useEffect, useRef, type CSSProperties, type TouchEvent } from 'react'
import type { Character } from './data'
import { useI18n } from './i18n'
import './characterSplash.css'

interface CharacterSplashProps {
  character: Character
  activity: {
    status: string
    quote: string
    scene: 'morning' | 'day' | 'evening' | 'night'
  }
  staticScene: boolean
  onChat: () => void
  onHome: () => void
}

const sceneLabels = {
  morning: '晨光微亮',
  day: '日光正好',
  evening: '暮色渐暖',
  night: '夜色安静',
}

const DISPLAY_DURATION = 15_000

export default function CharacterSplash({
  character,
  activity,
  staticScene,
  onChat,
  onHome,
}: CharacterSplashProps) {
  const { t } = useI18n()
  const skipRef = useRef<HTMLButtonElement>(null)
  const callbacks = useRef({ onChat, onHome })
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finished = useRef(false)
  const touchStart = useRef<{ id: number; x: number; y: number } | null>(null)
  // The mount-only lifetime must not restart when a parent creates new callbacks.
  callbacks.current = { onChat, onHome }

  function leave(destination: 'chat' | 'home') {
    if (finished.current) return
    finished.current = true
    if (timeout.current !== null) clearTimeout(timeout.current)
    timeout.current = null
    callbacks.current[destination === 'chat' ? 'onChat' : 'onHome']()
  }

  useEffect(() => {
    skipRef.current?.focus({ preventScroll: true })

    function clearTimer() {
      if (timeout.current !== null) clearTimeout(timeout.current)
      timeout.current = null
    }

    function startTimer() {
      clearTimer()
      if (document.hidden || finished.current) return
      timeout.current = setTimeout(() => {
        timeout.current = null
        if (document.hidden || finished.current) return
        finished.current = true
        callbacks.current.onHome()
      }, DISPLAY_DURATION)
    }

    // Returning to the app always grants a fresh 15 seconds, not an expired timer.
    function handleVisibility() {
      if (document.hidden) clearTimer()
      else startTimer()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || finished.current) return
      event.preventDefault()
      finished.current = true
      clearTimer()
      callbacks.current.onHome()
    }

    startTimer()
    document.addEventListener('visibilitychange', handleVisibility)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      clearTimer()
      document.removeEventListener('visibilitychange', handleVisibility)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  function handleTouchStart(event: TouchEvent<HTMLElement>) {
    if (event.touches.length !== 1) {
      touchStart.current = null
      return
    }
    const touch = event.touches[0]
    touchStart.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY }
  }

  function handleTouchEnd(event: TouchEvent<HTMLElement>) {
    const start = touchStart.current
    touchStart.current = null
    if (!start || event.touches.length !== 0) return
    const end = Array.from(event.changedTouches).find(touch => touch.identifier === start.id)
    if (!end) return
    const upward = start.y - end.clientY
    const horizontal = Math.abs(end.clientX - start.x)
    if (upward >= 60 && upward > horizontal) leave('home')
  }

  return (
    <section
      className={`character-splash character-splash--${activity.scene}${staticScene ? ' character-splash--static' : ''}`}
      style={{ '--splash-accent': character.accent } as CSSProperties}
      aria-label={t('{name}的 AI 角色场景', { name: t(character.name) })}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => { touchStart.current = null }}
    >
      <div className="character-splash__environment" aria-hidden="true">
        <div className="character-splash__glow" />
        <div className="character-splash__window">
          <span className="character-splash__celestial" />
          <span className="character-splash__cloud character-splash__cloud--one" />
          <span className="character-splash__cloud character-splash__cloud--two" />
          <span className="character-splash__skyline" />
        </div>
        <div className="character-splash__curtain" />
        <div className="character-splash__lamp"><span /></div>
        <div className="character-splash__table">
          <span className="character-splash__book" />
          <span className="character-splash__cup" />
        </div>
        <div className="character-splash__grain" />
      </div>

      <header className="character-splash__header">
        <span className="character-splash__brand"><span aria-hidden="true">✦</span> {t('Aily')}</span>
        <button ref={skipRef} className="character-splash__skip" type="button" onClick={() => leave('home')}>
          {t('跳过，进入消息')} <span aria-hidden="true">↗</span>
        </button>
      </header>

      <main className="character-splash__content">
        <p className="character-splash__scene-label"><span aria-hidden="true" />{t(sceneLabels[activity.scene])}</p>
        <p className="character-splash__disclosure">{t('AI 角色 · 本机日程演示')}</p>

        <button
          type="button"
          className="character-splash__character"
          aria-label={t('与{name}继续聊天', { name: t(character.name) })}
          onClick={() => leave('chat')}
        >
          <span className="character-splash__portrait" aria-hidden="true">
            <span className="character-splash__portrait-orbit" />
            <span className="character-splash__shoulders" />
            <span className="character-splash__avatar">{t(character.avatar || character.name.slice(0, 1))}</span>
            <span className="character-splash__portrait-spark">✧</span>
          </span>
          <span className="character-splash__chat-hint">{t('轻触角色，继续聊天')} <span aria-hidden="true">↗</span></span>
        </button>

        <div className="character-splash__copy">
          <p className="character-splash__title">{t(character.title)}</p>
          <h1>{t(character.name)}</h1>
          <p className="character-splash__status"><span aria-hidden="true" />{t(activity.status)}</p>
          <blockquote><span aria-hidden="true" className="character-splash__quote-mark">“</span>{t(activity.quote)}</blockquote>
        </div>
      </main>

      <footer className="character-splash__footer">
        <button className="character-splash__enter" type="button" onClick={() => leave('home')}>
          <span className="character-splash__chevron" aria-hidden="true">⌃</span>
          <span>{t('上滑进入消息')}</span>
        </button>
        <p className="character-splash__timeout">{t('无需等待 · 15 秒后自动进入消息')}</p>
        <p className="character-splash__privacy">{t('虚构 AI 场景，状态由本机演示日程生成')}<br />{t('不代表真实人物的生活或活动')}</p>
      </footer>
    </section>
  )
}
