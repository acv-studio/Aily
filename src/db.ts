import { t } from './i18n'
import { notifyReminderChanges } from './reminderEvents'
import Dexie, { type EntityTable, type Table } from 'dexie'
import { characters, type CharacterId } from './data'
import { getCreditGift } from './creditGifts'
import { validLocalVideoAttachment, type ChatMessage, type ConfirmedMemory } from './chatService'
import { defaultOnboardingProfile, normalizeOnboardingProfile, onboardingMemoryId, onboardingMemoryText, validateOnboardingProfile, withoutAdultAuthorization, type OnboardingProfile } from './onboarding'
import { conflictMemoryIds, defaultMemoryPolicy, type ConversationSummary, type MemoryPolicy } from './longMemory'

type StoredMessage = ChatMessage & { characterId: CharacterId }
type Setting = { key: string; value: unknown }
export type LocalData = { conversations: Partial<Record<CharacterId, ChatMessage[]>>; memories: ConfirmedMemory[]; summaries?: ConversationSummary[]; settings: Record<string, unknown> }
const forgottenKey = (id: CharacterId) => `__forgotten:${id}`
const characterIds = ['lu', 'chen', 'gu'] as const
const legacyKey = 'aily-demo-state'
const migrationKey = '__legacyMigrated'
const conversationKey = (id: CharacterId) => `__conversation:${id}`
const backupError = () => new Error(t('不是有效的 Aily 备份文件'))

class AilyDatabase extends Dexie {
  messages!: Table<StoredMessage, [CharacterId, number]>
  memories!: EntityTable<ConfirmedMemory, 'id'>
  settings!: EntityTable<Setting, 'key'>
  summaries!: EntityTable<ConversationSummary, 'id'>

  constructor() {
    super('aily')
    this.version(1).stores({
      messages: 'id, characterId, time, status',
      memories: 'id, characterId, confirmedAt',
      settings: 'key',
    })
    // Dexie cannot alter a primary key in place. Copy to a new store before
    // Dexie removes the v1 store, all within the versionchange transaction.
    this.version(2).stores({
      messages: null,
      conversationMessages: '[characterId+id], characterId, time, status',
      memories: 'id, characterId, confirmedAt',
      settings: 'key',
    }).upgrade(async transaction => {
      const messages = await transaction.table<StoredMessage>('messages').toArray()
      await transaction.table('conversationMessages').bulkPut(messages)
    })
    this.version(3).stores({
      conversationMessages: '[characterId+id], characterId, time, status',
      memories: 'id, characterId, confirmedAt',
      settings: 'key',
      summaries: 'id, characterId, [characterId+period], updatedAt',
    })
    this.messages = this.table('conversationMessages')
  }
}

export const db = new AilyDatabase()

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function check(condition: unknown): asserts condition { if (!condition) throw backupError() }
function string(value: unknown, max: number, nonempty = false): value is string {
  return typeof value === 'string' && value.length <= max && (!nonempty || value.trim().length > 0)
}
function character(value: unknown): value is CharacterId { return characterIds.some(id => id === value) }
function messageId(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0 }
function timestamp(value: unknown): value is string { return string(value, 64, true) && Number.isFinite(Date.parse(value)) }
function isoTimestamp(value: unknown): value is string {
  return timestamp(value) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
}
function keys(value: Record<string, unknown>, allowed: string[]) { check(Object.keys(value).every(key => allowed.includes(key))) }
function optional(value: Record<string, unknown>, key: string, valid: (item: unknown) => boolean) {
  if (Object.hasOwn(value, key)) check(valid(value[key]))
}

// Optional fields created by the UI may be explicitly undefined. Store their
// canonical absent form, matching JSON backups without loosening import checks.
function definedFields<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function orderedMessages(messages: StoredMessage[]): ChatMessage[] {
  return messages.sort((left, right) => left.id - right.id)
    .map(({ characterId: _characterId, ...message }) => definedFields(message))
}

function validateMessage(value: unknown): ChatMessage {
  check(isRecord(value))
  keys(value, ['id', 'from', 'text', 'time', 'memory', 'status', 'replyToId', 'withdrawn', 'kind', 'attachment', 'createdAt', 'giftId', 'localOnly', 'appDataReply', 'appDataRequest'])
  check(messageId(value.id) && (value.from === 'user' || value.from === 'character'))
  check(string(value.text, 100_000) && string(value.time, 128))
  optional(value, 'memory', item => typeof item === 'boolean')
  optional(value, 'status', item => ['sending', 'sent', 'failed'].includes(item as string))
  optional(value, 'replyToId', messageId)
  optional(value, 'withdrawn', item => typeof item === 'boolean')
  optional(value, 'localOnly', item => typeof item === 'boolean')
  optional(value, 'appDataReply', item => typeof item === 'boolean')
  optional(value, 'appDataRequest', item => typeof item === 'boolean')
  if (value.appDataReply === true) check(value.from === 'character' && value.localOnly === true)
  if (value.appDataRequest === true) check(value.from === 'user')
  optional(value, 'createdAt', timestamp)
  optional(value, 'kind', item => ['text', 'image', 'audio', 'video'].includes(item as string))
  optional(value, 'attachment', validAttachment)
  optional(value, 'giftId', item => typeof item === 'string' && !!getCreditGift(item) && value.from === 'user')
  // Withdrawals deliberately retain the kind while removing the attachment.
  if (value.kind === 'video') check(validLocalVideoAttachment(value.attachment) || value.withdrawn === true && !Object.hasOwn(value, 'attachment'))
  if (isRecord(value.attachment) && typeof value.attachment.mimeType === 'string' && value.attachment.mimeType.startsWith('video/')) check(value.kind === 'video')
  return { ...value } as ChatMessage
}

function validAttachment(value: unknown): boolean {
  if (!isRecord(value)) return false
  keys(value, ['name', 'mimeType', 'dataUrl'])
  if (validLocalVideoAttachment(value)) return true
  // Preserve the existing image/audio data-URL cap; video has its own byte cap.
  return string(value.name, 512, true) && string(value.mimeType, 128, true)
    && /^(image|audio)\/[a-z0-9.+-]+$/i.test(value.mimeType)
    && string(value.dataUrl, 10_000_000, true)
    && value.dataUrl.startsWith(`data:${value.mimeType};base64,`)
    && /^[a-z0-9+/]*={0,2}$/i.test(value.dataUrl.slice(value.dataUrl.indexOf(',') + 1))
}

function validateMemory(value: unknown): ConfirmedMemory {
  check(isRecord(value))
  keys(value, ['id', 'characterId', 'text', 'confirmedAt', 'category', 'sourceMessageId', 'updatedAt', 'enabled', 'state', 'importance', 'pinned', 'expiresAt', 'originalText', 'sensitive', 'conflictIds', 'topics', 'language'])
  check(string(value.id, 256, true) && character(value.characterId) && string(value.text, 10_000, true) && timestamp(value.confirmedAt))
  optional(value, 'category', item => ['profile', 'relationship', 'context', 'emotion'].includes(item as string))
  optional(value, 'sourceMessageId', messageId)
  optional(value, 'updatedAt', timestamp)
  optional(value, 'enabled', item => typeof item === 'boolean')
  optional(value, 'state', item => ['pending', 'confirmed', 'archived', 'rejected'].includes(item as string))
  optional(value, 'importance', item => Number.isInteger(item) && (item as number) >= 1 && (item as number) <= 5)
  optional(value, 'pinned', item => typeof item === 'boolean')
  optional(value, 'expiresAt', isoTimestamp)
  optional(value, 'originalText', item => string(item, 10_000))
  optional(value, 'sensitive', item => typeof item === 'boolean')
  optional(value, 'conflictIds', item => stringArray(item, 256))
  optional(value, 'topics', item => stringArray(item, 256))
  optional(value, 'language', item => ['zh-CN', 'en', 'mixed'].includes(item as string))
  return { ...value } as ConfirmedMemory
}

function stringArray(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= 1_000 && value.every(item => string(item, max, true))
}
function sourceIds(value: unknown): value is number[] {
  return Array.isArray(value) && value.length <= 100_000 && value.every(messageId) && new Set(value).size === value.length
}
function validateSummary(value: unknown): ConversationSummary {
  check(isRecord(value))
  keys(value, ['id', 'characterId', 'period', 'periodKey', 'text', 'sourceMessageIds', 'updatedAt'])
  check(string(value.id, 256, true) && character(value.characterId))
  check(['day', 'week', 'month', 'year'].includes(value.period as string))
  check(string(value.periodKey, 128, true) && string(value.text, 100_000, true))
  check(sourceIds(value.sourceMessageIds) && timestamp(value.updatedAt))
  return { ...value, sourceMessageIds: [...value.sourceMessageIds] } as ConversationSummary
}
function validatePolicy(value: unknown): MemoryPolicy {
  check(isRecord(value))
  keys(value, ['disabledCategories', 'extractionEnabled'])
  check(Array.isArray(value.disabledCategories) && value.disabledCategories.length <= 4)
  check(value.disabledCategories.every(item => ['profile', 'relationship', 'context', 'emotion'].includes(item as string)))
  check(new Set(value.disabledCategories).size === value.disabledCategories.length && typeof value.extractionEnabled === 'boolean')
  return { disabledCategories: [...value.disabledCategories], extractionEnabled: value.extractionEnabled } as MemoryPolicy
}
function validatePolicies(value: unknown): Partial<Record<CharacterId, MemoryPolicy>> {
  check(isRecord(value))
  const result: Partial<Record<CharacterId, MemoryPolicy>> = {}
  for (const [id, policy] of Object.entries(value)) {
    check(character(id)); result[id] = validatePolicy(policy)
  }
  return result
}
function validateSettings(value: unknown, version = 1): Record<string, unknown> {
  check(isRecord(value))
  // Credentials, endpoints and arbitrary provider configuration are never backups.
  keys(value, ['onboarded', 'selected', 'onboardingProfile', ...(version === 2 ? ['memoryPolicies', ...characterIds.map(forgottenKey)] : [])])
  optional(value, 'onboarded', item => typeof item === 'boolean')
  optional(value, 'selected', character)
  const result = { ...value }
  if (Object.hasOwn(value, 'onboardingProfile')) result.onboardingProfile = withoutAdultAuthorization(validateOnboardingProfile(value.onboardingProfile))
  if (Object.hasOwn(value, 'memoryPolicies')) result.memoryPolicies = validatePolicies(value.memoryPolicies)
  for (const id of characterIds) optional(value, forgottenKey(id), sourceIds)
  return result
}

function validateData(conversations: unknown, memories: unknown, settings: unknown, summaries: unknown = [], version = 1): LocalData {
  check(isRecord(conversations) && Array.isArray(memories) && Array.isArray(summaries) && summaries.length <= 100_000)
  const summaryIds = new Set<string>()
  const validatedSummaries = summaries.map(item => {
    const summary = validateSummary(item)
    check(!summaryIds.has(summary.id)); summaryIds.add(summary.id)
    return summary
  })
  const result: LocalData = { conversations: {}, memories: [], summaries: validatedSummaries, settings: validateSettings(settings, version) }
  for (const [id, items] of Object.entries(conversations)) {
    check(character(id) && Array.isArray(items) && items.length <= 100_000)
    const seen = new Set<number>()
    result.conversations[id] = items.map(item => {
      const message = validateMessage(item)
      check(!seen.has(message.id)); seen.add(message.id)
      return message
    })
  }
  check(memories.length <= 100_000)
  const seen = new Set<string>()
  result.memories = memories.map(item => {
    const memory = validateMemory(item)
    check(!seen.has(memory.id)); seen.add(memory.id)
    return memory
  })
  return result
}

export async function loadLocalData(): Promise<LocalData> {
  return db.transaction('rw', db.messages, db.memories, db.settings, db.summaries, async () => {
    const [messages, memories, settings, summaries] = await Promise.all([
      db.messages.toArray(), db.memories.toArray(), db.settings.toArray(), db.summaries.toArray(),
    ])
    const interrupted = messages.filter(message => message.status === 'sending')
    if (interrupted.length) await db.messages.bulkPut(interrupted.map(message => ({ ...message, status: 'failed' as const })))
    const conversations: LocalData['conversations'] = {}
    for (const id of characterIds) {
      if (settings.some(item => item.key === conversationKey(id))) conversations[id] = []
    }
    for (const { characterId, ...message } of messages) {
      if (message.status === 'sending') message.status = 'failed'
      ;(conversations[characterId] ||= []).push(definedFields(message))
    }
    for (const messages of Object.values(conversations)) messages.sort((left, right) => left.id - right.id)
    const loadedSettings = Object.fromEntries(settings.filter(item => !item.key.startsWith('__') || characterIds.some(id => item.key === forgottenKey(id))).map(item => [item.key, item.value]))
    if (Object.hasOwn(loadedSettings, 'onboardingProfile')) loadedSettings.onboardingProfile = normalizeOnboardingProfile(loadedSettings.onboardingProfile)
    return { conversations, memories: memories.map(definedFields), summaries, settings: loadedSettings }
  })
}

/** Migrate the demo only once, never overwriting an authoritative DB, even if empty. */
export async function initializeLocalData(): Promise<LocalData> {
  let raw: string | null = null
  try { raw = globalThis.localStorage?.getItem(legacyKey) ?? null } catch { /* Storage may be disabled. */ }
  let legacy: LocalData | undefined
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw)
      check(isRecord(parsed))
      keys(parsed, ['conversations', 'confirmedMemories', 'onboarded', 'selected'])
      const settings: Record<string, unknown> = {}
      for (const key of ['onboarded', 'selected']) if (Object.hasOwn(parsed, key)) settings[key] = parsed[key]
      legacy = validateData(parsed.conversations ?? {}, parsed.confirmedMemories ?? [], settings)
    } catch { return loadLocalData() } // Leave invalid data intact for recovery.
  }
  let completed = false
  await db.transaction('rw', db.messages, db.memories, db.settings, db.summaries, async () => {
    if (await db.settings.get(migrationKey)) return
    const populated = (await db.messages.count()) + (await db.memories.count()) + (await db.settings.count()) + (await db.summaries.count()) > 0
    if (!populated && legacy) await putData(legacy)
    await db.settings.put({ key: migrationKey, value: true })
    completed = true
  })
  // localStorage cannot participate in IndexedDB rollback. Delete only after commit.
  if (completed && raw !== null) {
    try { globalThis.localStorage?.removeItem(legacyKey) } catch { /* Marker prevents retry. */ }
  }
  return loadLocalData()
}

async function putData(data: LocalData) {
  for (const [id, messages] of Object.entries(data.conversations)) {
    const characterId = id as CharacterId
    await db.messages.bulkPut(messages.map(message => ({ ...definedFields(message), characterId })))
    await db.settings.put({ key: conversationKey(characterId), value: true })
  }
  await db.memories.bulkPut(data.memories)
  await db.summaries.bulkPut(data.summaries ?? [])
  await db.settings.bulkPut(Object.entries(data.settings).map(([key, value]) => ({ key, value })))
}

export async function saveConversation(characterId: CharacterId, messages: ChatMessage[]) {
  await db.transaction('rw', db.messages, db.settings, async () => {
    await db.messages.where('characterId').equals(characterId).delete()
    await db.messages.bulkPut(messages.map(message => ({ ...definedFields(message), characterId })))
    await db.settings.put({ key: conversationKey(characterId), value: true })
  })
}

/** Read current history without treating a live request as an interrupted send. */
export async function loadRoleConversation(characterId: CharacterId): Promise<ChatMessage[]> {
  return orderedMessages(await db.messages.where('characterId').equals(characterId).toArray())
}

/** Upsert only changed records so a stale UI snapshot cannot delete newer turns. */
export async function persistChatChanges(characterId: CharacterId, records: ChatMessage[]): Promise<ChatMessage[]> {
  check(character(characterId))
  const messages = records.map(record => validateMessage(definedFields(record)))
  return db.transaction('rw', db.messages, db.settings, async () => {
    await db.messages.bulkPut(messages.map(message => ({ ...message, characterId })))
    await db.settings.put({ key: conversationKey(characterId), value: true })
    return loadRoleConversation(characterId)
  })
}

export async function saveMemory(memory: ConfirmedMemory) {
  await db.transaction('rw', db.memories, db.settings, async () => {
    await db.memories.put(definedFields(memory))
    await db.settings.put({ key: migrationKey, value: true })
  })
}
export async function updateMemory(id: string, patch: string | Partial<ConfirmedMemory>) {
  const changes = typeof patch === 'string' ? { text: patch } : patch
  const { id: _id, characterId: _characterId, ...editable } = changes as Partial<ConfirmedMemory>
  await db.transaction('rw', db.memories, db.settings, db.summaries, async () => {
    const old = await db.memories.get(id)
    if (!old) return
    const updated = validateMemory(definedFields({ ...old, ...editable, updatedAt: new Date().toISOString() }))
    if (updated.text !== old.text || (updated.enabled === false && old.enabled !== false) || updated.state === 'archived' || updated.state === 'rejected') {
      await forgetSources(old.characterId, old.sourceMessageId === undefined ? [] : [old.sourceMessageId])
      await db.summaries.where('characterId').equals(old.characterId).delete()
    }
    await db.memories.put(updated)
  })
}

export async function forgottenSourceIds(characterId: CharacterId): Promise<number[]> {
  check(character(characterId))
  const value = (await db.settings.get(forgottenKey(characterId)))?.value
  if (value === undefined) return []
  check(sourceIds(value))
  return [...value]
}
async function forgetSources(characterId: CharacterId, ids: number[]) {
  const forgotten = await forgottenSourceIds(characterId)
  await db.settings.put({ key: forgottenKey(characterId), value: [...new Set([...forgotten, ...ids])].sort((a, b) => a - b) })
}
export async function deleteMemory(id: string) {
  await db.transaction('rw', db.memories, db.settings, db.summaries, async () => {
    const memory = await db.memories.get(id)
    if (memory) {
      await forgetSources(memory.characterId, memory.sourceMessageId === undefined ? [] : [memory.sourceMessageId])
      await db.summaries.where('characterId').equals(memory.characterId).delete()
      await db.memories.delete(id)
    }
    await db.settings.put({ key: migrationKey, value: true })
  })
}

export async function loadSummaries(characterId: CharacterId): Promise<ConversationSummary[]> {
  check(character(characterId))
  return db.summaries.where('characterId').equals(characterId).toArray()
}
export async function saveSummaries(characterId: CharacterId, summaries: ConversationSummary[], expectedPolicy?: MemoryPolicy) {
  check(character(characterId))
  const validated = summaries.map(summary => validateSummary(definedFields(summary)))
  check(validated.every(summary => summary.characterId === characterId) && new Set(validated.map(summary => summary.id)).size === validated.length)
  await db.transaction('rw', db.summaries, db.settings, async () => {
    if (expectedPolicy) check(JSON.stringify(await loadMemoryPolicy(characterId)) === JSON.stringify(expectedPolicy))
    const forgotten = new Set(await forgottenSourceIds(characterId))
    check(validated.every(summary => summary.sourceMessageIds.every(id => !forgotten.has(id))))
    for (const summary of validated) {
      const existing = await db.summaries.get(summary.id)
      check(!existing || existing.characterId === characterId)
    }
    await db.summaries.where('characterId').equals(characterId).delete()
    await db.summaries.bulkPut(validated)
    await db.settings.put({ key: migrationKey, value: true })
  })
}
export async function loadMemoryPolicy(characterId: CharacterId): Promise<MemoryPolicy> {
  check(character(characterId))
  const policies = (await db.settings.get('memoryPolicies'))?.value
  return validatePolicy(isRecord(policies) && policies[characterId] !== undefined ? policies[characterId] : defaultMemoryPolicy)
}
export async function saveMemoryPolicy(characterId: CharacterId, policy: MemoryPolicy) {
  check(character(characterId))
  const validated = validatePolicy(policy)
  await db.transaction('rw', db.settings, db.summaries, async () => {
    const current = (await db.settings.get('memoryPolicies'))?.value
    const policies = current === undefined ? {} : validatePolicies(current)
    await db.settings.put({ key: 'memoryPolicies', value: { ...policies, [characterId]: validated } })
    await db.summaries.where('characterId').equals(characterId).delete()
    await db.settings.put({ key: migrationKey, value: true })
  })
}
export async function saveProposals(candidates: ConfirmedMemory[]) {
  const validated = candidates.map(candidate => validateMemory(definedFields(candidate)))
  await db.transaction('rw', db.memories, db.settings, async () => {
    await db.memories.toCollection().modify(memory => { if (memory.state === 'pending') { memory.state = 'confirmed'; memory.enabled = true } })
    for (const candidate of validated) {
      const policy = await loadMemoryPolicy(candidate.characterId)
      if (!policy.extractionEnabled || policy.disabledCategories.includes(candidate.category || 'profile') || (await forgottenSourceIds(candidate.characterId)).includes(candidate.sourceMessageId!)) continue
      if (!(await db.memories.get(candidate.id))) {
        const existing = await db.memories.where('characterId').equals(candidate.characterId).toArray()
        const conflicts = conflictMemoryIds(candidate.text, existing, policy)
        const now = new Date().toISOString()
        for (const conflictId of conflicts) {
          const old = existing.find(memory => memory.id === conflictId)
          if (old) await db.memories.put({ ...old, state: 'archived', enabled: false, updatedAt: now })
        }
        await db.memories.add({ ...candidate, state: 'confirmed', enabled: true, conflictIds: conflicts })
      }
    }
    await db.settings.put({ key: migrationKey, value: true })
  })
}
export async function confirmProposal(id: string, expectedConflictIds?: string[]): Promise<ConfirmedMemory | undefined> {
  return db.transaction('rw', db.memories, db.settings, db.summaries, async () => {
    const candidate = await db.memories.get(id)
    if (!candidate || candidate.state !== 'pending') return candidate
    const policy = await loadMemoryPolicy(candidate.characterId)
    check(!policy.disabledCategories.includes(candidate.category || 'profile'))
    if (expectedConflictIds !== undefined) {
      const actual = conflictMemoryIds(candidate.text, await db.memories.where('characterId').equals(candidate.characterId).toArray(), policy).sort()
      check(JSON.stringify(actual) === JSON.stringify([...expectedConflictIds].sort()))
    }
    const now = new Date().toISOString()
    for (const conflictId of expectedConflictIds ?? candidate.conflictIds ?? []) {
      if (conflictId === id) continue
      const old = await db.memories.get(conflictId)
      if (!old || old.characterId !== candidate.characterId) continue
      await db.memories.put({ ...old, state: 'archived', enabled: false, updatedAt: now })
      await forgetSources(old.characterId, old.sourceMessageId === undefined ? [] : [old.sourceMessageId])
    }
    await db.summaries.where('characterId').equals(candidate.characterId).delete()
    const confirmed: ConfirmedMemory = { ...candidate, ...(expectedConflictIds !== undefined ? { conflictIds: expectedConflictIds } : {}), state: 'confirmed', enabled: true, confirmedAt: now, updatedAt: now }
    await db.memories.put(confirmed)
    await db.settings.put({ key: migrationKey, value: true })
    return confirmed
  })
}
export async function archiveExpiredMemories(now: Date | string | number = new Date()): Promise<number> {
  const time = new Date(now).getTime()
  check(Number.isFinite(time))
  return db.transaction('rw', db.memories, db.settings, db.summaries, async () => {
    const expired = (await db.memories.toArray()).filter(memory => memory.expiresAt && Date.parse(memory.expiresAt) <= time && (memory.state === undefined || memory.state === 'confirmed' || memory.state === 'pending'))
    for (const memory of expired) {
      await db.memories.put({ ...memory, state: 'archived', enabled: false, updatedAt: new Date(time).toISOString() })
      await forgetSources(memory.characterId, memory.sourceMessageId === undefined ? [] : [memory.sourceMessageId])
      await db.summaries.where('characterId').equals(memory.characterId).delete()
    }
    return expired.length
  })
}
export async function saveSetting(key: string, value: unknown) { await db.settings.put({ key, value }) }

export type OnboardingSaveResult = { profile: OnboardingProfile; memory?: ConfirmedMemory; memories: ConfirmedMemory[]; messages: ChatMessage[] }

/** One commit for primary role, preferences, first confirmed memory and local trial. */
async function persistOnboarding(value: OnboardingProfile, trial: ChatMessage[], finish: boolean): Promise<OnboardingSaveResult> {
  const profile = validateOnboardingProfile(value)
  const messages = trial.map(item => validateMessage(definedFields(item)))
  check(messages.length <= 100 && new Set(messages.map(item => item.id)).size === messages.length)
  return db.transaction('rw', db.settings, db.memories, db.messages, async () => {
    const alreadyFinished = (await db.settings.get('onboarded'))?.value === true
    if (!finish && !alreadyFinished) throw new Error(t('请先完成首次引导'))
    const id = onboardingMemoryId(profile.characterId)
    const old = await db.memories.get(id)
    const previous = normalizeOnboardingProfile((await db.settings.get('onboardingProfile'))?.value)
    const namesChanged = !previous || previous.characterId !== profile.characterId || previous.userName !== profile.userName || previous.characterName !== profile.characterName || previous.familiarNames !== profile.familiarNames
    const now = new Date().toISOString()
    let memory = old
    if (finish && !alreadyFinished) {
      memory = old ? { ...old, text: onboardingMemoryText(profile), updatedAt: now } : {
        id, characterId: profile.characterId, text: onboardingMemoryText(profile),
        category: 'relationship', state: 'confirmed', enabled: true, importance: 3, confirmedAt: now,
      }
      await db.memories.put(memory)
    } else if (old && namesChanged) {
      // Changing names does not undo explicit pause/archive/expiry/pinning choices.
      memory = { ...old, text: onboardingMemoryText(profile), updatedAt: now }
      await db.memories.put(memory)
    }
    // Preference-only changes preserve manual content; deleted memories stay deleted.
    // Retrying a completed finish or changing settings never adds trial turns.
    if (finish && !alreadyFinished) {
      for (const message of messages) check(!(await db.messages.get([profile.characterId, message.id])))
      await db.messages.bulkPut(messages.map(message => ({ ...message, characterId: profile.characterId })))
      await db.settings.put({ key: conversationKey(profile.characterId), value: true })
    }
    await db.settings.bulkPut([
      { key: 'onboardingProfile', value: profile }, ...(finish ? [{ key: 'selected', value: profile.characterId }] : []),
      { key: 'onboarded', value: true }, { key: migrationKey, value: true },
    ])
    return { profile, ...(memory ? { memory } : {}), memories: await db.memories.toArray(), messages: await loadRoleConversation(profile.characterId) }
  })
}

export async function finishOnboarding(profile: OnboardingProfile, messages: ChatMessage[] = []): Promise<OnboardingSaveResult> {
  return persistOnboarding(profile, messages, true)
}
export async function updateOnboarding(profile: OnboardingProfile): Promise<OnboardingSaveResult> {
  return persistOnboarding(profile, [], false)
}

/** Switch the default and active role together without rewriting any conversation or memory. */
export async function setPrimaryCharacter(id: CharacterId): Promise<OnboardingProfile> {
  const role = characters.find(character => character.id === id)
  if (!role) throw new Error(t('请选择有效角色'))
  return db.transaction('rw', db.settings, async () => {
    if ((await db.settings.get('onboarded'))?.value !== true) throw new Error(t('请先完成首次引导'))
    const previous = normalizeOnboardingProfile((await db.settings.get('onboardingProfile'))?.value)
    const profile = validateOnboardingProfile({
      ...(previous || defaultOnboardingProfile(id)),
      characterId: id,
      characterName: previous?.characterId === id ? previous.characterName : role.name,
    })
    await db.settings.bulkPut([
      { key: 'onboardingProfile', value: profile },
      { key: 'selected', value: id },
    ])
    return profile
  })
}

export async function exportData() {
  const data = await loadLocalData()
  const settings: Record<string, unknown> = {}
  if (typeof data.settings.onboarded === 'boolean') settings.onboarded = data.settings.onboarded
  if (character(data.settings.selected)) settings.selected = data.settings.selected
  if (data.settings.onboardingProfile != null) settings.onboardingProfile = withoutAdultAuthorization(validateOnboardingProfile(data.settings.onboardingProfile))
  if (data.settings.memoryPolicies !== undefined) settings.memoryPolicies = validatePolicies(data.settings.memoryPolicies)
  for (const id of characterIds) {
    const ids = data.settings[forgottenKey(id)]
    if (ids !== undefined) { check(sourceIds(ids)); settings[forgottenKey(id)] = ids }
  }
  return JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), ...data, summaries: data.summaries ?? [], settings })
}

export async function importData(raw: string) {
  let data: LocalData
  try {
    const parsed: unknown = JSON.parse(raw)
    check(isRecord(parsed))
    check(parsed.version === 1 || parsed.version === 2)
    keys(parsed, ['version', 'exportedAt', 'conversations', 'memories', 'settings', ...(parsed.version === 2 ? ['summaries'] : [])])
    optional(parsed, 'exportedAt', timestamp)
    data = validateData(parsed.conversations, parsed.memories, Object.hasOwn(parsed, 'settings') ? parsed.settings : {}, parsed.version === 2 && Object.hasOwn(parsed, 'summaries') ? parsed.summaries : [], parsed.version)
    for (const summary of data.summaries ?? []) {
      const forgotten = new Set((data.settings[forgottenKey(summary.characterId)] as number[] | undefined) ?? [])
      check(summary.sourceMessageIds.every(id => !forgotten.has(id)))
    }
  } catch { throw backupError() }
  // Every field and duplicate key is checked before any destructive operation.
  await (await import('./reminderNotifications')).cancelReminderNotificationsForReset()
  await db.transaction('rw', db.messages, db.memories, db.settings, db.summaries, async () => {
    await Promise.all([db.messages.clear(), db.memories.clear(), db.settings.clear(), db.summaries.clear()])
    await putData(data)
    for (const id of characterIds) await db.settings.put({ key: conversationKey(id), value: true })
    await db.settings.put({ key: migrationKey, value: true })
  })
  notifyReminderChanges()
  return loadLocalData()
}

export async function clearCharacterMemories(characterId: CharacterId) {
  check(character(characterId))
  await db.transaction('rw', db.messages, db.memories, db.settings, db.summaries, async () => {
    const memories = await db.memories.where('characterId').equals(characterId).toArray()
    const summaries = await loadSummaries(characterId)
    const messages = await db.messages.where('characterId').equals(characterId).toArray()
    await forgetSources(characterId, [...messages.map(item => item.id), ...memories.flatMap(item => item.sourceMessageId === undefined ? [] : [item.sourceMessageId]), ...summaries.flatMap(item => item.sourceMessageIds)])
    await db.memories.where('characterId').equals(characterId).delete()
    await db.summaries.where('characterId').equals(characterId).delete()
    await db.settings.put({ key: migrationKey, value: true })
  })
}

export async function clearCharacterData(characterId: CharacterId) {
  await db.transaction('rw', db.messages, db.memories, db.settings, db.summaries, async () => {
    await db.messages.where('characterId').equals(characterId).delete()
    await db.memories.where('characterId').equals(characterId).delete()
    await db.summaries.where('characterId').equals(characterId).delete()
    await db.settings.delete(forgottenKey(characterId))
    await db.settings.put({ key: conversationKey(characterId), value: true })
    await db.settings.put({ key: migrationKey, value: true })
  })
}

export async function clearAllData() {
  await (await import('./reminderNotifications')).cancelReminderNotificationsForReset()
  await db.transaction('rw', db.messages, db.memories, db.settings, db.summaries, async () => {
    await Promise.all([db.messages.clear(), db.memories.clear(), db.settings.clear(), db.summaries.clear()])
    for (const id of characterIds) await db.settings.put({ key: conversationKey(id), value: true })
    await db.settings.put({ key: migrationKey, value: true })
  })
  notifyReminderChanges()
}
