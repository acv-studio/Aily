import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Search, Send, Square, Image as ImageIcon, Mic, Quote, X } from 'lucide-react'
import type { Character } from './data'
import type { ChatMessage, ConfirmedMemory } from './chatService'
import SpeechControls from './SpeechControls'

export type MemoryDraft = { text: string; category: NonNullable<ConfirmedMemory['category']>; sourceMessageId?: number }
export interface ChatPanelProps {
  character: Character
  messages: ChatMessage[]
  draft: string
  setDraft: (text: string) => void
  send: (options?: { retryId?: number; replyToId?: number; attachment?: ChatMessage['attachment']; kind?: ChatMessage['kind']; imageConsent?: boolean }) => Promise<void>
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
  const { character, messages, draft, setDraft, replying } = props
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [quote, setQuote] = useState<number>()
  const [memory, setMemory] = useState<MemoryDraft>()
  const [notice, setNotice] = useState('')
  const [recording, setRecording] = useState(false)
  const [imageConsent, setImageConsent] = useState(false)
  const fileRequest = useRef(0)
  const [attachment, setAttachment] = useState<{ kind: ChatMessage['kind']; data: NonNullable<ChatMessage['attachment']> }>()
  const bottom = useRef<HTMLDivElement>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const audioStream = useRef<MediaStream | null>(null)
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
    const request = ++fileRequest.current
    setImageConsent(false)
    try {
      const dataUrl = await readDataUrl(file)
      if (!mounted.current || request !== fileRequest.current) return
      setImageConsent(false)
      setAttachment({ kind: 'image', data: { dataUrl, mimeType: file.type, name: file.name } })
      setNotice('默认仅本机保存。识图需有效 Key 和支持图片输入的模型（可在设置中配置），本次授权不会上传历史图片。')
    } catch { if (mounted.current) setNotice('无法读取图片，请重新选择') }
  }
  const record = async () => {
    if (recorder.current?.state === 'recording') { recorder.current.stop(); return }
    if (acquiringAudio.current || !mounted.current) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setNotice('当前浏览器不支持录音，请使用 HTTPS 或本机地址'); return }
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
        if (blob.size > 3 * 1024 * 1024) { setNotice('录音超过 3MB，请缩短后重试'); return }
        try {
          const dataUrl = await readDataUrl(blob)
          if (!current()) return
          setAttachment({ kind: 'audio', data: { dataUrl, mimeType: blob.type, name: '语音消息' } })
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
    try { await props.send({ replyToId: quote, attachment: attachment?.data, kind: attachment?.kind, imageConsent: attachment?.kind === 'image' && imageConsent }); setQuote(undefined); setAttachment(undefined); setImageConsent(false) }
    catch { /* parent exposes durable send errors */ }
  }
  return <main className="chat-screen">
    <header className="chat-header glass">
      <button className="icon-button" aria-label="返回消息" disabled={replying} onClick={props.close}><ArrowLeft /></button>
      <span className="avatar" style={{ '--accent': character.accent } as React.CSSProperties}>{character.avatar}</span>
      <div><strong>{character.name}<small>AI 角色 · {props.demo ? '演示模式' : 'DeepSeek'}</small></strong><span>{replying ? '正在回复…' : props.temporary ? '临时会话 · 仅内存' : '聊天与记忆仅存本机'}</span></div>
      <button className="icon-button" aria-label="搜索消息" onClick={() => setSearchOpen(!searchOpen)}><Search /></button>
    </header>
    {props.toggleTemporary && <div className="chat-notice"><span>{props.temporary ? '临时会话：不落盘、不提取或引用记忆；退出模式后清除。请求仍发送到所配置的模型服务。' : `自动提议记忆需你确认${props.pendingCount ? ` · ${props.pendingCount} 条待确认，请到回忆页查看` : ''}`}</span><button disabled={replying} onClick={() => { setMemory(undefined); setQuote(undefined); setSearch(''); setAttachment(undefined); props.toggleTemporary?.() }}>{props.temporary ? '结束临时会话' : '临时会话'}</button></div>}
    {searchOpen && <div className="chat-search"><input aria-label="搜索聊天记录" placeholder="搜索当前角色的聊天记录" value={search} onChange={event => setSearch(event.target.value)} /><button onClick={() => { setSearch(''); setSearchOpen(false) }}>关闭</button></div>}
    <section className="messages" aria-label="聊天记录" aria-live="polite">
      {messages.length === 0 && <p className="chat-empty">从今天开始认识彼此。先说声你好吧。</p>}
      {search && <p className="chat-empty">找到 {visible.length} 条消息</p>}
      {visible.map(message => <div key={message.id} className={`message-row ${message.from === 'user' ? 'mine' : ''}`}>
        {message.from === 'character' && <span className="avatar" style={{ '--accent': character.accent } as React.CSSProperties}>{character.avatar}</span>}
        <div className="message-content">
          {message.replyToId && <blockquote>{messages.find(item => item.id === message.replyToId)?.withdrawn ? '引用的消息已撤回' : messages.find(item => item.id === message.replyToId)?.text || '引用消息不可用'}</blockquote>}
          <div className={`bubble ${message.status === 'sending' ? 'streaming' : ''}`}>
            {message.withdrawn ? <em>你撤回了一条消息</em> : <>
              {message.kind === 'image' && message.attachment && <img className="chat-image" src={message.attachment.dataUrl} alt={message.attachment.name} />}
              {message.kind === 'audio' && message.attachment && <audio controls src={message.attachment.dataUrl} aria-label="播放语音消息" />}
              {message.text || (message.status === 'sending' ? '正在回复…' : '')}
            </>}
          </div>
          <time>{message.createdAt ? new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : message.time}</time>
          {!message.withdrawn && message.status !== 'sending' && <div className="message-actions">
            <button aria-label={`引用消息 ${message.id}`} onClick={() => setQuote(message.id)}><Quote size={12} />引用</button>
            {message.text && !props.temporary && <button onClick={() => setMemory({ text: message.text, category: 'profile', sourceMessageId: message.id })}>记住这条</button>}
            {message.from === 'user' && <button onClick={() => props.withdraw(message.id)}>撤回</button>}
          </div>}
          {message.status === 'failed' && message.from === 'user' && <button className="retry" disabled={replying} onClick={() => { const consent = message.kind === 'image' && window.confirm('重试将把这张图片再次发送给设置中配置的模型服务，是否同意？'); if (message.kind !== 'image' || consent) void props.send({ retryId: message.id, imageConsent: consent }).catch(() => { /* Parent exposes retry errors. */ }) }}>回复未完成 · 重试</button>}
        </div>
      </div>)}<div ref={bottom} />
    </section>
    {props.error && <p className="chat-error" role="alert">{props.error}</p>}
    {notice && <div className="chat-notice">{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {quoted && <div className="quoted-preview">引用：{quoted.withdrawn ? '已撤回' : quoted.text}<button onClick={() => setQuote(undefined)}>取消</button></div>}
    {attachment && <div className="quoted-preview">待发送：{attachment.data.name}<button onClick={() => { fileRequest.current++; setAttachment(undefined); setImageConsent(false) }}>移除</button></div>}
    {attachment?.kind === 'image' && <label className="chat-notice"><input type="checkbox" checked={imageConsent} disabled={replying} onChange={event => setImageConsent(event.target.checked)} />同意将本次图片发送给已配置的模型服务进行识图</label>}
    <details className="advanced-chat"><summary>语音与通话</summary><SpeechControls draft={draft} setDraft={setDraft} messages={messages} replying={replying || recording} /><p>实时语音／视频通话尚未接入服务；听写加朗读不等于实时通话。</p></details>
    <div className="quick-replies"><button onClick={props.openStory}>⌁ 共同故事</button><button onClick={props.openGame}>✊ 猜拳</button></div>
    <footer className="composer glass">
      <label className="attachment-button" aria-label="分享图片"><ImageIcon size={18} /><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={replying} onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = '' }} /></label>
      <input aria-label="发消息" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() } }} placeholder="发消息…" disabled={replying} />
      <button aria-label={recording ? '结束录音' : '录制语音'} onClick={record} disabled={replying}>{recording ? <Square color="#ff7e8b" /> : <Mic />}</button>
      {replying ? <button className="send" aria-label="停止回复" onClick={props.stop}><Square /></button> : <button className="send" aria-label="发送消息" disabled={!draft.trim() && !attachment} onClick={submit}><Send /></button>}
    </footer>
    {memory && <div className="memory-modal-overlay"><form className="memory-modal glass" onSubmit={async event => { event.preventDefault(); try { await props.saveMemory(memory); setMemory(undefined); setNotice('已确认保存，可在回忆页编辑或删除') } catch { setNotice('记忆未保存，请重试') } }}>
      <h2>这件事，要记住吗？</h2><p>请确认内容和分类。未确认的内容不会作为长期记忆保存。</p>
      <textarea aria-label="记忆内容" value={memory.text} maxLength={1000} required onChange={event => setMemory({ ...memory, text: event.target.value })} />
      <label>记忆分类<select value={memory.category} onChange={event => setMemory({ ...memory, category: event.target.value as MemoryDraft['category'] })}><option value="profile">用户偏好</option><option value="relationship">共同经历</option><option value="context">近期情境</option><option value="emotion">情绪与支持偏好</option></select></label>
      <div className="memory-actions"><button type="submit">确认记住</button><button type="button" onClick={() => setMemory(undefined)}>暂不保存</button></div>
    </form></div>}
  </main>
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob) })
}
