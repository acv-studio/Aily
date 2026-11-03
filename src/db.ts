import Dexie, { type EntityTable, type Table } from 'dexie'
import type { CharacterId } from './data'
import type { ChatMessage, ConfirmedMemory } from './chatService'

type StoredMessage = ChatMessage & { characterId: CharacterId }
type Setting = { key: string; value: unknown }
type LocalData = { conversations: Partial<Record<CharacterId, ChatMessage[]>>; memories: ConfirmedMemory[]; settings: Record<string, unknown> }
const characterIds = ['lu', 'chen', 'gu'] as const
const legacyKey = 'aily-demo-state'
const migrationKey = '__legacyMigrated'
const conversationKey = (id: CharacterId) => `__conversation:${id}`
const backupError = () => new Error('不是有效的 Aily 备份文件')

class AilyDatabase extends Dexie {
  messages!: Table<StoredMessage, [CharacterId, number]>
  memories!: EntityTable<ConfirmedMemory, 'id'>
  settings!: EntityTable<Setting, 'key'>

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
  keys(value, ['id', 'from', 'text', 'time', 'memory', 'status', 'replyToId', 'withdrawn', 'kind', 'attachment', 'createdAt'])
  check(messageId(value.id) && (value.from === 'user' || value.from === 'character'))
  check(string(value.text, 100_000) && string(value.time, 128))
  optional(value, 'memory', item => typeof item === 'boolean')
  optional(value, 'status', item => ['sending', 'sent', 'failed'].includes(item as string))
  optional(value, 'replyToId', messageId)
  optional(value, 'withdrawn', item => typeof item === 'boolean')
  optional(value, 'createdAt', timestamp)
  optional(value, 'kind', item => ['text', 'image', 'audio'].includes(item as string))
  optional(value, 'attachment', validAttachment)
  return { ...value } as ChatMessage
}

function validAttachment(value: unknown): boolean {
  if (!isRecord(value)) return false
  keys(value, ['name', 'mimeType', 'dataUrl'])
  return string(value.name, 512, true) && string(value.mimeType, 128, true)
    && /^(image|audio)\/[a-z0-9.+-]+$/i.test(value.mimeType)
    && string(value.dataUrl, 10_000_000, true)
    && value.dataUrl.startsWith(`data:${value.mimeType};base64,`)
    && /^[a-z0-9+/]*={0,2}$/i.test(value.dataUrl.slice(value.dataUrl.indexOf(',') + 1))
}

function validateMemory(value: unknown): ConfirmedMemory {
  check(isRecord(value))
  keys(value, ['id', 'characterId', 'text', 'confirmedAt', 'category', 'sourceMessageId', 'updatedAt', 'enabled'])
  check(string(value.id, 256, true) && character(value.characterId) && string(value.text, 10_000, true) && timestamp(value.confirmedAt))
  optional(value, 'category', item => ['profile', 'relationship', 'context', 'emotion'].includes(item as string))
  optional(value, 'sourceMessageId', messageId)
  optional(value, 'updatedAt', timestamp)
  optional(value, 'enabled', item => typeof item === 'boolean')
  return { ...value } as ConfirmedMemory
}

function validateSettings(value: unknown): Record<string, unknown> {
  check(isRecord(value))
  // Credentials, endpoints and arbitrary provider configuration are never backups.
  keys(value, ['onboarded', 'selected'])
  optional(value, 'onboarded', item => typeof item === 'boolean')
  optional(value, 'selected', character)
  return { ...value }
}

function validateData(conversations: unknown, memories: unknown, settings: unknown): LocalData {
  check(isRecord(conversations) && Array.isArray(memories))
  const result: LocalData = { conversations: {}, memories: [], settings: validateSettings(settings) }
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
  return db.transaction('rw', db.messages, db.memories, db.settings, async () => {
    const [messages, memories, settings] = await Promise.all([
      db.messages.toArray(), db.memories.toArray(), db.settings.toArray(),
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
    return { conversations, memories: memories.map(definedFields), settings: Object.fromEntries(settings.filter(item => !item.key.startsWith('__')).map(item => [item.key, item.value])) }
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
  await db.transaction('rw', db.messages, db.memories, db.settings, async () => {
    if (await db.settings.get(migrationKey)) return
    const populated = (await db.messages.count()) + (await db.memories.count()) + (await db.settings.count()) > 0
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
  await db.memories.update(id, { ...editable, updatedAt: new Date().toISOString() })
}
export async function deleteMemory(id: string) {
  await db.transaction('rw', db.memories, db.settings, async () => {
    await db.memories.delete(id)
    await db.settings.put({ key: migrationKey, value: true })
  })
}
export async function saveSetting(key: string, value: unknown) { await db.settings.put({ key, value }) }

export async function exportData() {
  const data = await loadLocalData()
  const settings: Record<string, unknown> = {}
  if (typeof data.settings.onboarded === 'boolean') settings.onboarded = data.settings.onboarded
  if (character(data.settings.selected)) settings.selected = data.settings.selected
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...data, settings })
}

export async function importData(raw: string) {
  let data: LocalData
  try {
    const parsed: unknown = JSON.parse(raw)
    check(isRecord(parsed))
    keys(parsed, ['version', 'exportedAt', 'conversations', 'memories', 'settings'])
    check(parsed.version === 1)
    optional(parsed, 'exportedAt', timestamp)
    data = validateData(parsed.conversations, parsed.memories, parsed.settings ?? {})
  } catch { throw backupError() }
  // Every field and duplicate key is checked before any destructive operation.
  await db.transaction('rw', db.messages, db.memories, db.settings, async () => {
    await Promise.all([db.messages.clear(), db.memories.clear(), db.settings.clear()])
    await putData(data)
    for (const id of characterIds) await db.settings.put({ key: conversationKey(id), value: true })
    await db.settings.put({ key: migrationKey, value: true })
  })
  return loadLocalData()
}

export async function clearCharacterMemories(characterId: CharacterId) {
  await db.transaction('rw', db.memories, db.settings, async () => {
    await db.memories.where('characterId').equals(characterId).delete()
    await db.settings.put({ key: migrationKey, value: true })
  })
}

export async function clearCharacterData(characterId: CharacterId) {
  await db.transaction('rw', db.messages, db.memories, db.settings, async () => {
    await db.messages.where('characterId').equals(characterId).delete()
    await db.memories.where('characterId').equals(characterId).delete()
    await db.settings.put({ key: conversationKey(characterId), value: true })
    await db.settings.put({ key: migrationKey, value: true })
  })
}

export async function clearAllData() {
  await db.transaction('rw', db.messages, db.memories, db.settings, async () => {
    await Promise.all([db.messages.clear(), db.memories.clear(), db.settings.clear()])
    for (const id of characterIds) await db.settings.put({ key: conversationKey(id), value: true })
    await db.settings.put({ key: migrationKey, value: true })
  })
}
