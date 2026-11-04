import { useEffect, useRef, useState } from 'react'
import { useI18n } from './i18n'

export default function VideoPlayer({ src, preview = false, onPlay }: { src: string; preview?: boolean; onPlay: (video: HTMLVideoElement) => void }) {
  const { t } = useI18n()
  const video = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
    const player = video.current
    return () => { if (player && !player.paused) player.pause() }
  }, [src])
  return <div className="chat-video-player">
    <video ref={video} className="chat-video" src={src} controls playsInline preload="metadata" aria-label={t(preview ? '预览待发送视频' : '播放视频消息')} onPlay={event => onPlay(event.currentTarget)} onError={() => setFailed(true)} />
    {failed && <p role="status">{t('此视频无法播放，请尝试 MP4（H.264）格式。')}</p>}
  </div>
}
