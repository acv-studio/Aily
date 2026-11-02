import Dexie, { type EntityTable } from 'dexie'
import type { CharacterId } from './data'
import type { ChatMessage, ConfirmedMemory } from './chatService'

type StoredMessage = ChatMessage & { characterId: CharacterId }

type Setting = { key: string; value: unknown }

class AilyDatabase extends Dexie {
  messages!: EntityTable<StoredMessage, 'id'>
  memories!: EntityTable<ConfirmedMemory, 'id'>
  settings!: EntityTable<Setting, 'key'>

  constructor() {
    super('aily')
    this.version(1).stores({
      messages: 'id, characterId, time, status',
      memories: 'id, characterId, confirmedAt',
      settings: 'key',
    })
  }
}

export const db = new AilyDatabase()

export async function loadLocalData() {
  const [messages, memories, settings] = await Promise.all([
    db.messages.toArray(), db.memories.toArray(), db.settings.toArray(),
  ])
  const conversations = messages.reduce<Partial<Record<CharacterId, ChatMessage[]>>>((result, message) => {
    const { characterId, ...chatMessage } = message
    result[characterId] = [...(result[characterId] || []), chatMessage]
    return result
  }, {})
  return { conversations, memories, settings: Object.fromEntries(settings.map(item => [item.key, item.value])) }
}

export async function saveConversation(characterId: CharacterId, messages: ChatMessage[]) {
  await db.transaction('rw', db.messages, async () => {
    await db.messages.where('characterId').equals(characterId).delete()
    await db.messages.bulkPut(messages.map(message => ({ ...message, characterId })))
  })
}

export async function saveMemory(memory: ConfirmedMemory) { await db.memories.put(memory) }
export async function updateMemory(id: string, text: string) { await db.memories.update(id, { text }) }
export async function deleteMemory(id: string) { await db.memories.delete(id) }
export async function saveSetting(key: string, value: unknown) { await db.settings.put({ key, value }) }

export async function exportData() {
  const data = await loadLocalData()
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...data })
}

export async function importData(raw: string) {
  const parsed = JSON.parse(raw) as { version?: number; conversations?: Partial<Record<CharacterId, ChatMessage[]>>; memories?: ConfirmedMemory[]; settings?: Record<string, unknown> }
  if (parsed.version !== 1 || !parsed.conversations || !Array.isArray(parsed.memories)) throw new Error('不是有效的 Aily 备份文件')
  await db.transaction('rw', db.messages, db.memories, db.settings, async () => {
    await Promise.all([db.messages.clear(), db.memories.clear(), db.settings.clear()])
    for (const [characterId, messages] of Object.entries(parsed.conversations || {})) await db.messages.bulkPut((messages || []).map(message => ({ ...message, characterId: characterId as CharacterId })))
    await db.memories.bulkPut(parsed.memories || [])
    await db.settings.bulkPut(Object.entries(parsed.settings || {}).map(([key, value]) => ({ key, value })))
  })
  return loadLocalData()
}

export async function clearCharacterData(characterId: CharacterId) {
  await db.transaction('rw', db.messages, db.memories, async () => {
    await db.messages.where('characterId').equals(characterId).delete()
    await db.memories.where('characterId').equals(characterId).delete()
  })
}

export async function clearAllData() { await db.delete(); await db.open() }
