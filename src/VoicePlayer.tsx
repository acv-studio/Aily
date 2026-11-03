import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from './i18n'

/** Native controls provide play/pause, seeking and duration without autoplay. */
export default function VoicePlayer({ src, preview = false, onPlay }: {
  src: string
  preview?: boolean
  onPlay: (audio: HTMLAudioElement) => void
}) {
  const { t } = useI18n()
  const audio = useRef<HTMLAudioElement>(null)
  const [failed, setFailed] = useState(false)
  const errorId = useId()
  useEffect(() => {
    const element = audio.current
    setFailed(false)
    // Removing a draft, withdrawing a message or leaving chat must stop sound.
    return () => { element?.pause() }
  }, [src])
  return <div className="voice-player">
    <audio ref={audio} controls preload="metadata" src={src}
      aria-label={t(preview ? '预听语音消息' : '播放语音消息')}
      aria-describedby={failed ? errorId : undefined}
      onPlay={event => onPlay(event.currentTarget)} onError={() => setFailed(true)} />
    {failed && <p id={errorId} role="alert">{t('无法播放这段语音，请使用支持此录音格式的浏览器重试；录音不会发送给模型。')}</p>}
  </div>
}
