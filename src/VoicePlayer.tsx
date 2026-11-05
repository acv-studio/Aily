import { useEffect, useId, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { useI18n } from './i18n'

export default function VoicePlayer({ src, preview = false, onPlay }: {
  src: string
  preview?: boolean
  onPlay: (audio: HTMLAudioElement) => void
}) {
  const { t } = useI18n()
  const audio = useRef<HTMLAudioElement>(null)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const errorId = useId()
  useEffect(() => {
    const element = audio.current
    setFailed(false); setPlaying(false); setCurrent(0); setDuration(0)
    return () => { element?.pause() }
  }, [src])
  const toggle = async () => {
    const element = audio.current
    if (!element) return
    if (element.paused) { try { await element.play() } catch { setFailed(true) } }
    else element.pause()
  }
  const seek = (value: number) => { const element = audio.current; if (!element || !Number.isFinite(element.duration)) return; element.currentTime = value; setCurrent(value) }
  const total = duration || 1
  const progress = Math.min(100, current / total * 100)
  return <div className={`voice-player custom-voice ${playing ? 'is-playing' : ''}`}>
    <audio ref={audio} controls preload="metadata" src={src} aria-label={t(preview ? '预听语音消息' : '播放语音消息')} aria-describedby={failed ? errorId : undefined}
      onLoadedMetadata={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
      onTimeUpdate={event => setCurrent(event.currentTarget.currentTime)} onPlay={event => { setPlaying(true); onPlay(event.currentTarget) }} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setCurrent(0) }} onError={() => setFailed(true)} />
    <button type="button" className="voice-toggle" aria-label={t(playing ? '暂停' : '播放')} onClick={() => void toggle()}>{playing ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor"/>}</button>
    <div className="voice-wave" aria-hidden="true">{[5,9,13,8,16,11,7,14,10,6,12,8,15,9,5,11,7,13].map((height,index)=><i key={index} style={{height, opacity:index/18*100<=progress?1:.35}}/>)}</div>
    <input className="voice-seek" type="range" min="0" max={duration || 0} step="0.01" value={Math.min(current,duration||0)} aria-label={t('语音播放进度')} onChange={event=>seek(Number(event.target.value))}/>
    <time>{formatTime(playing ? current : duration)}</time>
    {failed && <p id={errorId} role="alert">{t('无法播放这段语音，请使用支持此录音格式的浏览器重试；录音不会发送给模型。')}</p>}
  </div>
}

function formatTime(seconds:number){const safe=Number.isFinite(seconds)?Math.max(0,Math.round(seconds)):0;return `${Math.floor(safe/60)}:${String(safe%60).padStart(2,'0')}`}
