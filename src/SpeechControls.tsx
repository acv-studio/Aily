import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from './chatService'

export interface SpeechControlsProps {
  draft: string
  setDraft: (text: string) => void
  messages: ChatMessage[]
  replying: boolean
}

// SpeechRecognition is not yet part of TypeScript's standard DOM declarations.
interface RecognitionResult {
  isFinal: boolean
  readonly [index: number]: { transcript: string }
}
interface RecognitionEvent {
  resultIndex: number
  results: ArrayLike<RecognitionResult>
}
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
type SpeechWindow = Window & {
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance
  SpeechRecognition?: new () => Recognition
  webkitSpeechRecognition?: new () => Recognition
}

function detachRecognition(recognition: Recognition) {
  recognition.onresult = null
  recognition.onerror = null
  recognition.onend = null
}

function recognitionError(error: string) {
  if (error === 'not-allowed' || error === 'service-not-allowed') return '麦克风或语音识别权限被拒绝，请检查浏览器权限；仍可手动输入。'
  if (error === 'audio-capture') return '无法使用麦克风，请检查设备与麦克风权限。'
  if (error === 'network') return '语音识别网络服务不可用，请稍后重试或手动输入。'
  if (error === 'no-speech') return '未检测到语音，请重新开始听写。'
  return '语音识别失败，请重试或手动输入。'
}

export default function SpeechControls({ draft, setDraft, messages, replying }: SpeechControlsProps) {
  const [consent, setConsent] = useState(false)
  const [dictating, setDictating] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [reading, setReading] = useState(false)
  const [dictationNotice, setDictationNotice] = useState('')
  const [playbackNotice, setPlaybackNotice] = useState('')
  const mounted = useRef(false)
  const recognition = useRef<Recognition | null>(null)
  const utterance = useRef<SpeechSynthesisUtterance | null>(null)
  const playbackMessageId = useRef<number | undefined>(undefined)
  const latestDraft = useRef(draft)
  const observedDraft = useRef(draft)
  const updateDraft = useRef(setDraft)
  // Keep rapid final results cumulative, even before the parent's next render.
  if (observedDraft.current !== draft) {
    observedDraft.current = draft
    latestDraft.current = draft
  }
  updateDraft.current = setDraft

  const browser = typeof window === 'undefined' ? undefined : window as SpeechWindow
  const RecognitionConstructor = browser?.SpeechRecognition || browser?.webkitSpeechRecognition
  const synthesis = browser?.speechSynthesis
  const supportsPlayback = !!synthesis && typeof browser?.SpeechSynthesisUtterance === 'function'
  const latestMessage = [...messages].reverse().find(message => message.from === 'character'
    && !message.withdrawn && (message.status === 'sent' || message.status === undefined)
    && (!message.kind || message.kind === 'text') && !!message.text.trim())

  const discardDictation = () => {
    const active = recognition.current
    recognition.current = null
    if (active) {
      detachRecognition(active)
      try { active.stop() } catch { /* Already stopped by the browser. */ }
    }
  }
  const cancelPlayback = () => {
    const active = utterance.current
    utterance.current = null
    if (active) { active.onend = null; active.onerror = null }
    try { synthesis?.cancel() } catch { /* Browser service may be unavailable. */ }
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      discardDictation()
      cancelPlayback()
    }
  }, [])

  // A reply can disable the composer externally. Do not append into it afterward.
  useEffect(() => {
    if (replying && recognition.current) {
      discardDictation()
      setDictating(false)
      setStopping(false)
      setDictationNotice('回复期间已停止听写；已确认的文字仍留在草稿中。')
    }
  }, [replying])

  // Never continue reading text that was withdrawn/removed or changed mid-playback.
  useEffect(() => {
    if (utterance.current && (utterance.current.text !== latestMessage?.text || playbackMessageId.current !== latestMessage?.id)) {
      cancelPlayback()
      setReading(false)
      setPlaybackNotice('消息已变化，朗读已停止。')
    }
  }, [latestMessage?.id, latestMessage?.text])

  const startDictation = () => {
    if (!consent || replying || !RecognitionConstructor || recognition.current || !mounted.current) return
    let active: Recognition | undefined
    try {
      active = new RecognitionConstructor()
      const session = active
      recognition.current = session
      session.lang = 'zh-CN'
      session.continuous = true
      session.interimResults = false
      const finalized = new Set<number>()
      const current = () => mounted.current && recognition.current === session
      session.onresult = event => {
        if (!current()) return
        const chunks: string[] = []
        for (let index = event.resultIndex; index < event.results.length; index++) {
          const result = event.results[index]
          if (!result.isFinal || finalized.has(index)) continue
          finalized.add(index)
          const text = result[0]?.transcript.trim()
          if (text) chunks.push(text)
        }
        if (!chunks.length) return
        const previous = latestDraft.current
        const next = previous + (previous && !/\s$/.test(previous) ? ' ' : '') + chunks.join(' ')
        latestDraft.current = next
        updateDraft.current(next)
        setDictationNotice('听写文字已加入草稿，请检查后手动发送。')
      }
      session.onerror = event => {
        if (!current()) return
        discardDictation()
        setDictating(false)
        setStopping(false)
        setDictationNotice(recognitionError(event.error))
      }
      session.onend = () => {
        if (!current()) return
        recognition.current = null
        detachRecognition(session)
        setDictating(false)
        setStopping(false)
        setDictationNotice('听写已结束；草稿不会自动发送。')
      }
      setDictationNotice('正在听写，仅将确认的文字加入草稿，不会自动发送。')
      setDictating(true)
      setStopping(false)
      session.start()
    } catch {
      if (active) detachRecognition(active)
      discardDictation()
      setDictating(false)
      setStopping(false)
      setDictationNotice('无法开始听写，请检查麦克风权限、HTTPS 和浏览器支持后重试。')
    }
  }

  const stopDictation = () => {
    if (!recognition.current || stopping) return
    setStopping(true)
    setDictationNotice('正在停止听写，等待最后的确认文字；不会自动发送。')
    try { recognition.current.stop() }
    catch {
      discardDictation()
      setDictating(false)
      setStopping(false)
      setDictationNotice('听写已停止；仍可手动编辑草稿。')
    }
  }

  const readLatest = () => {
    if (!supportsPlayback || !latestMessage || !mounted.current) return
    cancelPlayback()
    try {
      const active = new window.SpeechSynthesisUtterance(latestMessage.text)
      active.lang = 'zh-CN'
      utterance.current = active
      playbackMessageId.current = latestMessage.id
      const finish = (notice: string) => {
        if (!mounted.current || utterance.current !== active) return
        active.onend = null
        active.onerror = null
        utterance.current = null
        setReading(false)
        setPlaybackNotice(notice)
      }
      active.onend = () => finish('朗读已结束。')
      active.onerror = () => finish('朗读失败，请检查浏览器语音服务后重试。')
      setReading(true)
      setPlaybackNotice('正在朗读最近一条已完成的角色文字。')
      synthesis!.speak(active)
    } catch {
      cancelPlayback()
      setReading(false)
      setPlaybackNotice('无法开始朗读，请检查浏览器语音服务后重试。')
    }
  }

  return <section className="speech-controls" aria-label="听写与朗读">
    <header><strong>听写与朗读</strong><p>浏览器语音工具，不是实时语音通话；不会自动发送消息。</p></header>
    <fieldset>
      <legend>语音听写</legend>
      <p>部分浏览器会把麦克风音频发送给浏览器厂商的语音服务处理，不保证仅在本机处理。请先确认隐私提示，再手动开始。</p>
      <label><input type="checkbox" checked={consent} disabled={!RecognitionConstructor} onChange={event => {
        setConsent(event.target.checked)
        if (!event.target.checked) {
          discardDictation()
          setDictating(false)
          setStopping(false)
          setDictationNotice('已取消听写授权并停止麦克风识别。')
        }
      }} />我了解音频可能发送给浏览器厂商，同意本次使用听写</label>
      <div className="speech-actions">
        <button type="button" onClick={startDictation} disabled={!RecognitionConstructor || !consent || replying || dictating}>开始听写</button>
        <button type="button" onClick={stopDictation} disabled={!dictating || stopping}>停止听写</button>
      </div>
      <p role="status">{!RecognitionConstructor ? '当前浏览器不支持语音识别，请手动输入文字。' : dictationNotice || (replying ? '回复期间不能开始听写。' : '听写仅填入草稿，你可以修改后手动发送。')}</p>
    </fieldset>
    <fieldset>
      <legend>角色文字朗读</legend>
      <p>手动朗读最近一条已完成、未撤回的角色文字，使用浏览器语音合成（不是角色原声）。</p>
      <div className="speech-actions">
        <button type="button" onClick={readLatest} disabled={!supportsPlayback || !latestMessage || reading}>朗读最新回复</button>
        <button type="button" disabled={!reading} onClick={() => { cancelPlayback(); setReading(false); setPlaybackNotice('朗读已停止。') }}>停止朗读</button>
      </div>
      <p role="status">{!supportsPlayback ? '当前浏览器不支持语音朗读。' : playbackNotice || (!latestMessage ? '暂无可朗读的已完成角色文字。' : '点击按钮开始朗读，不会自动播放新回复。')}</p>
    </fieldset>
  </section>
}
