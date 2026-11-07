import { t, getLocale, resolveChatLocale, useI18n, detectLanguage } from './i18n'
import { useEffect, useRef, useState } from 'react'
import { hasSafetyConsent } from './privacy'
import { characters, type CharacterId } from './data'
import { excludedMemorySourceIds, streamReply, validLocalVideoAttachment, type ChatMessage, type ConfirmedMemory, type MemoryRecallSources } from './chatService'
import { clearCharacterMemories, deleteMemory, finishOnboarding as persistFinishOnboarding, updateOnboarding as persistUpdateOnboarding, initializeLocalData, loadRoleConversation, persistChatChanges, saveMemory, saveSetting, setPrimaryCharacter, updateMemory } from './db'
import { defaultOnboardingProfile, normalizeOnboardingProfile, type OnboardingProfile } from './onboarding'
import type { MemoryDraft } from './ChatPanel'
import { normalizeReplyMode, type ReplyMode } from './replyModes'
import { getCreditGift, giftMessage, giftResponseInstruction, type CreditGiftId } from './creditGifts'
import { deliverProactive } from './proactiveMessages'
import { archiveExpiredMemories, confirmProposal, db, forgottenSourceIds, loadMemoryPolicy, loadSummaries, saveMemoryPolicy, saveProposals, saveSummaries } from './db'
import { categoriesFor, conflictMemoryIds, defaultMemoryPolicy, extractCandidates, isSensitive, summarizeConversation, topics, type ConversationSummary, type MemoryPolicy } from './longMemory'
import type { AppDataIdentity, AppDataTicket } from './appDataTypes'
import { appDataTicketSources, discardAppDataTicket, invalidateAppDataAccess } from './appDataGateway'
import { automaticAppDataTicket } from './automaticAppData'
import { installedAppsLocalReply } from './appDataIntent'
import { appDataLocalReply } from './appDataLocalQuery'

function readPreference(storage: 'localStorage' | 'sessionStorage', key: string, fallback = '') {
  try { return window[storage].getItem(key) || fallback } catch { return fallback }
}
const empty = (): Record<CharacterId, ChatMessage[]> => ({ lu: [], chen: [], gu: [] })
let lastId = Date.now()
const nextId = (knownMaximum = 0) => { lastId = Math.max(lastId + 1, knownMaximum + 1, Date.now()); return lastId }
export default function useLocalChat() {
  useI18n() // Re-render transient error keys when the display language changes.
  const [ready, setReady] = useState(false)
  const [onboarded, setOnboarded] = useState(false)
  const [onboardingProfile, setOnboardingProfile] = useState<OnboardingProfile | null>(null)
  const onboardingProfileRef = useRef(onboardingProfile); onboardingProfileRef.current = onboardingProfile
  const [selected, setSelectedState] = useState<CharacterId>('lu')
  const [conversations, setConversations] = useState(empty)
  const [memories, setMemories] = useState<ConfirmedMemory[]>([])
  const [summaries, setSummaries] = useState<ConversationSummary[]>([])
  const [policies, setPolicies] = useState<Partial<Record<CharacterId, MemoryPolicy>>>({})
  const policiesRef = useRef(policies); policiesRef.current = policies
  const [temporary, setTemporary] = useState(false)
  const temporaryRef = useRef(false)
  const [replyModes, setReplyModes] = useState<Partial<Record<CharacterId, ReplyMode>>>({})
  const replyModesRef = useRef(replyModes); replyModesRef.current = replyModes
  const [temporaryReplyModes, setTemporaryReplyModes] = useState<Partial<Record<CharacterId, ReplyMode>>>({})
  const temporaryReplyModesRef = useRef(temporaryReplyModes); temporaryReplyModesRef.current = temporaryReplyModes
  const [modeSaving, setModeSaving] = useState(false)
  const currentReplyMode = (role: CharacterId): ReplyMode => (temporaryRef.current ? temporaryReplyModesRef.current[role] : undefined)
    || replyModesRef.current[role] || (onboardingProfileRef.current?.chatLength === 'long' ? 'deep' : 'brief')
  const changeReplyMode = async (mode: ReplyMode) => {
    if (!ready || active.current || mutationCount.current > 1) throw new Error('请先停止回复或等待保存，再切换回复模式')
    const role = selectedRef.current
    const value = normalizeReplyMode(mode)
    if (temporaryRef.current) {
      temporaryReplyModesRef.current = { ...temporaryReplyModesRef.current, [role]: value }
      setTemporaryReplyModes(temporaryReplyModesRef.current)
      return
    }
    setModeSaving(true)
    try {
      await saveSetting(`__replyMode:${role}`, value)
      replyModesRef.current = { ...replyModesRef.current, [role]: value }
      if (mounted.current) { setReplyModes(replyModesRef.current); setError('') }
    } catch (failure) { if (mounted.current) setError('回复模式未能保存，仍使用原模式；请重试。'); throw failure }
    finally { if (mounted.current) setModeSaving(false) }
  }
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
    if (deleting.current) return Promise.reject(new Error(t('正在删除本机资料，不能继续写入')))
    mutationCount.current++
    const task = work(...args).finally(() => { mutationCount.current--; pendingWrites.current.delete(task) })
    pendingWrites.current.add(task)
    return task
  }
  const savedApiKey = readPreference('sessionStorage', 'aily-api-key')
  const useDefaultGateway = !savedApiKey
  const [apiKey, setKey] = useState(() => savedApiKey || 'magpie')
  const [endpoint, setEndpointState] = useState(() => useDefaultGateway ? '/api/magpie/v1/messages' : readPreference('localStorage', 'aily-api-endpoint', '/api/magpie/v1/messages'))
  const [model, setModelState] = useState(() => useDefaultGateway ? 'group/auto-mimo-v2-6-flash-free' : readPreference('localStorage', 'aily-api-model', 'group/auto-mimo-v2-6-flash-free'))
  const modelConfigRef = useRef({ endpoint, model }); modelConfigRef.current = { endpoint, model }
  const load = async () => {
    setLoadError('')
    try {
      await archiveExpiredMemories()
      const data = await initializeLocalData(); if (!mounted.current) return
      conversationsRef.current = { ...empty(), ...data.conversations }; setConversations(conversationsRef.current)
      memoriesRef.current = data.memories; setMemories(data.memories)
      const restoredPolicies = Object.fromEntries(await Promise.all(characters.map(async role => [role.id, await loadMemoryPolicy(role.id)])))
      policiesRef.current = restoredPolicies; setPolicies(restoredPolicies)
      const restoredModes: Partial<Record<CharacterId, ReplyMode>> = {}
      for (const role of characters) {
        const setting = await db.settings.get(`__replyMode:${role.id}`)
        if (setting) restoredModes[role.id] = normalizeReplyMode(setting.value)
      }
      replyModesRef.current = restoredModes; setReplyModes(restoredModes)
      setSummaries(data.summaries || [])
      onboardingProfileRef.current = normalizeOnboardingProfile(data.settings.onboardingProfile); setOnboardingProfile(onboardingProfileRef.current)
      setOnboarded(data.settings.onboarded === true); if (characters.some(character => character.id === data.settings.selected)) setSelectedState(data.settings.selected as CharacterId)
      for (const role of characters) queueOrganization(role.id)
      setReady(true)
    }
    catch { if (mounted.current) setLoadError('无法读取本机数据，页面资料可能尚未更新。请允许浏览器存储后重试读取。') }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; active.current?.abort() } }, [])
  const selectedRef = useRef(selected); selectedRef.current = selected
  const appDataIdentity = (): AppDataIdentity => ({ role: selectedRef.current, primaryId: onboardingProfileRef.current?.characterId || selectedRef.current, temporary: temporaryRef.current || deleting.current, ...modelConfigRef.current })
  const conversationsRef = useRef(conversations); conversationsRef.current = conversations
  const memoriesRef = useRef(memories); memoriesRef.current = memories
  const organize = async (role: CharacterId) => {
    const policy = await loadMemoryPolicy(role)
    const records = await loadRoleConversation(role)
    const existing = await db.memories.toArray()
    const forgotten = new Set(await forgottenSourceIds(role))
    await saveProposals(extractCandidates(role, records.filter(message => !message.localOnly && !forgotten.has(message.id)), existing, policy))
    const current = await db.memories.toArray()
    // Never turn a pending, corrected, paused or deleted fact into a summary bypass.
    const excluded = new Set(current.filter(memory => memory.characterId === role && (memory.state === 'pending' || memory.state === 'rejected' || memory.state === 'archived' || memory.enabled === false || !!memory.expiresAt && Date.parse(memory.expiresAt) <= Date.now())).map(memory => memory.sourceMessageId))
    let excludedTurn = false
    const safeHistory = records.filter(message => {
      if (message.from === 'user') excludedTurn = !!message.localOnly || !!message.withdrawn || forgotten.has(message.id) || excluded.has(message.id) || isSensitive(message.text) || categoriesFor(message.text).some(category => policy.disabledCategories.includes(category))
      return !message.localOnly && !excludedTurn && !forgotten.has(message.id) && !excluded.has(message.id)
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
    invalidateAppDataAccess()
    temporaryRef.current = !temporaryRef.current; setTemporary(temporaryRef.current)
    temporaryReplyModesRef.current = {}; setTemporaryReplyModes({})
    temporaryConversationsRef.current = empty(); setTemporaryConversations(empty()); setDraft(''); setError('')
  }
  const approveProposal = async (id: string) => {
    await organization.current
    const item = await db.memories.get(id)
    if (!item || item.state !== 'pending') return
    const policy = await loadMemoryPolicy(item.characterId)
    if (policy.disabledCategories.includes(item.category || 'profile')) throw new Error(t('此类记忆已关闭'))
    const existing = await db.memories.where('characterId').equals(item.characterId).toArray()
    const conflicts = conflictMemoryIds(item.text, existing, policy)
    if (conflicts.length && !window.confirm(t('新信息与已有记忆冲突：{memories}。确认以新信息替换并归档旧记忆？', { memories: existing.filter(memory => conflicts.includes(memory.id)).map(memory => memory.text).join('；') }))) return
    await updateMemory(id, { conflictIds: conflicts })
    await confirmProposal(id, conflicts)
    await organize(item.characterId)
  }
  const setSelected = (id: CharacterId) => {
    if (deleting.current || active.current || mutationCount.current) { setError('请先停止回复或等待保存，再切换角色'); return false }
    if (id !== selectedRef.current) invalidateAppDataAccess()
    selectedRef.current = id; setSelectedState(id); setDraft(''); setError(''); void observeWrite(saveSetting('selected', id)).catch(() => setError('角色选择未能保存，请重试'))
    return true
  }
  const changePrimary = async (id: CharacterId): Promise<void> => {
    if (deleting.current) throw new Error(t('正在删除本机资料，不能继续写入'))
    if (!ready || active.current || mutationCount.current) throw new Error(t('请先停止回复或等待本机数据保存'))
    // Snapshot before observing this write so we never await our own promise.
    const writes = [...pendingWrites.current]
    mutationCount.current++
    try {
      await Promise.all(writes)
      await organization.current
      const profile = await setPrimaryCharacter(id)
      invalidateAppDataAccess()
      onboardingProfileRef.current = profile
      const switched = selectedRef.current !== id
      selectedRef.current = id
      if (mounted.current) { setOnboardingProfile(profile); setSelectedState(id); if (switched) setDraft(''); setError('') }
    } finally { mutationCount.current-- }
  }
  const saveOnboarding = async (profile: OnboardingProfile, messages: ChatMessage[], finish: boolean): Promise<void> => {
    if (deleting.current) throw new Error('正在删除本机资料，不能继续写入')
    if (!ready || active.current || mutationCount.current) throw new Error('请先停止回复或等待本机数据保存')
    mutationCount.current++
    try {
      await organization.current
      const result = await (finish ? persistFinishOnboarding(profile, messages) : persistUpdateOnboarding(profile))
      invalidateAppDataAccess()
      onboardingProfileRef.current = result.profile
      if (finish) selectedRef.current = result.profile.characterId
      conversationsRef.current = { ...conversationsRef.current, [result.profile.characterId]: result.messages }
      memoriesRef.current = result.memories
      if (mounted.current) {
        setOnboardingProfile(result.profile); if (finish) setSelectedState(result.profile.characterId); setOnboarded(true)
        setConversations(conversationsRef.current); setMemories(memoriesRef.current); if (finish) setDraft(''); setError('')
      }
    } catch (failure) { if (mounted.current) setError('无法保存引导设置，请检查本机存储权限或设置内容'); throw failure }
    finally { mutationCount.current-- }
  }
  const finishOnboarding = async (profile?: OnboardingProfile, messages: ChatMessage[] = []): Promise<void> => {
    await observeWrite(saveOnboarding(profile || onboardingProfileRef.current || defaultOnboardingProfile(selectedRef.current), messages, true))
  }
  const updateOnboarding = async (profile: OnboardingProfile): Promise<void> => { await observeWrite(saveOnboarding(profile, [], false)) }
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
  const recordActivityFor = async (role: CharacterId, text: string, localOnly = false) => {
    if (deleting.current || !ready || !text.trim() || active.current || mutationCount.current) return
    const activity: ChatMessage = { id: nextId(), from: 'user', text: text.trim(), time: new Date().toLocaleTimeString(getLocale()), createdAt: new Date().toISOString(), status: 'sent', ...(localOnly ? { localOnly: true } : {}) }
    if (temporaryRef.current) {
      const records = [...temporaryConversationsRef.current[role], activity]
      temporaryConversationsRef.current = { ...temporaryConversationsRef.current, [role]: records }
      if (mounted.current) setTemporaryConversations(temporaryConversationsRef.current)
      return
    }
    const records = await observeWrite(persistChatChanges(role, [activity]))
    apply(role, records)
  }
  const recordActivity = async (text: string, localOnly = false) => recordActivityFor(selectedRef.current, text, localOnly)
  const send = async (options: { retryId?: number; replyToId?: number; attachment?: ChatMessage['attachment']; kind?: ChatMessage['kind']; text?: string; localActionNote?: string; billingCost?: 1 | 5; giftId?: CreditGiftId; appDataTicket?: AppDataTicket; rejectOnFailure?: boolean } = {}) => {
    if (deleting.current || !ready || active.current || mutationCount.current) { if(options.rejectOnFailure) throw new Error('请等待当前操作完成后再赠送礼物'); return }
    const role = selectedRef.current
    const isTemporary = temporaryRef.current
    if (options.appDataTicket && (isTemporary || role !== appDataIdentity().primaryId || options.giftId || options.attachment || options.localActionNote)) throw new Error('应用数据仅可由主 Bot 在普通文字会话中自动读取。')
    let appTicket = options.appDataTicket
    let appSources = appTicket ? appDataTicketSources(appTicket) : []
    const replyMode = currentReplyMode(role)
    const original = (isTemporary ? temporaryConversationsRef : conversationsRef).current[role]
    const persist = async (id: CharacterId, changed: ChatMessage[]) => {
      if (!isTemporary) return persistChatChanges(id, changed)
      const latest = temporaryConversationsRef.current[id]
      return [...latest.filter(message => !changed.some(item => item.id === message.id)), ...changed].sort((a, b) => a.id - b.id)
    }
    const target = options.retryId === undefined ? undefined : original.find(message => message.id === options.retryId && message.from === 'user' && !message.withdrawn)
    if (options.retryId !== undefined && !target) return
    const creditGiftId = target?.giftId ?? options.giftId
    const creditGift = creditGiftId ? getCreditGift(creditGiftId) : undefined
    if (creditGiftId && !creditGift) { const message='礼物无效，请重新选择';setError(message);if(options.rejectOnFailure)throw new Error(message);return }
    if (creditGift && !apiKey.trim()) { const message='请先在“我的”配置可用的模型服务，礼物包含一次 AI 回应';setError(message);if(options.rejectOnFailure)throw new Error(message);return }
    const inputText = creditGift ? giftMessage(creditGift.id, getLocale()) : options.text?.trim() ?? draft.trim()
    if (!target && !inputText && !options.attachment) return
    const replyToId = original.find(message => message.id === options.replyToId && !message.withdrawn && message.status !== 'sending')?.id
    const user: ChatMessage = target ? { ...target, status: 'sent' } : { id: nextId(original.reduce((maximum, message) => Math.max(maximum, message.id), 0)), from: 'user', text: inputText, time: new Date().toLocaleTimeString('zh-CN'), createdAt: new Date().toISOString(), status: 'sent', replyToId, kind: options.kind || 'text', attachment: options.attachment, ...(creditGift ? { giftId: creditGift.id } : {}) }
    if (options.appDataTicket) user.appDataRequest = true
    // Check videos before any write, including temporary sends that bypass the DB.
    if (user.kind === 'video' || user.attachment?.mimeType.startsWith('video/')) {
      if (!validLocalVideoAttachment(user.attachment)) { setError('请选择 20MB 以内的 MP4、WebM 或 MOV 视频'); return }
      user.kind = 'video'
    }
    // Retrying operates on exactly the original user turn; it never duplicates that turn.
    let records = target ? original.map(message => message.id === target.id ? user : message) : [...original, user]
    const controller = new AbortController(); active.current = controller; setReplying(true); setError('')
    let content = ''; let persisted = false
    const assistant: ChatMessage = { id: nextId(), from: 'character', text: '', time: new Date().toLocaleTimeString(getLocale()), createdAt: new Date().toISOString(), status: 'sending', ...(options.appDataTicket ? { localOnly: true, appDataReply: true } : {}) }
    try {
      records = await persist(role, [user]); persisted = true; apply(role, records); if (!target && !creditGift) setDraft('')
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      // Attachments are local-only: no false claim that a text model can hear or see them.
      if (user.attachment || user.kind === 'image' || user.kind === 'audio' || user.kind === 'video') { setError(isTemporary ? '附件仅保留在临时会话内，未落盘；文字模型不会读取图片、语音或视频。' : '附件已保存在本机；文字模型不会读取图片、语音或视频。请另发文字描述。'); return }
      // Route anaphoric followups only from adjacent earlier App-data turns.
      // A retry must never inherit a newer question or resurrect an old source
      // after unrelated conversation. Keep a short question-only chain for followups.
      const priorUsers = original.filter(message => message.from === 'user' && message.id < user.id && !message.withdrawn)
      const relatedQuestions: string[] = []
      for (const previous of priorUsers.slice().reverse()) {
        if (!previous.appDataRequest || relatedQuestions.length === 3) break
        relatedQuestions.unshift(previous.text)
      }
      const previousQuestion = relatedQuestions.join('\n')
      const catalogReply = !creditGift && !options.appDataTicket && !options.localActionNote
        ? installedAppsLocalReply(user.text, appDataIdentity(), resolveChatLocale(user.text)) ?? (!apiKey.trim() || isTemporary || role !== appDataIdentity().primaryId ? await appDataLocalReply(user.text, appDataIdentity(), resolveChatLocale(user.text), controller.signal, true, previousQuestion) : null)
        : null
      if (catalogReply !== null) {
        user.appDataRequest = true
        assistant.localOnly = true; assistant.appDataReply = true
        content = catalogReply
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
        const saved = await persist(role, [{ ...user, status: 'sent' }, { ...assistant, text: content, status: 'sent' }])
        apply(role, saved)
        return
      }
      if (!appTicket && !creditGift && !options.localActionNote && apiKey.trim() && !isTemporary && role === appDataIdentity().primaryId) {
        appTicket = await automaticAppDataTicket(user.text, appDataIdentity(), controller.signal, previousQuestion)
        if (appTicket) {
          appSources = appDataTicketSources(appTicket)
          user.appDataRequest = true
          assistant.localOnly = true; assistant.appDataReply = true
        }
      }
      await persist(role, [{ ...user, status: 'sending' }, assistant])
      apply(role, [...records, assistant])
      const history = target ? records.slice(0, records.findIndex(item => item.id === user.id) + 1) : records
      const forgotten = new Set(isTemporary ? [] : await forgottenSourceIds(role))
      // Retain exclusion provenance without passing private message contents downstream.
      const contextExcludedMessageIds = excludedMemorySourceIds(history, [...forgotten])
      let lastUserForgotten = false
      const context = history.filter(message => {
        if (message.from === 'user') lastUserForgotten = !!message.localOnly || !!message.withdrawn || forgotten.has(message.id)
        return !message.localOnly && !forgotten.has(message.id) && !lastUserForgotten
      }).map(message => message.id === user.id && options.localActionNote ? { ...message, text: `${message.text}\n[本机操作结果：${options.localActionNote}。请准确确认已经完成，不要声称无法执行。]` } : message)
      const recallMemories = isTemporary ? [] : await db.memories.toArray()
      const memorySources: MemoryRecallSources = {}
      if (!isTemporary) {
        // Source policies/privacy remain local and role-qualified; only recalled
        // confirmed facts, never another character's raw history, reach the model.
        await Promise.all(characters.map(async sourceRole => {
          const [sourceHistory, sourceForgotten, policy] = await Promise.all([
            loadRoleConversation(sourceRole.id), forgottenSourceIds(sourceRole.id), loadMemoryPolicy(sourceRole.id),
          ])
          const knownIds = new Set(sourceHistory.map(message => message.id))
          const missingIds = recallMemories.filter(memory => memory.characterId === sourceRole.id
            && memory.sourceMessageId !== undefined && !knownIds.has(memory.sourceMessageId)).map(memory => memory.sourceMessageId!)
          memorySources[sourceRole.id] = {
            policy,
            excludedSourceMessageIds: excludedMemorySourceIds(sourceHistory, missingIds),
            forgottenSourceMessageIds: excludedMemorySourceIds(sourceHistory, sourceForgotten),
          }
        }))
      }
      const replyContext = creditGift ? context.map(message => message.id === user.id ? { ...message, text: `${message.text}\n${giftResponseInstruction(creditGift.id, getLocale())}` } : message) : context
      await streamReply({ contextExcludedMessageIds, appDataTicket: appTicket, appDataIdentity, billingCost: creditGift?.cost ?? options.billingCost ?? 1, requireCompletion: !!creditGift || !!appTicket, locale: resolveChatLocale(user.text), characterId: role, replyMode, onboardingProfile: onboardingProfileRef.current, messages: replyContext, memories: recallMemories, memorySources, summaries: isTemporary ? [] : await loadSummaries(role), memoryPolicy: await loadMemoryPolicy(role), apiKey, endpoint, model, signal: controller.signal, onDelta: delta => { if (!content && appSources.length) content = getLocale() === 'en' ? `[App sources: ${appSources.join(', ')}]\n` : `【应用数据来源：${appSources.join('、')}】\n`; content += delta; apply(role, [...records, { ...assistant, text: content }]) } })
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
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
      if (options.rejectOnFailure) throw failure instanceof Error ? failure : new Error('礼物未送出，请重试')
    } finally { if (appTicket) discardAppDataTicket(appTicket); if (!isTemporary && persisted) queueOrganization(role); if (active.current === controller) { active.current = null; if (mounted.current) setReplying(false) } }
  }
  const saveConfirmed = async (memory: MemoryDraft) => {
    const role = selectedRef.current
    mutationCount.current++
    try {
    if (temporaryRef.current) throw new Error(t('临时会话不能保存长期记忆'))
    if ((policiesRef.current[selectedRef.current] || defaultMemoryPolicy).disabledCategories.includes(memory.category)) throw new Error(t('此类记忆已关闭'))
    await organization.current
    if (temporaryRef.current || role !== selectedRef.current) throw new Error('会话已切换，记忆未保存')
    if ((await loadMemoryPolicy(role)).disabledCategories.includes(memory.category)) throw new Error('此类记忆已关闭')
    const source = memory.sourceMessageId === undefined ? undefined : await db.messages.get([role, memory.sourceMessageId])
    if (memory.sourceMessageId !== undefined && (!source || source.withdrawn || source.localOnly || source.appDataReply)) throw new Error('原消息已撤回或不可用，记忆未保存')
    if (!memory.text.trim() || memory.text.trim().length > 1000) throw new Error('记忆内容需为 1–1000 字')
    const item: ConfirmedMemory = { ...memory, text: memory.text.trim(), id: crypto.randomUUID(), characterId: selectedRef.current, confirmedAt: new Date().toISOString(), enabled: true, state: 'confirmed', importance: 3, originalText: source?.text }
    const proposal = memoriesRef.current.find(existing => existing.characterId === item.characterId && existing.sourceMessageId === item.sourceMessageId && item.sourceMessageId !== undefined && existing.state === 'pending')
    if (proposal) { await updateMemory(proposal.id, { text: item.text, category: item.category }); await approveProposal(proposal.id); if ((await db.memories.get(proposal.id))?.state === 'pending') throw new Error(t('新信息仍待确认')); return }
    const existing = await db.memories.where('characterId').equals(role).toArray()
    const conflicts = conflictMemoryIds(item.text, existing, await loadMemoryPolicy(role))
    if (conflicts.length) {
      if (!window.confirm(t('这条记忆与{memories}冲突，确认以新信息替换并归档旧记忆？', { memories: existing.filter(memory => conflicts.includes(memory.id)).map(memory => memory.text).join('；') }))) throw new Error(t('已保留旧记忆'))
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
  return { prepareForDeletion: async () => { if (active.current || mutationCount.current || memoryLock.current) throw new Error('请先停止回复或等待保存'); deleting.current = true; try { await proactiveTask.current; await mutations.current; await Promise.all([...pendingWrites.current]); await organization.current } catch (failure) { deleting.current = false; throw failure } }, beforeDataChange: async () => { if (active.current || mutationCount.current) throw new Error('请先停止回复或等待保存'); invalidateAppDataAccess(); await organization.current }, summaries, policies, changePolicy: tracked(changePolicy), approveProposal: tracked(approveProposal), temporary, toggleTemporary, recordActivity, recordActivityFor, chatMessages: temporary ? temporaryConversations[selected] : conversations[selected], ready, loadError, reload: load, onboarded, finishOnboarding, selected, setSelected, conversations, setConversations, memories, setMemories, draft, setDraft, replying, error, apiKey, endpoint, model,
    appDataIdentity, onboardingProfile, updateOnboarding, setPrimary: (id: CharacterId) => observeWrite(changePrimary(id)),
    setApiKey: (value: string) => { invalidateAppDataAccess(); setKey(value); writePreference('sessionStorage', 'aily-api-key', value) },
    setEndpoint: (value: string) => { invalidateAppDataAccess(); modelConfigRef.current.endpoint = value; setEndpointState(value); writePreference('localStorage', 'aily-api-endpoint', value) }, setModel: (value: string) => { invalidateAppDataAccess(); modelConfigRef.current.model = value; setModelState(value); writePreference('localStorage', 'aily-api-model', value) },
    replyMode: currentReplyMode(selected), setReplyMode: tracked(changeReplyMode), modeSaving,
    send, stop: () => active.current?.abort(), saveConfirmed: tracked(saveConfirmed), editMemory: tracked(editMemory), removeMemory: tracked(removeMemory), clearMemories: tracked(clearMemories), withdraw }
}
