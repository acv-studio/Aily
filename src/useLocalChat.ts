import { useEffect, useRef, useState } from 'react'
import { characters, type CharacterId } from './data'
import { streamReply, type ChatMessage, type ConfirmedMemory } from './chatService'
import { clearCharacterMemories, deleteMemory, initializeLocalData, loadRoleConversation, persistChatChanges, saveMemory, saveSetting, updateMemory } from './db'
import type { MemoryDraft } from './ChatPanel'

function readPreference(storage: 'localStorage' | 'sessionStorage', key: string, fallback = '') {
  try { return window[storage].getItem(key) || fallback } catch { return fallback }
}
const empty = (): Record<CharacterId, ChatMessage[]> => ({ lu: [], chen: [], gu: [] })
let lastId = Date.now()
const nextId = () => { lastId = Math.max(lastId + 1, Date.now()); return lastId }
export default function useLocalChat() {
  const [ready, setReady] = useState(false)
  const [onboarded, setOnboarded] = useState(false)
  const [selected, setSelectedState] = useState<CharacterId>('lu')
  const [conversations, setConversations] = useState(empty)
  const [memories, setMemories] = useState<ConfirmedMemory[]>([])
  const [draft, setDraft] = useState('')
  const [replying, setReplying] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const active = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const memoryLock = useRef(false)
  const mutations = useRef(Promise.resolve())
  const mutationCount = useRef(0)
  const [apiKey, setKey] = useState(() => readPreference('sessionStorage', 'aily-api-key'))
  const [endpoint, setEndpointState] = useState(() => readPreference('localStorage', 'aily-api-endpoint', 'https://api.deepseek.com/chat/completions'))
  const [model, setModelState] = useState(() => readPreference('localStorage', 'aily-api-model', 'deepseek-chat'))
  const load = async () => {
    setLoadError('')
    try { const data = await initializeLocalData(); if (!mounted.current) return; setConversations({ ...empty(), ...data.conversations }); setMemories(data.memories); setOnboarded(data.settings.onboarded === true); if (characters.some(character => character.id === data.settings.selected)) setSelectedState(data.settings.selected as CharacterId); setReady(true) }
    catch { if (mounted.current) setLoadError('无法读取本机数据。请允许浏览器存储后重试；未覆盖任何记录。') }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; active.current?.abort() } }, [])
  const selectedRef = useRef(selected); selectedRef.current = selected
  const conversationsRef = useRef(conversations); conversationsRef.current = conversations
  const memoriesRef = useRef(memories); memoriesRef.current = memories
  const setSelected = (id: CharacterId) => {
    if (active.current || mutationCount.current) { setError('请先停止回复或等待保存，再切换角色'); return }
    setSelectedState(id); setDraft(''); setError(''); void saveSetting('selected', id).catch(() => setError('角色选择未能保存，请重试'))
  }
  const finishOnboarding = async () => {
    try { await saveSetting('onboarded', true); await saveSetting('selected', selected); setOnboarded(true) } catch { setError('无法保存引导设置，请检查本机存储权限') }
  }
  const apply = (role: CharacterId, records: ChatMessage[]) => { conversationsRef.current = { ...conversationsRef.current, [role]: records }; if (mounted.current) setConversations(conversationsRef.current) }
  const send = async (options: { retryId?: number; replyToId?: number; attachment?: ChatMessage['attachment']; kind?: ChatMessage['kind']; imageConsent?: boolean } = {}) => {
    if (!ready || active.current || mutationCount.current) { setError('正在处理聊天或本机保存，请稍后重试；草稿和附件未发送。'); throw new Error('聊天或保存忙碌') }
    const role = selectedRef.current
    const original = conversationsRef.current[role]
    const target = options.retryId === undefined ? undefined : original.find(message => message.id === options.retryId && message.from === 'user' && !message.withdrawn)
    if (options.retryId !== undefined && !target) return
    if (!target && !draft.trim() && !options.attachment) return
    const user: ChatMessage = target ? { ...target, status: 'sent' } : { id: nextId(), from: 'user', text: draft.trim(), time: new Date().toLocaleTimeString('zh-CN'), createdAt: new Date().toISOString(), status: 'sent', replyToId: options.replyToId, kind: options.kind || 'text', attachment: options.attachment }
    // Retrying operates on exactly the original user turn; it never duplicates that turn.
    let records = target ? original.map(message => message.id === target.id ? user : message) : [...original, user]
    const controller = new AbortController(); active.current = controller; setReplying(true); setError('')
    let content = ''; let persisted = false
    const assistant: ChatMessage = { id: nextId(), from: 'character', text: '', time: new Date().toLocaleTimeString('zh-CN'), createdAt: new Date().toISOString(), status: 'sending' }
    try {
      records = await persistChatChanges(role, [user]); persisted = true; apply(role, records); if (!target) setDraft('')
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      if (user.kind === 'audio') { setError('录音已保存在本机；可使用语音听写输入文字，录音文件不发送给模型。'); return }
      if (user.kind === 'image' && !options.imageConsent) { setError('图片已保存在本机，没有发送给模型；勾选识图授权后可发送新图片。'); return }
      await persistChatChanges(role, [{ ...user, status: 'sending' }, assistant])
      apply(role, [...records, assistant])
      const context = target ? records.slice(0, records.findIndex(item => item.id === user.id) + 1) : records
      await streamReply({ characterId: role, messages: context, memories: memoriesRef.current, apiKey, endpoint, model, imageConsent: options.imageConsent, signal: controller.signal, onDelta: delta => { content += delta; apply(role, [...records, { ...assistant, text: content }]) } })
      const completed = await persistChatChanges(role, [{ ...user, status: 'sent' }, { ...assistant, text: content, status: 'sent' }]); apply(role, completed)
    } catch (failure) {
      const cancelled = controller.signal.aborted
      const failed = records.map(message => message.id === user.id ? { ...message, status: 'failed' as const } : message)
      const retained = content ? [...failed, { ...assistant, text: content, status: 'failed' as const }] : failed
      if (persisted) {
        try { const saved = await persistChatChanges(role, [{ ...user, status: 'failed' }, ...(content ? [{ ...assistant, text: content, status: 'failed' as const }] : [{ ...assistant, text: '', status: 'failed' as const }])]); apply(role, saved); setError(cancelled ? '已停止回复，消息和已生成内容已保存；可重试。' : user.kind === 'image' ? '识图未完成，图片已保留；请检查有效 Key、支持图片输入的模型与接口后重试。' : '回复未完成，消息已保存在本机；可重试。') }
        catch { apply(role, retained); setError('本机保存失败：当前内容仅暂留界面，请勿关闭页面并检查存储空间。') }
      } else { setError('消息未保存、未发送：请检查本机存储权限或空间。'); if (failure) return Promise.reject(failure) }
    } finally { if (active.current === controller) { active.current = null; if (mounted.current) setReplying(false) } }
  }
  const appendLocalMessage = async (role: CharacterId, text: string) => {
    if (!ready || !mounted.current || active.current || mutationCount.current) throw new Error('聊天忙碌，暂不发送主动问候')
    if (!characters.some(character => character.id === role) || !text.trim() || text.length > 1000) throw new Error('主动消息无效')
    mutationCount.current++
    try {
      const message: ChatMessage = { id: nextId(), from: 'character', text, createdAt: new Date().toISOString(), time: new Date().toLocaleTimeString('zh-CN'), status: 'sent', kind: 'text' }
      const records = await persistChatChanges(role, [message])
      apply(role, records)
    } finally { mutationCount.current-- }
  }
  const saveConfirmed = async (memory: MemoryDraft) => {
    if (!memory.text.trim() || memory.text.trim().length > 1000) throw new Error('记忆内容需为 1–1000 字')
    const item: ConfirmedMemory = { ...memory, text: memory.text.trim(), id: crypto.randomUUID(), characterId: selectedRef.current, confirmedAt: new Date().toISOString(), enabled: true }
    await saveMemory(item); memoriesRef.current = [...memoriesRef.current, item]; setMemories(memoriesRef.current)
  }
  const editMemory = async (id: string, patch: Partial<ConfirmedMemory>) => {
    if (memoryLock.current) return; memoryLock.current = true
    try { const updatedAt = new Date().toISOString(); await updateMemory(id, patch); memoriesRef.current = memoriesRef.current.map(item => item.id === id ? { ...item, ...patch, id: item.id, characterId: item.characterId, updatedAt } : item); setMemories(memoriesRef.current) } finally { memoryLock.current = false }
  }
  const removeMemory = async (id: string) => { await deleteMemory(id); memoriesRef.current = memoriesRef.current.filter(item => item.id !== id); setMemories(memoriesRef.current) }
  const clearMemories = async (role: CharacterId) => { await clearCharacterMemories(role); memoriesRef.current = memoriesRef.current.filter(item => item.characterId !== role); setMemories(memoriesRef.current) }
  const withdraw = (id: number) => {
    if (active.current) { setError('请先停止回复，再撤回消息'); return Promise.resolve() }
    const role = selectedRef.current
    mutationCount.current++
    const task = mutations.current.then(async () => {
      const stored = await loadRoleConversation(role)
      const message = stored.find(item => item.id === id && item.from === 'user')
      if (!message) return
      const changed = await persistChatChanges(role, [{ ...message, withdrawn: true, text: '', attachment: undefined }]); apply(role, changed)
    }).catch(() => setError('撤回未保存，请重试')).finally(() => { mutationCount.current-- })
    mutations.current = task
    return task
  }
  const writePreference = (storage: 'localStorage' | 'sessionStorage', key: string, value: string) => {
    try { if (value) window[storage].setItem(key, value); else window[storage].removeItem(key) }
    catch { setError('浏览器无法保存配置，本次配置仅暂留内存。') }
  }
  return { ready, loadError, reload: load, onboarded, finishOnboarding, selected, setSelected, conversations, setConversations, memories, setMemories, draft, setDraft, replying, error, apiKey, endpoint, model,
    setApiKey: (value: string) => { setKey(value); writePreference('sessionStorage', 'aily-api-key', value) },
    setEndpoint: (value: string) => { setEndpointState(value); writePreference('localStorage', 'aily-api-endpoint', value) }, setModel: (value: string) => { setModelState(value); writePreference('localStorage', 'aily-api-model', value) },
    send, appendLocalMessage, stop: () => active.current?.abort(), saveConfirmed, editMemory, removeMemory, clearMemories, withdraw }
}
