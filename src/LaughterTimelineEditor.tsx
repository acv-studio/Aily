import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { Play, Scissors, Trash2, Undo2, RotateCcw } from 'lucide-react'
import type { AudioSegment } from './laughterAudio'
import { splitTimelineSegment, trimTimelineSegment, removeTimelineSegment } from './laughterTimeline'

type Props = { buffer: AudioBuffer; blob: Blob; segments: AudioSegment[]; onChange: (segments: AudioSegment[]) => void; disabled: boolean; copy: (zh: string, en: string) => string }
const stamp = (value: number) => `${Math.floor(value / 60)}:${(value % 60).toFixed(1).padStart(4, '0')}`
export default function LaughterTimelineEditor({ buffer, blob, segments, onChange, disabled, copy }: Props) {
  const [selected, setSelected] = useState(0), [cursor, setCursor] = useState(0), [url, setUrl] = useState('')
  const [history, setHistory] = useState<AudioSegment[][]>([]), [error, setError] = useState('')
  const audio = useRef<HTMLAudioElement>(null), track = useRef<HTMLDivElement>(null)
  const playbackEnd = useRef<number | null>(null), dragging = useRef<'start' | 'end' | null>(null)
  const minimum = Math.min(.05, 1 / buffer.sampleRate), duration = buffer.duration
  const activeIndex = Math.min(selected, Math.max(0, segments.length - 1)), active = segments[activeIndex]
  const peaks = useMemo(() => {
    const data = buffer.getChannelData(0)
    return Array.from({ length: 160 }, (_, index) => {
      const from = Math.floor(index * data.length / 160), to = Math.floor((index + 1) * data.length / 160)
      let peak = 0
      for (let frame = from; frame < to; frame += Math.max(1, Math.floor((to - from) / 100))) peak = Math.max(peak, Math.abs(data[frame]))
      return peak
    })
  }, [buffer])
  useEffect(() => {
    const value = URL.createObjectURL(blob); setUrl(value)
    return () => { URL.revokeObjectURL(value) }
  }, [blob])
  useEffect(() => { if (disabled && audio.current && !audio.current.paused) audio.current.pause() }, [disabled])
  const seek = (value: number, selectClip = false) => {
    const next = Math.max(0, Math.min(duration, value)); setCursor(next); playbackEnd.current = null
    if (selectClip) { const index = segments.findIndex(segment => next >= segment.start && next < segment.end); if (index >= 0) setSelected(index) }
    if (audio.current) audio.current.currentTime = next
  }
  const change = (next: AudioSegment[]) => {
    if (disabled || JSON.stringify(next) === JSON.stringify(segments)) return
    if (audio.current && !audio.current.paused) audio.current.pause()
    playbackEnd.current = null
    setHistory(previous => [...previous.slice(-29), segments.map(segment => ({ ...segment }))]); onChange(next)
  }
  const position = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect()
    return rect && rect.width > 0 ? Math.max(0, Math.min(duration, (clientX - rect.left) / rect.width * duration)) : cursor
  }
  const moveEdge = (edge: 'start' | 'end', at: number) => {
    const next = trimTimelineSegment(segments, activeIndex, edge, at, duration, minimum)
    if (JSON.stringify(next) !== JSON.stringify(segments)) { onChange(next); seek(next[activeIndex][edge]) }
  }
  const beginDrag = (event: PointerEvent<HTMLButtonElement>, edge: 'start' | 'end') => {
    if (disabled) return
    event.preventDefault(); event.stopPropagation()
    dragging.current = edge
    setHistory(previous => [...previous.slice(-29), segments.map(segment => ({ ...segment }))])
    if (audio.current && !audio.current.paused) audio.current.pause()
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const keyEdge = (event: KeyboardEvent<HTMLButtonElement>, edge: 'start' | 'end') => {
    if (!active || disabled) return
    const values: Record<string, number> = { ArrowLeft: active[edge] - .05, ArrowDown: active[edge] - .05, ArrowRight: active[edge] + .05, ArrowUp: active[edge] + .05, Home: edge === 'start' ? 0 : active.start + minimum, End: edge === 'end' ? duration : active.end - minimum }
    if (!(event.key in values)) return
    event.preventDefault(); change(trimTimelineSegment(segments, activeIndex, edge, values[event.key], duration, minimum))
  }
  const playSelected = async () => {
    if (!active || !audio.current || disabled) return
    setError(''); audio.current.currentTime = active.start; setCursor(active.start); playbackEnd.current = active.end
    try { await audio.current.play() } catch { setError(copy('播放失败，请使用下方播放控件重试。', 'Playback failed. Try the audio controls below.')) }
  }
  return <div className="laughter-timeline-editor">
    <p className="laughter-timeline-tip">{copy('① 拖两边裁剪　② 点波形定位　③ 切分后删除不要的片段', '① Drag edges to trim  ② Tap waveform to seek  ③ Split and delete unwanted clips')}</p>
    <div className="laughter-timeline-toolbar"><strong>{stamp(cursor)} / {stamp(duration)}</strong><button disabled={disabled || !history.length} onClick={() => { const previous = history.at(-1); if (previous) { if (audio.current && !audio.current.paused) audio.current.pause(); onChange(previous); setHistory(history.slice(0, -1)); setSelected(0); playbackEnd.current = null } }}><Undo2 size={16}/>{copy('撤销', 'Undo')}</button></div>
    <div className="laughter-timeline-track" ref={track} data-testid="laughter-timeline" onPointerDown={event => { if (!disabled) seek(position(event.clientX), true) }}>
      <svg viewBox="0 0 640 100" preserveAspectRatio="none" aria-hidden="true"><rect width="640" height="100" className="laughter-timeline-background"/>{segments.map((segment, index) => <rect key={index} x={segment.start / duration * 640} width={(segment.end - segment.start) / duration * 640} height="100" className={index === activeIndex ? 'laughter-timeline-active' : 'laughter-timeline-kept'}/>)}{peaks.map((peak, index) => <line key={index} x1={index * 4 + 2} x2={index * 4 + 2} y1={50 - Math.max(2, peak * 42)} y2={50 + Math.max(2, peak * 42)}/>)}{segments.slice(1).map((segment, index) => <line className="laughter-timeline-cut" key={`cut-${index}`} x1={segment.start / duration * 640} x2={segment.start / duration * 640} y1="0" y2="100"/>)}</svg>
      <span className="laughter-timeline-cursor" style={{ left: `${cursor / duration * 100}%` }} aria-hidden="true"/>
      {active && (['start', 'end'] as const).map(edge => <button type="button" key={edge} className={`laughter-trim-handle laughter-trim-${edge}`} role="slider" aria-label={copy(edge === 'start' ? '左边裁剪手柄' : '右边裁剪手柄', edge === 'start' ? 'Left trim handle' : 'Right trim handle')} aria-valuemin={edge === 'start' ? segments[activeIndex - 1]?.end || 0 : active.start + minimum} aria-valuemax={edge === 'start' ? active.end - minimum : segments[activeIndex + 1]?.start || duration} aria-valuenow={active[edge]} aria-valuetext={stamp(active[edge])} disabled={disabled} style={{ left: `${active[edge] / duration * 100}%` }} onPointerDown={event => beginDrag(event, edge)} onPointerMove={event => { if (dragging.current === edge && !disabled) { event.preventDefault(); moveEdge(edge, position(event.clientX)) } }} onPointerUp={event => { event.stopPropagation(); dragging.current = null; event.currentTarget.releasePointerCapture?.(event.pointerId) }} onPointerCancel={() => { dragging.current = null }} onLostPointerCapture={() => { dragging.current = null }} onKeyDown={event => keyEdge(event, edge)}><span aria-hidden="true">Ⅱ</span></button>)}
    </div>
    <label className="laughter-playhead">{copy('播放位置', 'Playhead')}<input type="range" min="0" max={duration} step="0.01" value={cursor} disabled={disabled} onChange={event => seek(Number(event.target.value), true)}/></label>
    <div className="laughter-timeline-ruler"><span>0:00</span>{active && <span>{copy('选中', 'Selected')}: {stamp(active.start)} → {stamp(active.end)}</span>}<span>{stamp(duration)}</span></div>
    <div className="laughter-actions"><button disabled={disabled || !active} onClick={() => void playSelected()}><Play size={16}/>{copy('试听选中片段', 'Play selected clip')}</button><button disabled={disabled || !active || cursor - active.start < minimum || active.end - cursor < minimum} onClick={() => change(splitTimelineSegment(segments, activeIndex, cursor, minimum))}><Scissors size={16}/>{copy('在这里切分', 'Split here')}</button><button disabled={disabled || !active} onClick={() => { change(removeTimelineSegment(segments, activeIndex)); setSelected(Math.max(0, activeIndex - 1)) }}><Trash2 size={16}/>{copy('删除选中片段', 'Delete selected clip')}</button><button disabled={disabled} onClick={() => { change([{ start: 0, end: duration }]); setSelected(0); seek(0) }}><RotateCcw size={16}/>{copy('恢复整段', 'Restore full recording')}</button></div>
    <div className="laughter-timeline-clips" aria-label={copy('选择剪辑片段', 'Select timeline clip')}>{segments.map((segment, index) => <button key={index} disabled={disabled} aria-pressed={index === activeIndex} onClick={() => { setSelected(index); seek(segment.start) }}><b>{copy(`片段 ${index + 1}`, `Clip ${index + 1}`)}</b><span>{stamp(segment.start)} – {stamp(segment.end)}</span></button>)}</div>
    {!segments.length && <p>{copy('已移除所有片段，点击“撤销”或“恢复整段”继续。', 'All clips removed. Undo or restore the full recording to continue.')}</p>}
    <audio ref={audio} controls preload="metadata" src={url || undefined} onTimeUpdate={() => { const player = audio.current; if (!player) return; if (playbackEnd.current !== null && player.currentTime >= playbackEnd.current) { player.pause(); player.currentTime = playbackEnd.current; playbackEnd.current = null }; setCursor(Math.min(duration, player.currentTime)) }} onSeeked={() => { if (audio.current) setCursor(Math.min(duration, audio.current.currentTime)) }}/>
    {error && <p role="alert" className="laughter-error">{error}</p>}
    <small>{copy('灰色区域不会保存。删除只影响这次剪辑，原录音一直保留。', 'Grey areas are excluded. Deleting a clip affects only this edit; the original is retained.')}</small>
  </div>
}
