import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, deleteMemory, loadLocalData, saveConversation, saveMemory, updateMemory } from './db'

beforeEach(async () => { await db.delete(); await db.open() })

describe('local data repository', () => {
  it('isolates conversations by character', async () => {
    await saveConversation('lu', [{ id: 1, from: 'user', text: '陆', time: '现在' }])
    await saveConversation('chen', [{ id: 2, from: 'user', text: '陈', time: '现在' }])
    const data = await loadLocalData()
    expect(data.conversations.lu?.[0].text).toBe('陆')
    expect(data.conversations.chen?.[0].text).toBe('陈')
  })

  it('creates, edits and deletes confirmed memories', async () => {
    const memory = { id: 'm1', characterId: 'lu' as const, text: '旧记忆', confirmedAt: new Date().toISOString() }
    await saveMemory(memory); await updateMemory('m1', '新记忆')
    expect((await loadLocalData()).memories[0].text).toBe('新记忆')
    await deleteMemory('m1')
    expect((await loadLocalData()).memories).toHaveLength(0)
  })
})
