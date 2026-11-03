import { useEffect, useRef, useState } from 'react'
import { hasSafetyConsent } from './privacy'
import { characters, type CharacterId } from './data'
import { streamReply, type ChatMessage, type ConfirmedMemory } from './chatService'
import { clearCharacterMemories, deleteMemory, initializeLocalData, loadRoleConversation, persistChatChanges, saveMemory, saveSetting, updateMemory } from './db'
import type { MemoryDraft } from './ChatPanel'
import { deliverProactive } from './proactiveMessages'
import { archiveExpiredMemories, confirmProposal, db, forgottenSourceIds, loadMemoryPolicy, loadSummaries, saveMemoryPolicy, saveProposals, saveSummaries } from './db'
import { categoriesFor, conflictMemoryIds, defaultMemoryPolicy, extractCandidates, isSensitive, summarizeConversation, type ConversationSummary, type MemoryPolicy } from './longMemory'

function readPreference(storage: 'localStorage' | 'sessionStorage', key: string, fallback = '') {
  try { return window[storage].getItem(key) || fallback } catch { return fallback }
}
const empty = (): Record<CharacterId, ChatMessage[]> => ({ lu: [], chen: [], gu: [] })
let lastId = Date.now()
const nextId = (knownMaximum = 0) => { lastId = Math.max(lastId + 1, knownMaximum + 1, Date.now()); return lastId }
export default function useLocalChat() {
  const [ready, setReady] = useState(false)
  const [onboarded, setOnboarded] = useState(false)
  const [selected, setSelectedState] = useState<CharacterId>('lu')
  const [conversations, setConversations] = useState(empty)
  const [memories, setMemories] = useState<ConfirmedMemory[]>([])
  const [summaries, setSummaries] = useState<ConversationSummary[]>([])
  const [policies, setPolicies] = useState<Partial<Record<CharacterId, MemoryPolicy>>>({})
  const policiesRef = useRef(policies); policiesRef.current = policies
  const [temporary, setTemporary] = useState(false)
  const temporaryRef = useRef(false)
  const [temporaryConversations, setTemporaryConversations] = useState(empty)
  const temporaryConversationsRef = useRef(empty())
  const organization = useRef(Promise.resolve())
  const [draft, setDraft] = useState('')
  const [replying, setReplying] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const active = useRef<AbortController | null>(null)
  const deleting = useRef(false)
  const proactiveTask = useRef<Promise<void>>(Promise.resolve())
  const mounted = useRef(true)
  const memoryLock = useRef(false)
  const mutations = useRef(Promise.resolve())
  const mutationCount = useRef(0)
  const pendingWrites = useRef(new Set<Promise<unknown>>())
  const observeWrite = <Result,>(work: Promise<Result>): Promise<Result> => {
    const task = work.finally(() => { pendingWrites.current.delete(task) })
    pendingWrites.current.add(task)
    return task
  }
  const tracked = <Args extends unknown[], Result,>(work: (...args: Args) => Promise<Result>) => (...args: Args): Promise<Result> => {
    if (deleting.current) return Promise.reject(new Error('正在删除本机资料，不能继续写入'))
    mutationCount.current++
    const task = work(...args).finally(() => { mutationCount.current--; pendingWrites.current.delete(task) })
    pendingWrites.current.add(task)
    return task
  }
  const [apiKey, setKey] = useState(() => readPreference('sessionStorage', 'aily-api-key'))
  const [endpoint, setEndpointState] = useState(() => readPreference('localStorage', 'aily-api-endpoint', 'https://api.deepseek.com/chat/completions'))
  const [model, setModelState] = useState(() => readPreference('localStorage', 'aily-api-model', 'deepseek-chat'))
  const load = async () => {
    setLoadError('')
    try {
      await archiveExpiredMemories()
      const data = await initializeLocalData(); if (!mounted.current) return
      conversationsRef.current = { ...empty(), ...data.conversations }; setConversations(conversationsRef.current)
      memoriesRef.current = data.memories; setMemories(data.memories)
      const restoredPolicies = Object.fromEntries(await Promise.all(characters.map(async role => [role.id, await loadMemoryPolicy(role.id)])))
      policiesRef.current = restoredPolicies; setPolicies(restoredPolicies)
      setSummaries(data.summaries || [])
      setOnboarded(data.settings.onboarded === true); if (characters.some(character => character.id === data.settings.selected)) setSelectedState(data.settings.selected as CharacterId)
      for (const role of characters) queueOrganization(role.id)
      setReady(true)
    }
    catch { if (mounted.current) setLoadError('无法读取本机数据。请允许浏览器存储后重试；未覆盖任何记录。') }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; active.current?.abort() } }, [])
  const selectedRef = useRef(selected); selectedRef.current = selected
  const conversationsRef = useRef(conversations); conversationsRef.current = conversations
  const memoriesRef = useRef(memories); memoriesRef.current = memories
  const organize = async (role: CharacterId) => {
    const policy = await loadMemoryPolicy(role)
    const records = await loadRoleConversation(role)
    const existing = await db.memories.toArray()
    const forgotten = new Set(await forgottenSourceIds(role))
    await saveProposals(extractCandidates(role, records.filter(message => !forgotten.has(message.id)), existing, policy))
    const current = await db.memories.toArray()
    // Never turn a pending, corrected, paused or deleted fact into a summary bypass.
    const excluded = new Set(current.filter(memory => memory.characterId === role && (memory.state === 'pending' || memory.state === 'rejected' || memory.state === 'archived' || memory.enabled === false || !!memory.expiresAt && Date.parse(memory.expiresAt) <= Date.now())).map(memory => memory.sourceMessageId))
    let excludedTurn = false
    const safeHistory = records.filter(message => {
      if (message.from === 'user') excludedTurn = forgotten.has(message.id) || excluded.has(message.id) || isSensitive(message.text) || categoriesFor(message.text).some(category => policy.disabledCategories.includes(category))
      return !excludedTurn && !forgotten.has(message.id) && !excluded.has(message.id)
    })
    const digest = summarizeConversation(role, safeHistory, policy)
    await saveSummaries(role, digest, policy)
    if (mounted.current) { memoriesRef.current = current; setMemories(current); setSummaries(previous => [...previous.filter(summary => summary.characterId !== role), ...digest]) }
  }
  const queueOrganization = (role: CharacterId) => {
    organization.current = organization.current.then(() => organize(role)).catch(() => { if (mounted.current) setError('聊天已保存，但记忆整理失败；可重新打开后重试。') })
  }
  const changePolicy = async (role: CharacterId, policy: MemoryPolicy) => {
    await organization.current
    await saveMemoryPolicy(role, policy)
    policiesRef.current = { ...policiesRef.current, [role]: policy }; setPolicies(policiesRef.current)
    await organize(role)
  }
  const toggleTemporary = () => {
    if (deleting.current || active.current || mutationCount.current) { setError('请先停止回复或等待保存，再切换会话模式'); return }
    temporaryRef.current = !temporaryRef.current; setTemporary(temporaryRef.current)
    temporaryConversationsRef.current = empty(); setTemporaryConversations(empty()); setDraft(''); setError('')
  }
  const approveProposal = async (id: string) => {
    await organization.current
    const item = await db.memories.get(id)
    if (!item || item.state !== 'pending') return
    const policy = await loadMemoryPolicy(item.characterId)
    if (policy.disabledCategories.includes(item.category || 'profile')) throw new Error('此类记忆已关闭')
    const existing = await db.memories.where('characterId').equals(item.characterId).toArray()
    const conflicts = conflictMemoryIds(item.text, existing, policy)
    if (conflicts.length && !window.confirm(`新信息与已有记忆冲突：${existing.filter(memory => conflicts.includes(memory.id)).map(memory => memory.text).join('；')}。确认以新信息替换并归档旧记忆？`)) return
    await updateMemory(id, { conflictIds: conflicts })
    await confirmProposal(id, conflicts)
    await organize(item.characterId)
  }
  const setSelected = (id: CharacterId) => {
    if (deleting.current || active.current || mutationCount.current) { setError('请先停止回复或等待保存，再切换角色'); return }
    setSelectedState(id); setDraft(''); setError(''); void observeWrite(saveSetting('selected', id)).catch(() => setError('角色选择未能保存，请重试'))
  }
  const finishOnboarding = async () => {
    try { await saveSetting('onboarded', true); await saveSetting('selected', selected); setOnboarded(true) } catch { setError('无法保存引导设置，请检查本机存储权限') }
  }
  const apply = (role: CharacterId, records: ChatMessage[]) => {
    if (temporaryRef.current) { temporaryConversationsRef.current = { ...temporaryConversationsRef.current, [role]: records }; if (mounted.current) setTemporaryConversations(temporaryConversationsRef.current); return }
    conversationsRef.current = { ...conversationsRef.current, [role]: records }; if (mounted.current) setConversations(conversationsRef.current)
  }
  useEffect(() => {
    if (!ready || !onboarded) return
    let disposed = false
    let running = false
    const runTick = async () => {
      if (deleting.current || !hasSafetyConsent() || running || disposed || document.visibilityState !== 'visible' || active.current || temporaryRef.current || mutationCount.current) return
      running = true
      try {
        for (const role of characters) {
          if (disposed || active.current || temporaryRef.current || mutationCount.current) break
          await deliverProactive(role.id, new Date())
          const records = await loadRoleConversation(role.id)
          // Do not replace an in-flight reply or temporary view after an async read.
          if (!disposed && !active.current && !temporaryRef.current && !mutationCount.current && JSON.stringify(records) !== JSON.stringify(conversationsRef.current[role.id])) apply(role.id, records)
        }
      } catch { if (!disposed) setError('主动消息检查失败，未能确认保存；下次打开页面会重试。') }
      finally { running = false }
    }
    const tick = () => { if (!running) proactiveTask.current = runTick(); return proactiveTask.current }
    void tick()
    const timer = window.setInterval(() => void tick(), 30_000)
    const wake = () => { void tick() }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('aily-proactive-settings', wake)
    return () => { disposed = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', wake); window.removeEventListener('aily-proactive-settings', wake) }
  }, [ready, onboarded])
  const send = async (options: { retryId?: number; replyToId?: number; attachment?: ChatMessage['attachment']; kind?: ChatMessage['kind'] } = {}) => {
    if (deleting.current || !ready || active.current || mutationCount.current) return
    const role = selectedRef.current
    const isTemporary = temporaryRef.current
    const original = (isTemporary ? temporaryConversationsRef : conversationsRef).current[role]
    const persist = async (id: CharacterId, changed: ChatMessage[]) => {
      if (!isTemporary) return persistChatChanges(id, changed)
      const latest = temporaryConversationsRef.current[id]
      return [...latest.filter(message => !changed.some(item => item.id === message.id)), ...changed].sort((a, b) => a.id - b.id)
    }
    const target = options.retryId === undefined ? undefined : original.find(message => message.id === options.retryId && message.from === 'user' && !message.withdrawn)
    if (options.retryId !== undefined && !target) return
    if (!target && !draft.trim() && !options.attachment) return
    const user: ChatMessage = target ? { ...target, status: 'sent' } : { id: nextId(original.reduce((maximum, message) => Math.max(maximum, message.id), 0)), from: 'user', text: draft.trim(), time: new Date().toLocaleTimeString('zh-CN'), createdAt: new Date().toISOString(), status: 'sent', replyToId: options.replyToId, kind: options.kind || 'text', attachment: options.attachment }
    // Retrying operates on exactly the original user turn; it never duplicates that turn.
    let records = target ? original.map(message => message.id === target.id ? user : message) : [...original, user]
    const controller = new AbortController(); active.current = controller; setReplying(true); setError('')
    let content = ''; let persisted = false
    const assistant: ChatMessage = { id: nextId(), from: 'character', text: '', time: new Date().toLocaleTimeString('zh-CN'), createdAt: new Date().toISOString(), status: 'sending' }
    try {
      records = await persist(role, [user]); persisted = true; apply(role, records); if (!target) setDraft('')
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      // Attachments are local-only: no false claim that a text model can hear or see them.
      if (user.kind === 'image' || user.kind === 'audio') { setError(isTemporary ? '附件仅保留在临时会话内，未落盘；文字模型不会读取图片或语音。' : '附件已保存在本机；文字模型不会读取图片或语音。请另发文字描述。'); return }
      await persist(role, [{ ...user, status: 'sending' }, assistant])
      apply(role, [...records, assistant])
      const history = target ? records.slice(0, records.findIndex(item => item.id === user.id) + 1) : records
      const forgotten = new Set(isTemporary ? [] : await forgottenSourceIds(role))
      let lastUserForgotten = false
      const context = history.filter(message => {
        if (message.from === 'user') lastUserForgotten = forgotten.has(message.id)
        return !forgotten.has(message.id) && !lastUserForgotten
      })
      await streamReply({ characterId: role, messages: context, memories: isTemporary ? [] : await db.memories.toArray(), summaries: isTemporary ? [] : await loadSummaries(role), memoryPolicy: await loadMemoryPolicy(role), apiKey, endpoint, model, signal: controller.signal, onDelta: delta => { content += delta; apply(role, [...records, { ...assistant, text: content }]) } })
      const completed = await persist(role, [{ ...user, status: 'sent' }, { ...assistant, text: content, status: 'sent' }]); apply(role, completed)
    } catch (failure) {
      const cancelled = controller.signal.aborted
      const failed = records.map(message => message.id === user.id ? { ...message, status: 'failed' as const } : message)
      const retained = content ? [...failed, { ...assistant, text: content, status: 'failed' as const }] : failed
      if (isTemporary) { apply(role, retained); setError(cancelled ? '已停止回复；内容仅保留在临时会话内，可重试，未写入本机。' : '回复未完成；内容仅在临时会话内，可重试，未写入本机。') }
      else if (persisted) {
        try { const saved = await persist(role, [{ ...user, status: 'failed' }, ...(content ? [{ ...assistant, text: content, status: 'failed' as const }] : [{ ...assistant, text: '', status: 'failed' as const }])]); apply(role, saved); setError(cancelled ? '已停止回复，消息和已生成内容已保存；可重试。' : '回复未完成，消息已保存在本机；可重试。') }
        catch { apply(role, retained); setError('本机保存失败：当前内容仅暂留界面，请勿关闭页面并检查存储空间。') }
      } else { setError('消息未保存、未发送：请检查本机存储权限或空间。'); if (failure) return Promise.reject(failure) }
    } finally { if (!isTemporary && persisted) queueOrganization(role); if (active.current === controller) { active.current = null; if (mounted.current) setReplying(false) } }
  }
  const saveConfirmed = async (memory: MemoryDraft) => {
    const role = selectedRef.current
    mutationCount.current++
    try {
    if (temporaryRef.current) throw new Error('临时会话不能保存长期记忆')
    if ((policiesRef.current[selectedRef.current] || defaultMemoryPolicy).disabledCategories.includes(memory.category)) throw new Error('此类记忆已关闭')
    await organization.current
    if (temporaryRef.current || role !== selectedRef.current) throw new Error('会话已切换，记忆未保存')
    if ((await loadMemoryPolicy(role)).disabledCategories.includes(memory.category)) throw new Error('此类记忆已关闭')
    if (!memory.text.trim() || memory.text.trim().length > 1000) throw new Error('记忆内容需为 1–1000 字')
    const item: ConfirmedMemory = { ...memory, text: memory.text.trim(), id: crypto.randomUUID(), characterId: selectedRef.current, confirmedAt: new Date().toISOString(), enabled: true, state: 'confirmed', importance: 3, originalText: conversationsRef.current[selectedRef.current].find(message => message.id === memory.sourceMessageId)?.text }
    const proposal = memoriesRef.current.find(existing => existing.characterId === item.characterId && existing.sourceMessageId === item.sourceMessageId && item.sourceMessageId !== undefined && existing.state === 'pending')
    if (proposal) { await updateMemory(proposal.id, { text: item.text, category: item.category }); await approveProposal(proposal.id); if ((await db.memories.get(proposal.id))?.state === 'pending') throw new Error('新信息仍待确认'); return }
    const existing = await db.memories.where('characterId').equals(role).toArray()
    const conflicts = conflictMemoryIds(item.text, existing, await loadMemoryPolicy(role))
    if (conflicts.length) {
      if (!window.confirm(`这条记忆与${existing.filter(memory => conflicts.includes(memory.id)).map(memory => memory.text).join('；')}冲突，确认以新信息替换并归档旧记忆？`)) throw new Error('已保留旧记忆')
      await saveMemory({ ...item, state: 'pending', enabled: false, conflictIds: conflicts })
      await confirmProposal(item.id, conflicts); await organize(role); return
    }
    await saveMemory(item); memoriesRef.current = [...memoriesRef.current, item]; setMemories(memoriesRef.current)
    } finally { mutationCount.current-- }
  }
  const editMemory = async (id: string, patch: Partial<ConfirmedMemory>) => {
    if (memoryLock.current) return; memoryLock.current = true
    try {
      await organization.current
      const stored = await db.memories.get(id)
      if (stored && patch.text && patch.text !== stored.text) {
        const conflicts = conflictMemoryIds(patch.text, (await db.memories.where('characterId').equals(stored.characterId).toArray()).filter(memory => memory.id !== id), await loadMemoryPolicy(stored.characterId))
        if (conflicts.length) patch = { ...patch, conflictIds: conflicts, state: 'pending', enabled: false }
      }
      const updatedAt = new Date().toISOString(); await updateMemory(id, patch); memoriesRef.current = memoriesRef.current.map(item => item.id === id ? { ...item, ...patch, id: item.id, characterId: item.characterId, updatedAt } : item); setMemories(memoriesRef.current); const item = memoriesRef.current.find(memory => memory.id === id); if (item) await organize(item.characterId) } finally { memoryLock.current = false }
  }
  const removeMemory = async (id: string) => { await organization.current; const item = memoriesRef.current.find(memory => memory.id === id); await deleteMemory(id); memoriesRef.current = memoriesRef.current.filter(item => item.id !== id); setMemories(memoriesRef.current); if (item) await organize(item.characterId) }
  const clearMemories = async (role: CharacterId) => { await organization.current; await clearCharacterMemories(role); memoriesRef.current = memoriesRef.current.filter(item => item.characterId !== role); setMemories(memoriesRef.current); setSummaries(previous => previous.filter(summary => summary.characterId !== role)) }
  const withdraw = (id: number) => {
    if (deleting.current || active.current) { setError('请先停止回复，再撤回消息'); return Promise.resolve() }
    const role = selectedRef.current
    if (temporaryRef.current) { apply(role, temporaryConversationsRef.current[role].map(message => message.id === id && message.from === 'user' ? { ...message, withdrawn: true, text: '', attachment: undefined } : message)); return Promise.resolve() }
    mutationCount.current++
    const task = mutations.current.then(async () => {
      const stored = await loadRoleConversation(role)
      const message = stored.find(item => item.id === id && item.from === 'user')
      if (!message) return
      const changed = await persistChatChanges(role, [{ ...message, withdrawn: true, text: '', attachment: undefined }]); apply(role, changed)
      await organization.current
      for (const memory of await db.memories.where('characterId').equals(role).toArray()) if (memory.sourceMessageId === id) await updateMemory(memory.id, { enabled: false, state: 'archived' })
      await organize(role)
    }).catch(() => setError('撤回未保存，请重试')).finally(() => { mutationCount.current-- })
    mutations.current = task
    return task
  }
  const writePreference = (storage: 'localStorage' | 'sessionStorage', key: string, value: string) => {
    try { if (value) window[storage].setItem(key, value); else window[storage].removeItem(key) }
    catch { setError('浏览器无法保存配置，本次配置仅暂留内存。') }
  }
  return { prepareForDeletion: async () => { if (active.current || mutationCount.current || memoryLock.current) throw new Error('请先停止回复或等待保存'); deleting.current = true; try { await proactiveTask.current; await mutations.current; await Promise.all([...pendingWrites.current]); await organization.current } catch (failure) { deleting.current = false; throw failure } }, beforeDataChange: async () => { if (active.current || mutationCount.current) throw new Error('请先停止回复或等待保存'); await organization.current }, summaries, policies, changePolicy: tracked(changePolicy), approveProposal: tracked(approveProposal), temporary, toggleTemporary, chatMessages: temporary ? temporaryConversations[selected] : conversations[selected], ready, loadError, reload: load, onboarded, finishOnboarding: tracked(finishOnboarding), selected, setSelected, conversations, setConversations, memories, setMemories, draft, setDraft, replying, error, apiKey, endpoint, model,
    setApiKey: (value: string) => { setKey(value); writePreference('sessionStorage', 'aily-api-key', value) },
    setEndpoint: (value: string) => { setEndpointState(value); writePreference('localStorage', 'aily-api-endpoint', value) }, setModel: (value: string) => { setModelState(value); writePreference('localStorage', 'aily-api-model', value) },
    send, stop: () => active.current?.abort(), saveConfirmed: tracked(saveConfirmed), editMemory: tracked(editMemory), removeMemory: tracked(removeMemory), clearMemories: tracked(clearMemories), withdraw }
}
