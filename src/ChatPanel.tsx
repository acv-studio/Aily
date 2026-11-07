import { useI18n } from './i18n'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Search, Send, Square, Image as ImageIcon, Mic, Quote, Copy, X, ChevronDown, Plus, Video, Phone, Smile, Ellipsis, Star, Sparkles, Check, CalendarHeart, Gift, Settings2 } from 'lucide-react'
import GiftStorePanel from './GiftStorePanel'
import AppDataPanel from './AppDataPanel'
import type { AppDataIdentity, AppDataTicket } from './appDataTypes'
import PeriodRecordPanel from './PeriodRecordPanel'
import './chatExtras.css'
import type { Character } from './data'
import { MAX_LOCAL_VIDEO_BYTES, LOCAL_VIDEO_MIME_TYPES, type ChatMessage, type ConfirmedMemory } from './chatService'
import VoicePlayer from './VoicePlayer'
import VideoPlayer from './VideoPlayer'
import { REPLY_MODES, REPLY_MODE_LABELS, type ReplyMode } from './replyModes'
import type { CreditGiftId } from './creditGifts'
import { displaySummary, type ConversationSummary } from './longMemory'
import './replyModes.css'
import useMessageLongPress from './useMessageLongPress'
import { copyMessageText } from './messageClipboard'
import './messageActions.css'

export type MemoryDraft = { text: string; category: NonNullable<ConfirmedMemory['category']>; sourceMessageId?: number }
export interface ChatPanelProps {
  character: Character
  messages: ChatMessage[]
  summaries?: ConversationSummary[]
  draft: string
  setDraft: (text: string) => void
  send: (options?: { retryId?: number; replyToId?: number; attachment?: ChatMessage['attachment']; kind?: ChatMessage['kind']; text?: string; localActionNote?: string; giftId?: CreditGiftId; appDataTicket?: AppDataTicket; rejectOnFailure?: boolean }) => Promise<void>
  saveMemory: (memory: MemoryDraft) => Promise<void>
  withdraw: (id: number) => Promise<void>
  close: () => void
  stop: () => void
  replying: boolean
  error: string
  replyMode?: ReplyMode
  setReplyMode?: (mode: ReplyMode) => Promise<void>
  modeSaving?: boolean
  temporary?: boolean
  toggleTemporary?: () => void
  pendingCount?: number
  demo: boolean
  openGame: () => void
  openStory: () => void
  openMoments?: () => void
  openCall?: () => void
  openPreferences?: () => void
  openBilling?: () => void
  recordActivity?: (text: string, localOnly?: boolean) => Promise<void>
  recordActivityFor?: (characterId: Character['id'], text: string, localOnly?: boolean) => Promise<void>
  relationshipStage?: string
  isPrimary?: boolean
  setPrimary?: () => Promise<void>
  appDataIdentity?: () => AppDataIdentity
}

export default function ChatPanel(props: ChatPanelProps) {
  const { t, locale } = useI18n()
  const { character, messages, draft, setDraft, replying } = props
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [modeOpen, setModeOpen] = useState(false)
  const modeMenu = useRef<HTMLElement>(null)
  const modeTrigger = useRef<HTMLButtonElement>(null)
  const closeMode = () => { setModeOpen(false); modeTrigger.current?.focus({ preventScroll: true }) }
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [primarySaving, setPrimarySaving] = useState(false)
  const settingsMenu = useRef<HTMLDivElement>(null)
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!settingsOpen) return
    settingsMenu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSettingsOpen(false); settingsTrigger.current?.focus() }
    }
    document.addEventListener('keydown', dismiss)
    const outside = (event: PointerEvent) => {
      if (!settingsMenu.current?.contains(event.target as Node)) setSettingsOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', dismiss) }
  }, [settingsOpen])
  const screen = useRef<HTMLElement>(null)
  const composerInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const videoInput = useRef<HTMLInputElement>(null)
  const moreButton = useRef<HTMLButtonElement>(null)
  const fileRequest = useRef(0)
  const [extraPanel, setExtraPanel] = useState<'period' | 'gift' | 'apps' | null>(null)
  const extraDialog = useRef<HTMLDivElement>(null)
  const extraTrigger = useRef<HTMLElement | null>(null)
  const openExtra = (panel: 'period' | 'gift' | 'apps', trigger: HTMLElement) => {
    extraTrigger.current = trigger
    setSettingsOpen(false); setModeOpen(false); setExtraPanel(panel)
  }
  useEffect(() => {
    if (!extraPanel) return
    const dialog = extraDialog.current
    const background = Array.from(screen.current?.children || []).filter(element => !element.classList.contains('chat-extra-overlay'))
    background.forEach(element => element.setAttribute('inert', ''))
    dialog?.querySelector<HTMLButtonElement>('button')?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setExtraPanel(null) }
      if (event.key === 'Tab') {
        const controls = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || [])
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('keydown', keyboard)
      background.forEach(element => element.removeAttribute('inert'))
      if (extraTrigger.current?.isConnected) extraTrigger.current.focus()
      else moreButton.current?.focus()
    }
  }, [extraPanel])
  useEffect(() => { setExtraPanel(null) }, [character.id])
  const [moreOpen, setMoreOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [readingFile, setReadingFile] = useState(false)
  const closeMore = () => { setMoreOpen(false); setEmojiOpen(false) }
  useEffect(() => {
    fileRequest.current++
    setReadingFile(false); setAttachment(undefined); closeMore()
    return () => { fileRequest.current++ }
  }, [character.id, props.temporary])
  useEffect(() => {
    if (!moreOpen) return
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !extraPanel) { closeMore(); moreButton.current?.focus() }
    }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('.composer, .chat-more-panel, .chat-extra-overlay')) closeMore()
    }
    document.addEventListener('keydown', dismiss)
    document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('keydown', dismiss); document.removeEventListener('pointerdown', outside) }
  }, [moreOpen, extraPanel])
  // The visual viewport follows the soft keyboard, unlike 100vh in many WebViews.
  useEffect(() => {
    const viewport = window.visualViewport
    const resize = () => {
      screen.current?.style.setProperty('--chat-view-height', `${viewport?.height ?? window.innerHeight}px`)
      screen.current?.style.setProperty('--chat-view-top', `${viewport?.offsetTop ?? 0}px`)
      if (screen.current) screen.current.dataset.keyboardOpen = String(!!viewport && window.innerHeight - viewport.height - viewport.offsetTop > 120)
    }
    resize()
    viewport?.addEventListener('resize', resize)
    viewport?.addEventListener('scroll', resize)
    window.addEventListener('resize', resize)
    return () => {
      viewport?.removeEventListener('resize', resize)
      viewport?.removeEventListener('scroll', resize)
      window.removeEventListener('resize', resize)
    }
  }, [])
  useEffect(() => {
    if (!modeOpen) return
    modeMenu.current?.querySelector<HTMLButtonElement>('.reply-mode-options button[aria-pressed="true"]:not(:disabled)')?.focus({ preventScroll: true })
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeMode() }
    }
    const outside = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && !modeMenu.current?.contains(target) && !modeTrigger.current?.contains(target)) setModeOpen(false)
    }
    document.addEventListener('keydown', dismiss)
    document.addEventListener('pointerdown', outside, true)
    return () => { document.removeEventListener('keydown', dismiss); document.removeEventListener('pointerdown', outside, true) }
  }, [modeOpen])
  const [quote, setQuote] = useState<number>()
  const [activeActions, setActiveActions] = useState<number>()
  const [memory, setMemory] = useState<MemoryDraft>()
  const [notice, setNotice] = useState('')
  const [copying, setCopying] = useState(false)
  const copyBusy = useRef(false)
  const copyEpoch = useRef(0)
  const messageSource = useRef(messages); messageSource.current = messages
  const longPress = useMessageLongPress(messages, `${character.id}:${!!props.temporary}`, setActiveActions)
  useEffect(() => { setActiveActions(undefined); copyEpoch.current++ }, [character.id, props.temporary])
  useEffect(() => {
    if (activeActions === undefined) return
    const active = messages.find(message => message.id === activeActions)
    if (!active || active.withdrawn || active.status === 'sending') { setActiveActions(undefined); return }
    const outside = (event: PointerEvent) => {
      const row = screen.current?.querySelector(`[data-message-id="${activeActions}"]`)
      if (event.target instanceof Node && !row?.contains(event.target)) setActiveActions(undefined)
    }
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const row = screen.current?.querySelector(`[data-message-id="${activeActions}"]`)
      if (row?.contains(document.activeElement)) row.querySelector<HTMLElement>('.bubble')?.focus({ preventScroll: true })
      setActiveActions(undefined)
    }
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', dismiss)
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', dismiss) }
  }, [activeActions, messages])
  const [recording, setRecording] = useState(false)
  const [attachment, setAttachment] = useState<{ kind: ChatMessage['kind']; data: NonNullable<ChatMessage['attachment']> }>()
  const bottom = useRef<HTMLDivElement>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const audioStream = useRef<MediaStream | null>(null)
  const playingAudio = useRef<HTMLMediaElement | null>(null)
  useEffect(() => {
    // A private-chat action in another companion's feed must not carry an old
    // quote or attachment into the new conversation. Returning to the same role
    // leaves the draft and attachments intact.
    setQuote(undefined); setMemory(undefined); setAttachment(undefined)
    setSettingsOpen(false); setSearch(''); setSearchOpen(false); setModeOpen(false); setNotice('')
    playingAudio.current?.pause(); playingAudio.current = null
  }, [character.id])
  const playAudio = (audio: HTMLMediaElement) => {
    if (playingAudio.current !== audio) playingAudio.current?.pause()
    playingAudio.current = audio
  }
  const mounted = useRef(false)
  const copyMessage = async (id: number) => {
    const source = messageSource.current.find(message => message.id === id && !message.withdrawn && message.status !== 'sending')
    if (!source?.text || copyBusy.current) return
    const epoch = copyEpoch.current
    copyBusy.current = true; setCopying(true)
    try {
      await copyMessageText(source.text)
      const stillAvailable = messageSource.current.some(message => message.id === id && !message.withdrawn && message.status !== 'sending')
      if (mounted.current && epoch === copyEpoch.current && stillAvailable) {
        setActiveActions(undefined)
        setNotice(locale === 'en' ? 'Message copied.' : '消息已复制。')
      }
    } catch {
      if (mounted.current && epoch === copyEpoch.current) setNotice(locale === 'en' ? 'Could not copy. Please retry.' : '复制失败，请重试。')
    } finally { copyBusy.current = false; if (mounted.current) setCopying(false) }
  }
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
  const query = search.trim().toLocaleLowerCase()
  const visible = messages.filter(message => !(message.from === 'character' && message.status === 'failed' && !message.text) && (!query || (!message.withdrawn && message.text.toLocaleLowerCase().includes(query))))
  const quoted = messages.find(message => message.id === quote && !message.withdrawn && message.status !== 'sending')
  useEffect(() => { if (quote !== undefined && !quoted) setQuote(undefined) }, [quote, quoted])
  const toggleSearch = () => { if (searchOpen) setSearch(''); setSearchOpen(!searchOpen) }
  const quoteText = (message?: ChatMessage) => !message ? t('引用消息不可用') : message.withdrawn ? t('引用的消息已撤回') : message.text || (message.kind === 'image' ? t('[图片]') : message.kind === 'audio' ? t('[语音]') : message.kind === 'video' ? t('[视频]') : t('引用消息不可用'))
  const chooseFile = async (kind: 'image' | 'video', file?: File) => {
    if (!file || replying || recording) return
    const request = ++fileRequest.current
    const types: readonly string[] = kind === 'image' ? ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] : LOCAL_VIDEO_MIME_TYPES
    const limit = kind === 'image' ? 3 * 1024 * 1024 : MAX_LOCAL_VIDEO_BYTES
    if (!file.size || !types.includes(file.type) || file.size > limit) {
      setNotice(kind === 'image' ? '请选择 3MB 以内的 PNG、JPEG、WebP 或 GIF 图片' : '请选择 20MB 以内的 MP4、WebM 或 MOV 视频')
      return
    }
    setReadingFile(true)
    try {
      const dataUrl = await readDataUrl(file)
      if (request !== fileRequest.current) return
      setAttachment({ kind, data: { dataUrl, mimeType: file.type, name: file.name } })
      closeMore()
      setNotice(props.temporary ? '附件仅保留在临时会话内，退出后清除。' : kind === 'image' ? '图片仅保存在本机，不发送给文字模型；可以另写文字描述。' : '视频仅保存在本机，不发送给文字模型；播放取决于浏览器格式支持。')
    } catch { if (request === fileRequest.current) setNotice('无法读取附件，请重新选择') }
    finally { if (request === fileRequest.current) setReadingFile(false) }
  }
  const insertEmoji = (emoji: string) => {
    const input = composerInput.current
    const start = input?.selectionStart ?? draft.length
    const end = input?.selectionEnd ?? start
    setDraft(draft.slice(0, start) + emoji + draft.slice(end))
    closeMore()
    input?.focus()
    requestAnimationFrame(() => input?.setSelectionRange(start + emoji.length, start + emoji.length))
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
    if (replying || recording || readingFile || (!draft.trim() && !attachment)) return
    try { await props.send({ replyToId: quoted?.id, attachment: attachment?.data, kind: attachment?.kind }); setQuote(undefined); setAttachment(undefined); closeMore() }
    catch { /* parent exposes durable send errors */ }
  }
  return <main ref={screen} className="chat-screen" style={{ '--accent': character.accent } as React.CSSProperties}>
    <header className="chat-header glass">
      <button className="icon-button" aria-label={t('返回消息')} onClick={props.close}><ArrowLeft /></button>
      <span className="avatar" style={{ '--accent': character.accent } as React.CSSProperties}>{t(character.avatar)}</span>
      <div className="chat-identity"><strong>{t(character.name)}</strong></div>
      <div ref={settingsMenu} className="chat-settings">
        <button ref={settingsTrigger} className="icon-button" aria-label={t('聊天设置')} aria-expanded={settingsOpen} aria-controls="chat-settings-options" onClick={() => { setSettingsOpen(!settingsOpen); setModeOpen(false); closeMore() }}><Ellipsis /></button>
        {settingsOpen && <section id="chat-settings-options" className="chat-settings-options" aria-label={t('聊天设置')}>
          <div className="chat-primary-status"><Star size={15} /><span>{props.isPrimary ? t('当前是主 Bot') : t('当前不是主 Bot')}</span></div>
          {props.setPrimary && <button disabled={props.isPrimary || replying || primarySaving} onClick={async () => {
            if (primarySaving || props.isPrimary || replying) return
            setPrimarySaving(true)
            try { await props.setPrimary?.(); setNotice('已设为主 Bot') }
            catch { setNotice('主 Bot 设置未保存，请稍后重试。') }
            finally { setPrimarySaving(false) }
          }}>{props.isPrimary ? <Check size={17} /> : <Star size={17} />}<span>{primarySaving ? t('正在保存…') : props.isPrimary ? t('已设为主 Bot') : t('设为主 Bot')}</span></button>}
          {props.appDataIdentity && <button disabled={!props.isPrimary || props.temporary || replying || recording || readingFile} onClick={event => openExtra('apps', event.currentTarget)}><Sparkles size={17} /><span>{locale === 'en' ? 'Read app data' : '读取应用数据'}</span></button>}
          {props.openMoments && <button disabled={replying || primarySaving || recording || readingFile} onClick={() => { setSettingsOpen(false); props.openMoments?.() }}><Sparkles size={17} /><span>{t('查看朋友圈')}</span></button>}
          {props.openPreferences && <button disabled={replying || recording || readingFile} onClick={() => { setSettingsOpen(false); props.openPreferences?.() }}><Settings2 size={17} /><span>{t('修改称呼与互动偏好')}</span></button>}
          <button disabled={replying || recording || readingFile} onClick={() => { setSettingsOpen(false); setHistoryOpen(true) }}><CalendarHeart size={17} /><span>{t('对话历史')}</span></button>
          <button onClick={() => { toggleSearch(); setSettingsOpen(false); settingsTrigger.current?.focus() }}><Search size={17} /><span>{t('搜索消息')}</span></button>
        </section>}
      </div>
    </header>
    {searchOpen && <div className="chat-search"><input aria-label={t('搜索聊天记录')} placeholder={t('搜索当前角色的聊天记录')} value={search} onChange={event => setSearch(event.target.value)} /><button onClick={() => { setSearch(''); setSearchOpen(false) }}>{t('关闭')}</button></div>}
    <section className="messages" aria-label={t('聊天记录')} aria-live="polite">
      {messages.length === 0 && !query && <div className="chat-intro">
        <span className="avatar" style={{ '--accent': character.accent } as React.CSSProperties}>{t(character.avatar)}</span>
        <h1>{t(character.name)}</h1><p className="chat-intro-detail">{t(character.intro)}</p>
        <div className="chat-opening"><small>{t('角色开场白')}</small><p>{t(character.quote)}</p></div>
        <p className="chat-starter-hint">{t('不急，选一句开始，或说说你想聊的。')}</p>
        <div className="chat-starters">{['你好，很高兴认识你。', '今天有点累，想和你聊聊。', '想听你介绍一下自己。'].map(text => <button key={text} disabled={replying} onClick={() => { setDraft(t(text)); composerInput.current?.focus() }}>{t(text)}</button>)}</div>
      </div>}
      {query && <p className="chat-empty">{t('找到 {count} 条消息', { count: visible.length })}</p>}
      {visible.map(message => <div key={message.id} data-message-id={message.id} className={`message-row ${message.from === 'user' ? 'mine' : ''}`}>
        {message.from === 'character' && <span className="avatar" style={{ '--accent': character.accent } as React.CSSProperties}>{t(character.avatar)}</span>}
        <div className="message-content">
          {!message.withdrawn && message.replyToId !== undefined && <blockquote>{quoteText(messages.find(item => item.id === message.replyToId))}</blockquote>}
          <div className={`bubble ${message.status === 'sending' ? 'streaming' : ''} ${message.attachment && message.kind !== 'text' ? 'attachment-bubble' : ''} ${activeActions === message.id ? 'actions-open' : ''}`} tabIndex={!message.withdrawn && message.status !== 'sending' ? 0 : undefined} role={!message.withdrawn && message.status !== 'sending' ? 'button' : undefined} aria-expanded={!message.withdrawn && message.status !== 'sending' ? activeActions === message.id : undefined} aria-label={!message.withdrawn && message.status !== 'sending' ? t('消息操作') : undefined} aria-description={locale === 'en' ? 'Hold to open message actions. Enter or Space also opens actions.' : '长按打开消息操作，也可按 Enter 或空格。'} onPointerDown={event => longPress.pointerDown(message.id, event)} onPointerMove={longPress.pointerMove} onPointerUp={longPress.cancel} onPointerCancel={longPress.cancel} onPointerLeave={longPress.cancel} onContextMenu={event => longPress.contextMenu(message.id, event)} onClick={event => { if (event.nativeEvent.isTrusted && event.detail === 0 && !message.withdrawn && message.status !== 'sending' && !(event.target instanceof Element && event.target.closest('button,input,audio,video,a'))) setActiveActions(message.id) }} onKeyDown={event => longPress.keyDown(message.id, event)}>
            {message.withdrawn ? <em>{t('你撤回了一条消息')}</em> : <>
              {message.kind === 'image' && message.attachment && <img className="chat-image" src={message.attachment.dataUrl} alt={message.attachment.name} />}
              {message.kind === 'video' && (message.attachment ? <VideoPlayer src={message.attachment.dataUrl} onPlay={playAudio} /> : <em>{t('视频附件不可用')}</em>)}
              {message.kind === 'audio' && (message.attachment ? <VoicePlayer src={message.attachment.dataUrl} onPlay={playAudio} /> : <em>{t('语音附件不可用')}</em>)}
              {renderMessageText(message.text) || (message.status === 'sending' ? t('正在回复…') : '')}
            </>}
          </div>
          {message.appDataReply && <span className="app-data-answer-note">{locale === 'en' ? 'App-based answer · saved locally, excluded from future AI context' : '应用数据回答 · 本机保留，不进入后续 AI 上下文'}</span>}
          <time>{message.createdAt ? new Date(message.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : message.time}</time>
          {!message.withdrawn && message.status !== 'sending' && activeActions === message.id && <div className="message-actions" role="group" aria-label={locale === 'en' ? 'Message actions' : '消息操作菜单'}>
            {!!message.text && <button type="button" disabled={copying} aria-label={locale === 'en' ? `Copy message ${message.id}` : `复制消息 ${message.id}`} onClick={() => void copyMessage(message.id)}><Copy size={12} />{copying ? (locale === 'en' ? 'Copying…' : '复制中…') : (locale === 'en' ? 'Copy' : '复制')}</button>}
            <button aria-label={t('引用消息 {id}', { id: message.id })} onClick={() => { setQuote(message.id); setActiveActions(undefined); composerInput.current?.focus() }}><Quote size={12} />{t('引用')}</button>
            {message.text && !message.localOnly && !props.temporary && <button onClick={() => { setMemory({ text: message.text, category: 'profile', sourceMessageId: message.id }); setActiveActions(undefined) }}>{t('记住这条')}</button>}
            {message.from === 'user' && <button disabled={replying} onClick={() => { setActiveActions(undefined); void props.withdraw(message.id) }}>{t('撤回')}</button>}
          </div>}
          {!message.withdrawn && message.status === 'failed' && message.from === 'user' && <button disabled={replying} className="retry" onClick={event => { if (message.appDataRequest && props.appDataIdentity) { setDraft(message.text); openExtra('apps', event.currentTarget) } else void props.send({ retryId: message.id }) }}>{message.appDataRequest ? (locale === 'en' ? 'App data needs a fresh preview' : '应用数据需重新预览授权') : t('回复未完成 · 重试')}</button>}
        </div>
      </div>)}<div ref={bottom} />
    </section>
    {props.error && <p className="chat-error" role="alert">{t(props.error)}</p>}
    {notice && <div className="chat-notice">{t(notice)}<button aria-label={t('关闭提示')} onClick={() => setNotice('')}><X size={14} /></button></div>}
    {quoted && <div className="quoted-preview">{t('引用：')}{quoteText(quoted)}<button onClick={() => setQuote(undefined)}>{t('取消')}</button></div>}
    {attachment && <div className={`quoted-preview ${attachment.kind === 'audio' ? 'voice-preview' : ''}`}>
      <div>{t('待发送：')}<span>{attachment.data.name}</span>{attachment.kind === 'image' && <img className="chat-image attachment-preview-image" src={attachment.data.dataUrl} alt={attachment.data.name} />}{attachment.kind === 'video' && <VideoPlayer src={attachment.data.dataUrl} preview onPlay={playAudio} />}{attachment.kind === 'audio' && <VoicePlayer src={attachment.data.dataUrl} preview onPlay={playAudio} />}</div>
      <button onClick={() => setAttachment(undefined)}>{t('移除')}</button>
    </div>}
    <div className="chat-controls">
    <div className="quick-replies">{props.setReplyMode && <div className="inline-mode"><button ref={modeTrigger} className="chat-mode-trigger" aria-label={t('回复模式：{mode}', { mode: t(REPLY_MODE_LABELS[props.replyMode || 'brief']) })} aria-expanded={modeOpen} aria-controls="chat-reply-modes" onClick={() => { const open = !modeOpen; setModeOpen(open); if (open) { closeMore(); setSettingsOpen(false); setActiveActions(undefined); composerInput.current?.blur() } }}><Settings2 size={15} aria-hidden="true" /><span>{t(REPLY_MODE_LABELS[props.replyMode || 'brief'])}</span><ChevronDown className="mode-chevron" size={12} aria-hidden="true" /></button></div>}<button onClick={() => { void props.recordActivity?.('你发起了共同故事'); props.openStory() }}>{t('📖 共同故事')}</button><button onClick={() => { void props.recordActivity?.('你发起了猜拳'); props.openGame() }}>{t('✊ 猜拳')}</button>{props.openMoments && <button disabled={replying || recording} onClick={() => { void props.recordActivity?.('你查看了 TA 的朋友圈'); props.openMoments?.() }}>{t('✨ 朋友圈')}</button>}<button onClick={() => { const topic=randomRelationshipTopic(props.relationshipStage); setDraft(t(topic)); composerInput.current?.focus() }}><Sparkles size={14}/>{t('随机话题')}</button></div>
    {modeOpen && <section ref={modeMenu} id="chat-reply-modes" className="reply-mode-picker quick-mode-popover compact-mode-menu" aria-label={t('回复模式')}><div className="reply-mode-options" role="group" aria-label={t('选择回复模式')}>{REPLY_MODES.map(mode => <button key={mode} type="button" aria-label={t(REPLY_MODE_LABELS[mode])} aria-pressed={(props.replyMode || 'brief') === mode} disabled={replying || props.modeSaving} onClick={async () => { setNotice(''); setModeOpen(false); try { await props.setReplyMode?.(mode); try { await props.recordActivity?.(`你将聊天模式切换为「${t(REPLY_MODE_LABELS[mode])}」`) } catch { setNotice(locale === 'en' ? 'Mode changed, but the activity record could not be saved.' : '模式已切换，但操作记录未保存。') } } catch { setNotice('回复模式未切换，请停止回复或检查本机存储后重试。') } }}><span className="mode-option-copy"><span>{t(REPLY_MODE_LABELS[mode])}</span><small>{locale === 'en' ? ({ brief: 'A little everyday company', deep: 'Listen and reflect together', story: 'Step into a shared scene' })[mode] : ({ brief: '轻松聊几句', deep: '认真倾听，一起梳理', story: '进入角色与场景' })[mode]}</small></span>{(props.replyMode || 'brief') === mode && <Check size={16} aria-hidden="true" />}</button>)}</div></section>}
    <input hidden ref={imageInput} aria-label={t('选择照片文件')} type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={replying || recording || readingFile} onChange={event => { void chooseFile('image', event.target.files?.[0]); event.target.value = '' }} />
    <input hidden ref={videoInput} aria-label={t('选择视频文件')} type="file" accept="video/mp4,video/webm,video/quicktime" disabled={replying || recording || readingFile} onChange={event => { void chooseFile('video', event.target.files?.[0]); event.target.value = '' }} />
    <footer className={`composer glass ${moreOpen ? 'composer-expanded' : ''}`}>
      <button aria-label={recording ? t('结束录音') : t('录制语音')} onClick={() => { closeMore(); void record() }} disabled={replying || readingFile}>{recording ? <Square color="#ff7e8b" /> : <Mic />}</button>
      <input ref={composerInput} aria-label={t('发消息')} value={draft} onChange={event => setDraft(event.target.value)} onFocus={() => { closeMore(); setModeOpen(false) }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() } }} placeholder={t('发消息…')} disabled={replying} />
      <button ref={moreButton} className="chat-more-trigger" aria-label={t('更多发送选项')} aria-expanded={moreOpen} aria-controls="chat-more-panel" disabled={replying || recording || readingFile} onClick={() => { setMoreOpen(!moreOpen); setEmojiOpen(false); composerInput.current?.blur(); setModeOpen(false) }}><Plus size={22} /></button>
      {replying ? <button className="send" aria-label={t('停止回复')} onClick={props.stop}><Square /></button> : <button className="send" aria-label={t('发送消息')} disabled={recording || readingFile || (!draft.trim() && !attachment)} onClick={submit}><Send /></button>}
    </footer>
    </div>
    {moreOpen && <section id="chat-more-panel" className="chat-more-panel" aria-label={t('更多发送选项')}>
      {emojiOpen ? <>
        <div className="chat-more-heading"><button onClick={() => setEmojiOpen(false)}><ArrowLeft size={14} />{t('返回选项')}</button><span>{t('表情')}</span><button aria-label={t('关闭更多选项')} onClick={() => { closeMore(); moreButton.current?.focus() }}><X size={16} /></button></div>
        <div className="chat-emoji-grid" role="group" aria-label={t('选择表情')}>{['😊', '😂', '🥰', '😘', '🥹', '😎', '🤔', '😭', '😴', '🤗', '👍', '👏', '❤️', '💛', '🌹', '✨', '🎉', '☕', '👋', '🙌', '😋', '😅', '🥺', '💪'].map(emoji => <button key={emoji} disabled={replying || recording || readingFile} aria-label={t('插入表情 {emoji}', { emoji })} onClick={() => insertEmoji(emoji)}>{emoji}</button>)}</div>
      </> : <div className="chat-more-options">
        <button disabled={replying || recording || readingFile} onClick={() => imageInput.current?.click()}><span><ImageIcon size={25} /></span>{t('照片')}</button>
        <button disabled={replying || recording || readingFile} onClick={() => videoInput.current?.click()}><span><Video size={25} /></span>{t('视频')}</button>
        <button disabled={replying || recording || readingFile} onClick={() => { closeMore(); props.openCall?.() }}><span><Phone size={25} /></span>{t('打电话')}</button>
        <button disabled={replying || recording || readingFile} onClick={() => setEmojiOpen(true)}><span><Smile size={25} /></span>{t('表情')}</button>
        <button disabled={replying || recording || readingFile} onClick={event => openExtra('period', event.currentTarget)}><span><CalendarHeart size={25} /></span>{t('经期记录')}</button>
        <button disabled={replying || recording || readingFile} onClick={event => openExtra('gift', event.currentTarget)}><span><Gift size={25} /></span>{t('送礼物')}</button>
        {props.appDataIdentity && <button disabled={!props.isPrimary || props.temporary || replying || recording || readingFile} onClick={event => openExtra('apps', event.currentTarget)}><span><Sparkles size={25} /></span>{locale === 'en' ? 'Read app data' : '读取应用数据'}</button>}
      </div>}
    </section>}
    {extraPanel && <div className="chat-extra-overlay"><div ref={extraDialog} className="chat-extra-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-extra-heading">
      <header><h2 id="chat-extra-heading">{extraPanel === 'apps' ? (locale === 'en' ? 'Main Bot app data' : '主 Bot 应用数据') : t(extraPanel === 'period' ? '经期记录' : '送礼物')}</h2><button aria-label={t('返回聊天')} onClick={() => { if (extraPanel === 'apps' && replying) props.stop(); setExtraPanel(null) }}><X /></button></header>
      <div className="chat-extra-body">{extraPanel === 'apps' && props.appDataIdentity ? <AppDataPanel identity={props.appDataIdentity} text={draft} modelAvailable={!props.demo} send={props.send} stop={props.stop} close={() => setExtraPanel(null)} /> : extraPanel === 'period' ? <PeriodRecordPanel temporary={props.temporary} onSaved={record => void props.recordActivity?.(`🌸 已记录经期：${record.startDate}${record.endDate ? ` 至 ${record.endDate}` : ''}${record.note ? ` · ${record.note}` : ''}`, true)} /> : <GiftStorePanel selected={character.id} sending={replying} onOpenBilling={props.openBilling} onSendGift={giftId => props.send({ giftId, rejectOnFailure: true })} />}</div>
    </div></div>}
    {readingFile && <div className="chat-notice" role="status">{t('正在读取附件…')}</div>}
    {historyOpen && <div className="chat-history-overlay"><section className="chat-history-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-history-title"><header><div><small>{t(character.name)} · AI</small><h2 id="chat-history-title">{t('对话历史')}</h2></div><button aria-label={t('关闭')} onClick={() => setHistoryOpen(false)}><X /></button></header><div className="chat-history-body">
      {!!props.summaries?.length && <section className="chat-history-summaries"><h3>{t('对话摘要')}</h3>{[...props.summaries].sort((a,b)=>b.periodKey.localeCompare(a.periodKey)).map(summary=><article key={summary.id}><small>{t(({day:'日',week:'周',month:'月',year:'年'})[summary.period])} · {summary.periodKey}</small><p>{displaySummary(summary, locale)}</p></article>)}</section>}
      <section><h3>{t('全部消息')} · {messages.filter(message=>!message.withdrawn).length}</h3>{messages.filter(message=>!message.withdrawn).map(message=><article className={`chat-history-message ${message.from==='user'?'mine':''}`} key={message.id}><small>{message.from==='user'?t('我'):t(character.name)} · {message.createdAt?new Date(message.createdAt).toLocaleString(locale):message.time}</small><p>{message.text||t(message.kind==='image'?'图片消息':message.kind==='video'?'视频消息':message.kind==='audio'?'语音消息':'消息')}</p></article>)}</section>
      {!messages.some(message=>!message.withdrawn)&&<p className="chat-empty">{t('还没有对话记录')}</p>}
    </div></section></div>}
    {memory && <div className="memory-modal-overlay"><form className="memory-modal glass" onSubmit={async event => { event.preventDefault(); try { await props.saveMemory(memory); setMemory(undefined); setNotice('已确认保存，可在回忆页编辑或删除') } catch { setNotice('记忆未保存，请重试') } }}>
      <h2>{t('这件事，要记住吗？')}</h2><p>{t('请确认内容和分类。未确认的内容不会作为长期记忆保存。')}</p>
      <textarea aria-label={t('记忆内容')} value={memory.text} maxLength={1000} required onChange={event => setMemory({ ...memory, text: event.target.value })} />
      <label>{t('记忆分类')}<select value={memory.category} onChange={event => setMemory({ ...memory, category: event.target.value as MemoryDraft['category'] })}><option value="profile">{t('用户偏好')}</option><option value="relationship">{t('共同经历')}</option><option value="context">{t('近期情境')}</option><option value="emotion">{t('情绪与支持偏好')}</option></select></label>
      <div className="memory-actions"><button type="submit">{t('确认记住')}</button><button type="button" onClick={() => setMemory(undefined)}>{t('暂不保存')}</button></div>
    </form></div>}
  </main>
}

function renderMessageText(text: string) {
  if (!text.includes('**')) return text
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return <>{parts.map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part)}</>
}

function randomRelationshipTopic(stage = '初遇') {
  const topics: Record<string, string[]> = {
    初遇: ['我想多认识你一点。你最近最喜欢做什么？', '如果今天可以不用赶时间，你最想怎么度过？', '想听你说说，你眼里的自己是什么样的。'],
    熟悉: ['我突然好奇，你最喜欢的一种小小仪式感是什么？', '你觉得什么样的陪伴会让人安心？', '今天有没有一件很小但让你开心的事？'],
    信任: ['最近有没有一件事，你希望有人认真听你说完？', '如果可以把今天的一个情绪交给我保管，你会选什么？', '你现在最想被怎样理解？'],
    亲密: ['我们以后想一起养成一个什么小习惯？', '如果给我们今天取一个名字，你会怎么叫它？', '有一句平时没说出口的话，想现在告诉我吗？'],
    相伴: ['回头看我们最近的相处，哪一刻让你觉得很珍贵？', '接下来想和我一起完成一件什么小事？', '如果把这一周写进故事里，你希望留下哪一幕？'],
  }
  const list = topics[stage] || topics.初遇
  return list[Math.floor(Math.random() * list.length)]
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob) })
}
