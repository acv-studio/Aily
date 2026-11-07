import { useEffect, useId, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import { Capacitor } from '@capacitor/core'
import { ChevronDown, ChevronLeft, Ellipsis, Heart, Library, Pause, Play, Repeat, Repeat1, SkipBack, SkipForward, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import type { Locale } from './i18n'
import { mediaDb, type LibraryMedia } from './mediaLibrary'
import { DEFAULT_MUSIC_ARTIST, DEFAULT_MUSIC_ID, ensureDefaultMusic } from './defaultMusic'
import MediaLibraryApp from './MediaLibraryApp'
import { useTheme } from './theme'
import './musicVinyl.css'

function trackTime(value: number) { if (!Number.isFinite(value) || value < 0) return '—:—'; const seconds = Math.floor(value); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }
export default function MusicApp({ locale, onClose }: { locale: Locale; onClose?: () => void }) {
  useTheme()
  const copy = (zh: string, en: string) => locale === 'en' ? en : zh
  const [page, setPage] = useState<'player' | 'library'>('player'), [tracks, setTracks] = useState<LibraryMedia[]>([]), [urls, setUrls] = useState<Record<string, string>>({}), [activeId, setActiveId] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(true), [playing, setPlaying] = useState(false), [buffering, setBuffering] = useState(false), [duration, setDuration] = useState(0), [position, setPosition] = useState(0)
  const [volume, setVolume] = useState(.8), [muted, setMuted] = useState(false), [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off')
  const [options, setOptions] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const audio = useRef<HTMLAudioElement>(null), mounted = useRef(false), working = useRef(false), map = useRef<Record<string, string>>({}), sourceId = useRef<string | null>(null), cancelOptions = useRef<HTMLButtonElement>(null)
  const metalId = `music-metal-${useId().replace(/:/g, '')}`, menuHeading = useId()
  const active = tracks.find(track => track.id === activeId)
  const currentUrl = activeId ? urls[activeId] : ''
  const iosVolume = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'
  useEffect(() => {
    mounted.current = true
    const subscription = liveQuery(() => mediaDb.items.where('kind').equals('music').reverse().sortBy('addedAt')).subscribe({
      next: data => {
        if (!mounted.current) return
        const next: Record<string, string> = {}
        for (const item of data) next[item.id] = map.current[item.id] || URL.createObjectURL(item.blob)
        for (const [id, url] of Object.entries(map.current)) if (!next[id]) URL.revokeObjectURL(url)
        map.current = next; setUrls(next); setTracks(data)
        setActiveId(previous => previous && next[previous] ? previous : data.find(track => track.id === DEFAULT_MUSIC_ID)?.id || data[0]?.id || null)
      },
      error: () => { if (mounted.current) { setPreparing(false); setError(copy('本机音乐库读取失败，原有文件未被覆盖，请重新打开。', 'The local library could not be read. Existing files are unchanged; reopen to retry.')) } },
    })
    return () => { mounted.current = false; subscription.unsubscribe(); audio.current?.pause(); for (const url of Object.values(map.current)) URL.revokeObjectURL(url); map.current = {} }
  }, [])
  useEffect(() => {
    let disposed = false
    void ensureDefaultMusic().catch(() => { if (!disposed) setError(copy('默认音乐暂未能加入，请检查本机空间；已有音乐未更改，可以从音乐库添加或重试。', 'The original default track could not be added. Check local storage; existing music is unchanged. Import a track or retry.')) }).finally(() => { if (!disposed) setPreparing(false) })
    return () => { disposed = true }
  }, [])
  useEffect(() => {
    const player = audio.current
    if (!player) return
    if (!activeId || !currentUrl) { player.pause(); player.removeAttribute('src'); sourceId.current = null; setPlaying(false); setDuration(0); setPosition(0); return }
    if (player.getAttribute('src') !== currentUrl) {
      player.pause(); player.src = currentUrl; player.load(); sourceId.current = activeId
      setPlaying(false); setBuffering(false); setPosition(0); setDuration(0)
    }
  }, [activeId, currentUrl])
  useEffect(() => { const player = audio.current; if (player) { if (!iosVolume) player.volume = volume; player.muted = muted } }, [volume, muted, iosVolume])
  useEffect(() => {
    if (!options) return
    cancelOptions.current?.focus()
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) setOptions(false) } }
    document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true)
  }, [options, busy])
  const failPlay = () => { if (mounted.current) { audio.current?.pause(); setPlaying(false); setBuffering(false); setError(copy('这首音频暂时无法播放，可能格式不支持或系统阻止了播放。请点播放重试，或导入 MP3、M4A、WAV。', 'This audio could not play: its format may be unsupported or playback was blocked. Tap Play again, or import MP3, M4A or WAV.')) } }
  const play = (track = active) => {
    const player = audio.current
    if (!player || !track) return
    setError('')
    let url = map.current[track.id]
    if (!url) { url = URL.createObjectURL(track.blob); map.current[track.id] = url; setUrls(previous => ({ ...previous, [track.id]: url })) }
    if (player.getAttribute('src') !== url) { player.pause(); player.src = url; player.load(); setPosition(0); setDuration(0) }
    sourceId.current = track.id; setActiveId(track.id)
    void player.play().catch(() => { if (sourceId.current === track.id) failPlay() }) // Called from a user action or continuation of their chosen playback mode.
  }
  const select = (track: LibraryMedia) => { setPage('player'); setOptions(false); play(track) }
  const move = (direction: number) => {
    if (!tracks.length || busy) return
    const index = tracks.findIndex(track => track.id === activeId)
    const next = tracks[(index + direction + tracks.length) % tracks.length]
    select(next)
  }
  const togglePlayback = () => { if (!active || busy) return; if (playing) audio.current?.pause(); else play() }
  const ended = () => {
    setPlaying(false); setBuffering(false)
    if (repeat === 'one') { if (audio.current) audio.current.currentTime = 0; play(); return }
    const index = tracks.findIndex(track => track.id === activeId)
    if (index >= 0 && (index < tracks.length - 1 || repeat === 'all')) select(tracks[(index + 1) % tracks.length])
  }
  const operate = async (work: () => Promise<void>) => {
    if (working.current) return
    working.current = true; setBusy(true); setError('')
    try { await work() } catch { if (mounted.current) setError(copy('操作未完成，原文件不会被覆盖，请重试。', 'Operation incomplete; existing files will not be overwritten. Retry.')) }
    finally { working.current = false; if (mounted.current) setBusy(false) }
  }
  const favorite = () => {
    if (!active) return
    void operate(async () => { await mediaDb.transaction('rw', mediaDb.items, async () => { const current = await mediaDb.items.get(active.id); if (current?.kind === 'music') await mediaDb.items.update(active.id, { favorite: !current.favorite }) }) })
    setOptions(false)
  }
  const remove = () => {
    if (!active || busy || !window.confirm(copy(`从 Aily 移除「${active.name}」？只删除本机音乐库副本，不改变系统文件。`, `Remove “${active.name}” from Aily? Only the library copy is removed; system files are unchanged.`))) return
    const id = active.id; setOptions(false)
    void operate(async () => { audio.current?.pause(); await mediaDb.items.delete(id) })
  }
  const restore = () => { void operate(async () => { await ensureDefaultMusic({ restore: true }) }) }
  const artist = active?.artist || (active?.id === DEFAULT_MUSIC_ID ? DEFAULT_MUSIC_ARTIST : active?.collection || copy('本机音乐', 'On-device music'))
  const recordNumber = Math.max(1, tracks.findIndex(track => track.id === activeId) + 1)
  return <section className={`music-vinyl-app music-page-${page}`} aria-label={copy('黑胶音乐播放器', 'Vinyl music player')}>
    <header className="vinyl-header"><button disabled={busy || options} aria-label={copy(page === 'player' ? '收起播放器' : '返回 Aily', page === 'player' ? 'Collapse player' : 'Back to Aily')} onClick={() => page === 'player' ? setPage('library') : onClose?.()}>{page === 'player' ? <ChevronDown size={23}/> : <ChevronLeft size={23}/>}</button><strong>{copy(page === 'player' ? '正在播放' : '我的音乐', page === 'player' ? 'Now playing' : 'My music')}</strong><button disabled={busy || !active || options} aria-label={copy('音乐操作', 'Music options')} onClick={() => setOptions(true)}><Ellipsis size={24}/></button></header>
    <audio ref={audio} preload="metadata" aria-label={copy('音乐音频', 'Music audio')} onLoadedMetadata={event => { setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0); setPosition(event.currentTarget.currentTime || 0) }} onDurationChange={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onTimeUpdate={event => setPosition(event.currentTarget.currentTime || 0)} onPlay={() => setPlaying(true)} onPlaying={() => { setPlaying(true); setBuffering(false) }} onPause={() => { setPlaying(false); setBuffering(false) }} onWaiting={() => setBuffering(true)} onCanPlay={() => setBuffering(false)} onEnded={ended} onError={failPlay}/>
    {page === 'player' ? <main className="vinyl-player" inert={options} aria-hidden={options || undefined}>
      {error && <p className="vinyl-error" role="alert">{error}</p>}
      <div className={`vinyl-stage${playing && !buffering ? ' is-playing' : ''}`} aria-label={copy(playing && !buffering ? '唱片正在转动' : '唱片已停止', playing && !buffering ? 'Record spinning' : 'Record stopped')}><div className="vinyl-turntable"><div className="vinyl-record"><div className="vinyl-label"><span>{copy('A 面', 'SIDE A')}</span><small>{copy(`第 ${String(recordNumber).padStart(2, '0')} 首`, `TRACK ${String(recordNumber).padStart(2, '0')}`)}</small></div><span className="vinyl-spindle"/></div><svg className="vinyl-tonearm" viewBox="0 0 240 430" aria-hidden="true"><defs><linearGradient id={metalId} x1="0" x2="1"><stop stopColor="#333"/><stop offset=".22" stopColor="#dcd8cc"/><stop offset=".5" stopColor="#fff9e9"/><stop offset=".7" stopColor="#605f59"/><stop offset="1" stopColor="#d7d3c6"/></linearGradient></defs><circle cx="173" cy="44" r="31" fill={`url(#${metalId})`} stroke="#211f1d" strokeWidth="2"/><circle cx="173" cy="44" r="17" fill="#2a2925" stroke="#b8b29f" strokeWidth="5"/><path d="M172 45C94 97 217 180 155 303L129 345" fill="none" stroke="#1b1a17" strokeWidth="19"/><path d="M172 45C94 97 217 180 155 303L129 345" fill="none" stroke={`url(#${metalId})`} strokeWidth="13"/><path d="M171 45C105 101 220 180 158 303L131 345" fill="none" stroke="#efe9d4" strokeWidth="2" opacity=".8"/><g transform="translate(104 321) rotate(28 20 33)"><rect width="42" height="65" rx="6" fill="#272823" stroke={`url(#${metalId})`} strokeWidth="6"/><path d="M11 12H31M11 22H31M11 32H31" stroke="#aba79a" strokeWidth="2"/><path d="M21 65V77" stroke="#e4d3a3" strokeWidth="3"/></g></svg></div></div>
      <div className="vinyl-song-info"><h2>{active?.name || copy(preparing ? '准备你的第一张唱片…' : '唱片架还空着', preparing ? 'Preparing your first record…' : 'Your record shelf is empty')}</h2><p>{active ? artist : copy('添加本地音乐，或恢复原创默认曲', 'Import local music or restore the original default track')}</p>{active?.id === DEFAULT_MUSIC_ID && <small>{copy('Aily 原创 · 器乐', 'Aily original · Instrumental')}</small>}</div>
      {active ? <><div className="vinyl-progress"><input type="range" aria-label={copy('播放进度', 'Playback position')} min={0} max={duration || 1} step={.1} value={Math.min(position, duration || 1)} disabled={!duration || busy || options} onChange={event => { const next = Number(event.target.value); if (audio.current && Number.isFinite(next) && duration > 0) { try { audio.current.currentTime = Math.min(duration, next); setPosition(next) } catch { setError(copy('暂时无法调整进度，请稍后重试。', 'Seeking is unavailable. Retry shortly.')) } } }}/><div className="vinyl-times"><time>{trackTime(position)}</time><time>{duration ? trackTime(duration) : '—:—'}</time></div></div>
        <div className="vinyl-transport"><button disabled={busy || tracks.length < 2 || options} aria-label={copy('上一首', 'Previous track')} onClick={() => move(-1)}><SkipBack size={26} fill="currentColor"/></button><button className="vinyl-play" disabled={busy || options} aria-label={copy(playing ? '暂停播放' : '播放音乐', playing ? 'Pause music' : 'Play music')} onClick={togglePlayback}>{playing ? <Pause size={30} fill="currentColor"/> : <Play size={30} fill="currentColor"/>}</button><button disabled={busy || tracks.length < 2 || options} aria-label={copy('下一首', 'Next track')} onClick={() => move(1)}><SkipForward size={26} fill="currentColor"/></button></div>
        <div className="vinyl-secondary-controls"><button disabled={options || busy} aria-label={copy('切换播放方式', 'Change repeat mode')} onClick={() => setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')}>{repeat === 'one' ? <Repeat1 size={16}/> : <Repeat size={16}/>} {copy(({ off: '顺序播放', all: '列表循环', one: '单曲循环' })[repeat], ({ off: 'In order', all: 'Repeat all', one: 'Repeat one' })[repeat])}</button><button disabled={busy || options} aria-pressed={active.favorite} aria-label={copy('收藏当前音乐', 'Favorite current track')} onClick={favorite}><Heart size={17} fill={active.favorite ? 'currentColor' : 'none'}/></button></div>
        <div className="vinyl-volume"><button disabled={options} aria-label={copy(muted ? '取消静音' : '静音', muted ? 'Unmute' : 'Mute')} onClick={() => setMuted(!muted)}>{muted ? <VolumeX size={19}/> : <Volume2 size={19}/>}</button>{iosVolume ? <span className="vinyl-system-volume">{copy('音量请用侧边键或控制中心调节', 'Use side buttons or Control Center for volume')}</span> : <input type="range" aria-label={copy('播放音量', 'Playback volume')} min={0} max={1} step={.01} value={volume} disabled={options} onChange={event => setVolume(Number(event.target.value))}/>}</div>
        <div className={`vinyl-rhythm${playing && !buffering ? ' is-playing' : ''}`} aria-hidden="true">{Array.from({ length: 52 }, (_, index) => <i key={index} style={{ height: `${5 + Math.abs(Math.sin(index * 1.93)) * 28}px`, animationDelay: `${index * -.07}s` }}/>)}</div><small className="vinyl-rhythm-caption">{copy('视觉节奏装饰 · 非音频频谱', 'Decorative rhythm · Not an audio spectrum')}</small>
      </> : <div className="vinyl-empty"><button disabled={busy || preparing || options} onClick={restore}>{copy('恢复默认音乐', 'Restore default track')}</button></div>}
      <button className="vinyl-library-link" disabled={busy || options} onClick={() => setPage('library')}><Library size={18}/>{copy(`音乐库 · ${tracks.length} 首`, `Library · ${tracks.length} tracks`)}</button>
      {(preparing || buffering) && <p className="vinyl-status" role="status">{copy(preparing ? '正在本机准备原创默认音乐，不会自动播放。' : '音频加载中…', preparing ? 'Preparing the original default track locally. It will not autoplay.' : 'Buffering audio…')}</p>}
    </main> : <main className="vinyl-library" inert={options} aria-hidden={options || undefined}>{error && <p className="vinyl-error" role="alert">{error}</p>}<button className="vinyl-library-link" disabled={!active || busy || options} onClick={() => setPage('player')}><Library size={18}/>{copy('返回唱片机', 'Back to turntable')}</button><MediaLibraryApp kind="music" copy={copy} onOpenMedia={select}/><p className="vinyl-status">{copy('只播放本机导入或原创默认音乐，不读取受保护的 Apple Music 曲库；原有音乐和播放列表保留。', 'Plays local imports and the original default track only, not protected Apple Music tracks. Existing music and playlists are kept.')}</p></main>}
    {options && <div className="vinyl-options-backdrop"><section className="vinyl-options" role="dialog" aria-modal="true" aria-labelledby={menuHeading}><header><h3 id={menuHeading}>{copy('音乐操作', 'Music options')}</h3><p>{active?.name}</p></header><button disabled={busy || !active} onClick={favorite}><Heart size={17}/>{copy(active?.favorite ? '取消收藏' : '收藏曲目', active?.favorite ? 'Unfavorite' : 'Favorite track')}</button><button disabled={busy} onClick={() => { setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'); setOptions(false) }}><Repeat size={17}/>{copy('切换播放方式', 'Change repeat mode')}</button><button disabled={busy} onClick={() => { setPage('library'); setOptions(false) }}><Library size={17}/>{copy('打开音乐库', 'Open library')}</button><button className="vinyl-remove" disabled={busy || !active} onClick={remove}><Trash2 size={17}/>{copy('移除当前曲目', 'Remove current track')}</button><button ref={cancelOptions} disabled={busy} onClick={() => setOptions(false)}><X size={16}/>{copy('取消', 'Cancel')}</button></section></div>}
  </section>
}
