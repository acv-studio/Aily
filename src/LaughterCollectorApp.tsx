import { useEffect, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import { Mic, Square, Scissors, Download, Trash2, Smile, Plus, Upload } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import type { Locale } from './i18n'
import { laughterDb, saveLaughter, MAX_LAUGHTER_BYTES, type LaughterRecording } from './laughterStorage'
import { decodeAudio, encodeWav, normalizeSegments, suggestSoundSegments, type AudioSegment } from './laughterAudio'
import './laughterCollector.css'
import LaughterTimelineEditor from './LaughterTimelineEditor'

const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
async function exportAudio(item: LaughterRecording) {
  const extension = item.blob.type.includes('wav') ? 'wav' : item.blob.type.includes('mp4') ? 'm4a' : item.blob.type.includes('ogg') ? 'ogg' : 'webm'
  const filename = `${item.person}-${item.name}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100) + `.${extension}`
  if (Capacitor.isNativePlatform()) {
    if (!(await Share.canShare()).value) throw new Error('Sharing unavailable')
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onerror = () => reject(reader.error)
      reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(item.blob)
    })
    const { uri } = await Filesystem.writeFile({ path: `${crypto.randomUUID()}-${filename}`, data, directory: Directory.Cache })
    await Share.share({ title: filename, files: [uri] })
  } else {
    const url = URL.createObjectURL(item.blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
function LocalAudio({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState('')
  useEffect(() => { const value = URL.createObjectURL(blob); setUrl(value); return () => URL.revokeObjectURL(value) }, [blob])
  return <audio controls preload="metadata" src={url || undefined} />
}
export default function LaughterCollectorApp({ locale }: { locale: Locale }) {
  const copy = (zh: string, en: string) => locale === 'en' ? en : zh
  const [items, setItems] = useState<LaughterRecording[]>([]), [loading, setLoading] = useState(true)
  const [person, setPerson] = useState(''), [search, setSearch] = useState(''), [name, setName] = useState('')
  const [recording, setRecording] = useState(false), [requesting, setRequesting] = useState(false), [seconds, setSeconds] = useState(0)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('')
  const [draft, setDraft] = useState<LaughterRecording | null>(null)
  const [editing, setEditing] = useState<LaughterRecording | null>(null), [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const [segments, setSegments] = useState<AudioSegment[]>([]), [start, setStart] = useState(0), [end, setEnd] = useState(0)
  const [preview, setPreview] = useState<Blob | null>(null)
  const mounted = useRef(false), recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null)
  const pending = useRef(false), started = useRef(0), filePicker = useRef<HTMLInputElement>(null)
  const failed = () => { if (mounted.current) setError(copy('操作失败：请检查存储空间、音频格式或设备权限后重试。原录音未更改。', 'Operation failed. Check storage, audio format or device permissions and retry. Original recordings are unchanged.')) }
  useEffect(() => {
    mounted.current = true
    const subscription = liveQuery(() => laughterDb.recordings.orderBy('createdAt').reverse().toArray()).subscribe({
      next: rows => { if (mounted.current) { setItems(rows); setLoading(false) } },
      error: () => { if (mounted.current) { setLoading(false); failed() } },
    })
    // Stop when hidden: this is a foreground recorder, not a background listening service.
    const hidden = () => { if (document.hidden && recorder.current?.state === 'recording') recorder.current.stop() }
    document.addEventListener('visibilitychange', hidden)
    return () => {
      mounted.current = false; subscription.unsubscribe(); document.removeEventListener('visibilitychange', hidden)
      if (recorder.current?.state === 'recording') recorder.current.stop()
      stream.current?.getTracks().forEach(track => track.stop())
    }
  }, [])
  useEffect(() => {
    if (!recording) return
    const timer = window.setInterval(() => { const elapsed = (Date.now() - started.current) / 1000; setSeconds(elapsed); if (elapsed >= 600 && recorder.current?.state === 'recording') recorder.current.stop() }, 250)
    return () => window.clearInterval(timer)
  }, [recording])
  const operate = async (work: () => Promise<void>) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(''); setStatus('')
    try { await work() } catch { failed() } finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  const begin = async () => {
    if (pending.current || recorder.current || !person.trim() || draft) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError(copy('当前环境不支持录音，请使用支持麦克风的浏览器和 HTTPS（或 localhost）。也可以导入录音。', 'Recording is unavailable. Use a microphone-capable browser over HTTPS (or localhost), or import audio.')); return }
    pending.current = true; setRequesting(true); setError(''); setStatus('')
    const who = person.trim(), title = name.trim() || copy('笑声原录音', 'Original laughter recording')
    let input: MediaStream | null = null
    try {
      input = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mounted.current) { input.getTracks().forEach(track => track.stop()); return }
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(value => MediaRecorder.isTypeSupported?.(value))
      const media = new MediaRecorder(input, mime ? { mimeType: mime } : undefined)
      recorder.current = media; stream.current = input
      const chunks: Blob[] = []; let bytes = 0
      media.ondataavailable = event => { if (event.data.size) { chunks.push(event.data); bytes += event.data.size; if (bytes >= MAX_LAUGHTER_BYTES && media.state === 'recording') media.stop() } }
      media.onerror = () => { failed(); if (media.state !== 'inactive') media.stop() }
      media.onstop = () => {
        input?.getTracks().forEach(track => track.stop()); stream.current = null; recorder.current = null
        const duration = Math.max(.01, (Date.now() - started.current) / 1000)
        if (mounted.current) { setRecording(false); setBusy(true) }
        const record: LaughterRecording = { id: crypto.randomUUID(), person: who, name: title, createdAt: new Date().toISOString(), duration, blob: new Blob(chunks, { type: media.mimeType || chunks[0]?.type || 'audio/webm' }) }
        if (!record.blob.size) { pending.current = false; if (mounted.current) { setBusy(false); failed() }; return }
        // Save the original even when the tool closes after a recording session.
        void saveLaughter(record).then(() => { if (mounted.current) setStatus(copy('原录音已保存到本机，可以开始剪辑。', 'Original saved on this device. You can now edit it.')) }).catch(() => { if (mounted.current) { setDraft(record); failed() } }).finally(() => { pending.current = false; if (mounted.current) setBusy(false) })
      }
      started.current = Date.now(); setSeconds(0); media.start(1000); setRecording(true)
    } catch {
      input?.getTracks().forEach(track => track.stop()); recorder.current = null; stream.current = null; pending.current = false
      if (mounted.current) setError(copy('无法启动麦克风。请在浏览器或系统设置中允许 Aily 使用麦克风，检查是否被其他应用占用。', 'Could not start the microphone. Allow microphone access in browser/system settings and check whether another app is using it.'))
    } finally { if (mounted.current) setRequesting(false) }
  }
  const edit = (item: LaughterRecording) => void operate(async () => {
    const decoded = await decodeAudio(item.blob)
    if (!mounted.current) return
    setEditing(item); setBuffer(decoded); setSegments([{ start: 0, end: decoded.duration }]); setStart(0); setEnd(decoded.duration); setPreview(null)
  })
  const updateSegments = (values: AudioSegment[]) => { setSegments(values); setPreview(null) }
  // Preserve touching clip boundaries for visual splitting; WAV encoding merges them only at export.
  const chosen = buffer ? segments : []
  const kept = chosen.reduce((total, segment) => total + segment.end - segment.start, 0)
  const disabled = busy || recording || requesting || !!draft
  const visible = items.filter(item => `${item.person} ${item.name}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  return <div className="laughter-app">
    <section className="laughter-hero"><Smile size={32}/><div><h3>{copy('把笑声，留在身边', 'Keep their laughter close')}</h3><p>{copy('一个人的笑声收藏 · 录下来，再只留下笑的瞬间', 'A personal laughter collection · Record, then keep the joyful moments')}</p></div></section>
    <p className="laughter-note">{copy('仅在你主动开始时录音，请先取得被录制者同意。只支持前台录制，每次最多 10 分钟；切到后台或关闭会停止并尝试保存原录音。音频仅保存在本机，不上传、不包含在聊天备份中；清除应用数据可能丢失，请及时导出。', 'Record only with the person’s consent. Foreground sessions last up to 10 minutes; hiding or closing stops recording and attempts to save the original. Audio stays on this device, is never uploaded and is not in chat backups. Clearing app data may erase it; export important recordings.')}</p>
    <section className="laughter-recorder">
      <div className="laughter-fields"><label>{copy('记录谁的笑声', 'Person')}<input maxLength={60} value={person} disabled={disabled} onChange={event => setPerson(event.target.value)} placeholder={copy('例如：妈妈、小林、自己', 'e.g. Mom, Alex, myself')}/></label><label>{copy('这次的名字（可选）', 'Recording title (optional)')}<input maxLength={100} value={name} disabled={disabled} onChange={event => setName(event.target.value)} placeholder={copy('例如：晚饭时的哈哈大笑', 'e.g. Laughs over dinner')}/></label></div>
      <div className="laughter-actions laughter-recording-actions">{recording ? <button className="laughter-record is-recording" onClick={() => recorder.current?.stop()}><Square size={18}/>{copy('停止并保存', 'Stop & save')} · {time(seconds)}</button> : <button className="laughter-record" disabled={disabled || !person.trim()} onClick={() => void begin()}><Mic size={18}/>{requesting ? copy('等待麦克风授权…', 'Waiting for permission…') : copy('开始录制', 'Start recording')}</button>}
        <button type="button" className="laughter-import" disabled={disabled || !person.trim()} onClick={() => filePicker.current?.click()}><Upload size={18}/>{copy('导入录音', 'Import audio')}</button></div>
        <input ref={filePicker} type="file" hidden style={{ display: 'none' }} aria-label={copy('选择录音文件', 'Choose audio file')} accept="audio/*,.m4a,.wav,.mp3,.webm,.ogg" disabled={disabled || !person.trim()} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
          const who = person.trim(), title = name.trim() || file.name
          void operate(async () => { if (!file.size || file.size > MAX_LAUGHTER_BYTES) throw new Error('File too large'); const decoded = await decodeAudio(file); await saveLaughter({ id: crypto.randomUUID(), person: who, name: title, createdAt: new Date().toISOString(), duration: decoded.duration, blob: file }); if (mounted.current) setStatus(copy('录音已导入本机。', 'Audio imported to this device.')) })
        }}/><small>{copy('先填写人物姓名。导入单个文件不超过 20MB，收藏库最多 200MB。', 'Enter a person first. Import files up to 20MB; library limit 200MB.')}</small>
    </section>
    {error && <p className="laughter-error" role="alert">{error}</p>}<p role="status">{busy ? copy('正在处理…', 'Working…') : status}</p>
    {draft && <section className="laughter-draft"><strong>{copy('这段录音尚未保存，请勿关闭', 'This recording is not saved. Keep this tool open.')}</strong><LocalAudio blob={draft.blob}/><div className="laughter-actions"><button disabled={busy} onClick={() => void operate(async () => { await saveLaughter(draft); setDraft(null); setStatus(copy('已保存。', 'Saved.')) })}>{copy('重试保存', 'Retry save')}</button><button disabled={busy} onClick={() => void operate(() => exportAudio(draft))}>{copy('先导出录音', 'Export recording')}</button><button disabled={busy} onClick={() => { if (window.confirm(copy('丢弃尚未保存的录音？此操作无法恢复。', 'Discard the unsaved recording? This cannot be undone.'))) setDraft(null) }}>{copy('丢弃', 'Discard')}</button></div></section>}
    {editing && buffer && <section className="laughter-editor" aria-label={copy('笑声剪辑', 'Laughter editor')}>
      <header><h3><Scissors size={20}/>{copy('只留下笑声', 'Keep only laughter')}</h3><button disabled={busy} onClick={() => { setEditing(null); setBuffer(null); setPreview(null) }}>{copy('关闭剪辑', 'Close editor')}</button></header><p>{editing.person} · {editing.name} · {time(buffer.duration)}</p>
      <LaughterTimelineEditor key={editing.id} buffer={buffer} blob={editing.blob} segments={chosen} onChange={updateSegments} disabled={disabled} copy={copy}/>
      <details className="laughter-fine-adjust"><summary>{copy('精细调整（可选）', 'Fine adjustment (optional)')}</summary>
      <p className="laughter-note">{copy('也可以输入秒数添加保留片段。若要重新选择，先清空选择。辅助去静音不是笑声识别，可能保留说话声，请试听确认。', 'You can also add keep ranges in seconds. Clear the selection to choose afresh. Silence trimming is not laughter recognition and may retain speech; review the result.')}</p>
      <div className="laughter-fields"><label>{copy('开始（秒）', 'Start (seconds)')}<input type="number" min="0" max={buffer.duration} step="0.1" value={start} disabled={busy} onChange={event => setStart(Number(event.target.value))}/></label><label>{copy('结束（秒）', 'End (seconds)')}<input type="number" min="0" max={buffer.duration} step="0.1" value={end} disabled={busy} onChange={event => setEnd(Number(event.target.value))}/></label></div>
      <div className="laughter-actions"><button disabled={busy || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > buffer.duration || end <= start} onClick={() => updateSegments(normalizeSegments([...segments, { start, end }], buffer.duration))}><Plus size={16}/>{copy('保留这段笑声', 'Keep this segment')}</button><button disabled={busy} onClick={() => updateSegments(suggestSoundSegments(buffer))}>{copy('辅助去静音', 'Trim silence')}</button><button disabled={busy || !segments.length} onClick={() => updateSegments([])}>{copy('清空选择', 'Clear selection')}</button></div>
      <ol className="laughter-segments">{chosen.map((segment, index) => <li key={index}><span>{segment.start.toFixed(2)}s → {segment.end.toFixed(2)}s</span><button disabled={busy} aria-label={copy(`移除片段 ${index + 1}`, `Remove segment ${index + 1}`)} onClick={() => updateSegments(chosen.filter((_, i) => i !== index))}><Trash2 size={16}/></button></li>)}</ol>
      </details>
      <p>{copy(`已选 ${chosen.length} 段 · 共 ${kept.toFixed(1)} 秒`, `${chosen.length} segments · ${kept.toFixed(1)} seconds`)}</p>
      <div className="laughter-actions"><button disabled={busy || !chosen.length} onClick={() => { try { setPreview(encodeWav(buffer, chosen)) } catch { failed() } }}>{copy('试听剪辑结果', 'Preview edit')}</button><button disabled={busy || !chosen.length} onClick={() => void operate(async () => {
        await saveLaughter({ id: crypto.randomUUID(), person: editing.person, name: `${editing.name} · ${copy('笑声剪辑', 'Laughter edit')}`, createdAt: new Date().toISOString(), duration: kept, sourceId: editing.id, blob: encodeWav(buffer, chosen) })
        if (mounted.current) setStatus(copy('笑声剪辑已另存，原录音保留。', 'Edit saved as a new recording. Original retained.'))
      })}>{copy('另存笑声剪辑', 'Save edit as new')}</button></div>{preview && <LocalAudio blob={preview}/>}<small>{copy('剪辑导出为 WAV，保留原录音。', 'Edits use WAV; originals are retained.')}</small>
    </section>}
    <section className="laughter-library"><header><h3>{copy('笑声收藏', 'Laughter collection')} · {items.length}</h3></header><label>{copy('按人物或名称搜索', 'Search person or title')}<input type="search" value={search} onChange={event => setSearch(event.target.value)}/></label>
      {loading ? <p>{copy('正在读取…', 'Loading…')}</p> : !visible.length && <p className="laughter-empty">{copy(items.length ? '没有匹配的录音。' : '还没有笑声。录下第一次开心的瞬间吧。', items.length ? 'No matching recordings.' : 'No laughter yet. Capture your first joyful moment.')}</p>}
      {visible.map(item => <article key={item.id}><div><strong>{item.person}</strong><h4>{item.name}</h4><small>{new Date(item.createdAt).toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN')} · {time(item.duration)} · {item.sourceId ? copy('笑声剪辑', 'Edited') : copy('原录音', 'Original')}</small></div><LocalAudio blob={item.blob}/><div className="laughter-actions"><button disabled={disabled} aria-label={copy(`剪辑 ${item.name}`, `Edit ${item.name}`)} onClick={() => edit(item)}><Scissors size={16}/>{copy('剪辑', 'Edit')}</button><button disabled={disabled} aria-label={copy(`导出 ${item.name}`, `Export ${item.name}`)} onClick={() => void operate(() => exportAudio(item))}><Download size={16}/>{copy('导出', 'Export')}</button><button disabled={disabled} aria-label={copy(`删除 ${item.name}`, `Delete ${item.name}`)} onClick={() => { if (window.confirm(copy(`永久删除「${item.name}」？未导出的音频将无法恢复。`, `Permanently delete “${item.name}”? Unexported audio cannot be recovered.`))) void operate(async () => { await laughterDb.recordings.delete(item.id); if (editing?.id === item.id) { setEditing(null); setBuffer(null); setPreview(null) } }) }}><Trash2 size={16}/>{copy('删除', 'Delete')}</button></div></article>)}
    </section>
  </div>
}
