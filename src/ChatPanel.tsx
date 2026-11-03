import { useI18n } from './i18n'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Search, Send, Square, Image as ImageIcon, Mic, Quote, X } from 'lucide-react'
import type { Character } from './data'
import type { ChatMessage, ConfirmedMemory } from './chatService'
import VoicePlayer from './VoicePlayer'

export type MemoryDraft = { text: string; category: NonNullable<ConfirmedMemory['category']>; sourceMessageId?: number }
export interface ChatPanelProps {
  character: Character
  messages: ChatMessage[]
  draft: string
  setDraft: (text: string) => void
  send: (options?: { retryId?: number; replyToId?: number; attachment?: ChatMessage['attachment']; kind?: ChatMessage['kind'] }) => Promise<void>
  saveMemory: (memory: MemoryDraft) => Promise<void>
  withdraw: (id: number) => Promise<void>
  close: () => void
  stop: () => void
  replying: boolean
  error: string
  temporary?: boolean
  toggleTemporary?: () => void
  pendingCount?: number
  demo: boolean
  openGame: () => void
  openStory: () => void
}

export default function ChatPanel(props: ChatPanelProps) {
  const { t, locale } = useI18n()
  const { character, messages, draft, setDraft, replying } = props
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [quote, setQuote] = useState<number>()
  const [memory, setMemory] = useState<MemoryDraft>()
  const [notice, setNotice] = useState('')
  const [recording, setRecording] = useState(false)
  const [attachment, setAttachment] = useState<{ kind: ChatMessage['kind']; data: NonNullable<ChatMessage['attachment']> }>()
  const bottom = useRef<HTMLDivElement>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const audioStream = useRef<MediaStream | null>(null)
  const playingAudio = useRef<HTMLAudioElement | null>(null)
  const playAudio = (audio: HTMLAudioElement) => {
    if (playingAudio.current !== audio) playingAudio.current?.pause()
    playingAudio.current = audio
  }
  const mounted = useRef(false)
  const recordingRequest = useRef(0)
  const acquiringAudio = useRef(false)
  const recordingTimer = useRef<number | undefined>(undefined)
  useEffect(() => { if (!search) bottom.current?.scrollIntoView({ block: 'end' }) }, [messages, search])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      recordingRequest.current++
      acquiringAudio.current = false
      window.clearTimeout(recordingTimer.current)
      recordingTimer.current = undefined
      try { if (recorder.current?.state === 'recording') recorder.current.stop() }
      finally { audioStream.current?.getTracks().forEach(track => track.stop()) }
      recorder.current = null
      audioStream.current = null
    }
  }, [])
  const visible = messages.filter(message => !(message.from === 'character' && message.status === 'failed' && !message.text) && (!search || (!message.withdrawn && message.text.includes(search))))
  const quoted = messages.find(message => message.id === quote)
  const chooseFile = async (file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 3 * 1024 * 1024) { setNotice('请选择 3MB 以内的 PNG、JPEG、WebP 或 GIF 图片'); return }
    const dataUrl = await readDataUrl(file)
    setAttachment({ kind: 'image', data: { dataUrl, mimeType: file.type, name: file.name } })
    setNotice('图片仅保存在本机，不发送给文字模型；可以另写文字描述。')
  }
  const record = async () => {
    if (recorder.current?.state === 'recording') { recorder.current.stop(); return }
    if (acquiringAudio.current || !mounted.current) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setNotice('当前浏览器不支持录音，请使用 HTTPS 或本机地址'); return }
    playingAudio.current?.pause()
    acquiringAudio.current = true
    const request = ++recordingRequest.current
    const current = () => mounted.current && request === recordingRequest.current
    let stream: MediaStream | undefined
    let media: MediaRecorder | undefined
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!current()) { stream.getTracks().forEach(track => track.stop()); return }
      audioStream.current = stream
      const acquiredStream = stream
      const chunks: BlobPart[] = []
      media = new MediaRecorder(stream)
      const activeRecorder = media
      recorder.current = media
      media.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      media.onstop = async () => {
        acquiredStream.getTracks().forEach(track => track.stop())
        if (!current()) return
        window.clearTimeout(recordingTimer.current)
        recordingTimer.current = undefined
        recorder.current = null
        audioStream.current = null
        setRecording(false)
        const blob = new Blob(chunks, { type: activeRecorder.mimeType.split(';')[0] })
        if (!blob.size) { setNotice('没有录到声音，请重新录制'); return }
        if (blob.size > 3 * 1024 * 1024) { setNotice('录音超过 3MB，请缩短后重试'); return }
        try {
          const dataUrl = await readDataUrl(blob)
          if (!current()) return
          setAttachment({ kind: 'audio', data: { dataUrl, mimeType: blob.type, name: t('语音消息') } })
          setNotice('语音仅支持本机录制与回放，尚不支持模型听写或语音通话。')
        } catch { if (current()) setNotice('无法读取录音，请重试') }
      }
      media.start(); setRecording(true)
      recordingTimer.current = window.setTimeout(() => { if (activeRecorder.state === 'recording') activeRecorder.stop() }, 60_000)
    } catch {
      // Acquisition can succeed while recorder construction/start fails.
      if (current()) {
        recordingRequest.current++
        acquiringAudio.current = false
        window.clearTimeout(recordingTimer.current)
        recordingTimer.current = undefined
        recorder.current = null
        audioStream.current = null
        setRecording(false)
        setNotice('无法开始录音，请检查麦克风权限后重试；仍可发送文字消息')
      }
      try { if (media?.state === 'recording') media.stop() }
      finally { stream?.getTracks().forEach(track => track.stop()) }
    } finally { if (current()) acquiringAudio.current = false }
  }
  const submit = async () => {
    if (replying || recording || (!draft.trim() && !attachment)) return
    try { await props.send({ replyToId: quote, attachment: attachment?.data, kind: attachment?.kind }); setQuote(undefined); setAttachment(undefined) }
    catch { /* parent exposes durable send errors */ }
  }
  return <main className="chat-screen">
    <header className="chat-header glass">
      <button className="icon-button" aria-label={t('返回消息')} disabled={replying} onClick={props.close}><ArrowLeft /></button>
      <span className="avatar" style={{ '--accent': character.accent } as React.CSSProperties}>{t(character.avatar)}</span>
      <div><strong>{t(character.name)}<small>{t('AI 角色')} · {props.demo ? t('演示模式') : 'DeepSeek'}</small></strong><span>{replying ? t('正在回复…') : props.temporary ? t('临时会话 · 仅内存') : t('聊天与记忆仅存本机')}</span></div>
      <button className="icon-button" aria-label={t('搜索消息')} onClick={() => setSearchOpen(!searchOpen)}><Search /></button>
    </header>
    {props.toggleTemporary && <div className="chat-notice"><span>{props.temporary ? t('临时会话：不落盘、不提取或引用记忆；退出模式后清除。请求仍发送到所配置的模型服务。') : `${t('自动提议记忆需你确认')}${props.pendingCount ? t(' · {count} 条待确认，请到回忆页查看', { count: props.pendingCount }) : ''}`}</span><button disabled={replying} onClick={() => { setMemory(undefined); setQuote(undefined); setSearch(''); setAttachment(undefined); props.toggleTemporary?.() }}>{props.temporary ? t('结束临时会话') : t('临时会话')}</button></div>}
    {searchOpen && <div className="chat-search"><input aria-label={t('搜索聊天记录')} placeholder={t('搜索当前角色的聊天记录')} value={search} onChange={event => setSearch(event.target.value)} /><button onClick={() => { setSearch(''); setSearchOpen(false) }}>{t('关闭')}</button></div>}
    <section className="messages" aria-label={t('聊天记录')} aria-live="polite">
      {messages.length === 0 && <p className="chat-empty">{t('从今天开始认识彼此。先说声你好吧。')}</p>}
      {search && <p className="chat-empty">{t('找到 {count} 条消息', { count: visible.length })}</p>}
      {visible.map(message => <div key={message.id} className={`message-row ${message.from === 'user' ? 'mine' : ''}`}>
        {message.from === 'character' && <span className="avatar" style={{ '--accent': character.accent } as React.CSSProperties}>{t(character.avatar)}</span>}
        <div className="message-content">
          {message.replyToId && <blockquote>{messages.find(item => item.id === message.replyToId)?.withdrawn ? t('引用的消息已撤回') : messages.find(item => item.id === message.replyToId)?.text || t('引用消息不可用')}</blockquote>}
          <div className={`bubble ${message.status === 'sending' ? 'streaming' : ''}`}>
            {message.withdrawn ? <em>{t('你撤回了一条消息')}</em> : <>
              {message.kind === 'image' && message.attachment && <img className="chat-image" src={message.attachment.dataUrl} alt={message.attachment.name} />}
              {message.kind === 'audio' && (message.attachment ? <VoicePlayer src={message.attachment.dataUrl} onPlay={playAudio} /> : <em>{t('语音附件不可用')}</em>)}
              {message.text || (message.status === 'sending' ? t('正在回复…') : '')}
            </>}
          </div>
          <time>{message.createdAt ? new Date(message.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : message.time}</time>
          {!message.withdrawn && message.status !== 'sending' && <div className="message-actions">
            <button aria-label={t('引用消息 {id}', { id: message.id })} onClick={() => setQuote(message.id)}><Quote size={12} />{t('引用')}</button>
            {message.text && !props.temporary && <button onClick={() => setMemory({ text: message.text, category: 'profile', sourceMessageId: message.id })}>{t('记住这条')}</button>}
            {message.from === 'user' && <button onClick={() => props.withdraw(message.id)}>{t('撤回')}</button>}
          </div>}
          {message.status === 'failed' && message.from === 'user' && <button className="retry" onClick={() => props.send({ retryId: message.id })}>{t('回复未完成 · 重试')}</button>}
        </div>
      </div>)}<div ref={bottom} />
    </section>
    {props.error && <p className="chat-error" role="alert">{t(props.error)}</p>}
    {notice && <div className="chat-notice">{t(notice)}<button aria-label={t('关闭提示')} onClick={() => setNotice('')}><X size={14} /></button></div>}
    {quoted && <div className="quoted-preview">{t('引用：')}{quoted.withdrawn ? t('已撤回') : quoted.text}<button onClick={() => setQuote(undefined)}>{t('取消')}</button></div>}
    {attachment && <div className={`quoted-preview ${attachment.kind === 'audio' ? 'voice-preview' : ''}`}>
      <div>{t('待发送：')}{attachment.data.name}{attachment.kind === 'audio' && <VoicePlayer src={attachment.data.dataUrl} preview onPlay={playAudio} />}</div>
      <button onClick={() => setAttachment(undefined)}>{t('移除')}</button>
    </div>}
    <div className="quick-replies"><button onClick={props.openStory}>{t('⌁ 共同故事')}</button><button onClick={props.openGame}>{t('✊ 猜拳')}</button></div>
    <footer className="composer glass">
      <label className="attachment-button" aria-label={t('分享图片')}><ImageIcon size={18} /><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={replying} onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = '' }} /></label>
      <input aria-label={t('发消息')} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() } }} placeholder={t('发消息…')} disabled={replying} />
      <button aria-label={recording ? t('结束录音') : t('录制语音')} onClick={record} disabled={replying}>{recording ? <Square color="#ff7e8b" /> : <Mic />}</button>
      {replying ? <button className="send" aria-label={t('停止回复')} onClick={props.stop}><Square /></button> : <button className="send" aria-label={t('发送消息')} disabled={!draft.trim() && !attachment} onClick={submit}><Send /></button>}
    </footer>
    {memory && <div className="memory-modal-overlay"><form className="memory-modal glass" onSubmit={async event => { event.preventDefault(); try { await props.saveMemory(memory); setMemory(undefined); setNotice('已确认保存，可在回忆页编辑或删除') } catch { setNotice('记忆未保存，请重试') } }}>
      <h2>{t('这件事，要记住吗？')}</h2><p>{t('请确认内容和分类。未确认的内容不会作为长期记忆保存。')}</p>
      <textarea aria-label={t('记忆内容')} value={memory.text} maxLength={1000} required onChange={event => setMemory({ ...memory, text: event.target.value })} />
      <label>{t('记忆分类')}<select value={memory.category} onChange={event => setMemory({ ...memory, category: event.target.value as MemoryDraft['category'] })}><option value="profile">{t('用户偏好')}</option><option value="relationship">{t('共同经历')}</option><option value="context">{t('近期情境')}</option><option value="emotion">{t('情绪与支持偏好')}</option></select></label>
      <div className="memory-actions"><button type="submit">{t('确认记住')}</button><button type="button" onClick={() => setMemory(undefined)}>{t('暂不保存')}</button></div>
    </form></div>}
  </main>
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob) })
}
