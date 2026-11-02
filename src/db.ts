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
