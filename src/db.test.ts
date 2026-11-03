import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllData, clearCharacterData, clearCharacterMemories, db, deleteMemory, exportData, importData, initializeLocalData, loadLocalData, loadRoleConversation, persistChatChanges, saveConversation, saveMemory, saveSetting, updateMemory } from './db'
import type { ChatMessage, ConfirmedMemory } from './chatService'

const message: ChatMessage = { id: 1, from: 'user', text: '陆', time: '现在' }
const memory: ConfirmedMemory = { id: 'm1', characterId: 'lu', text: '旧记忆', confirmedAt: '2026-01-01T00:00:00.000Z' }
const legacy = () => ({ onboarded: true, selected: 'chen', conversations: { lu: [message], chen: [{ ...message, text: '陈' }], gu: [] }, confirmedMemories: [memory] })
const backup = () => ({ version: 1, conversations: { lu: [message] }, memories: [memory], settings: { onboarded: true, selected: 'lu' } })

beforeEach(async () => {
  vi.restoreAllMocks()
  localStorage.clear()
  await db.delete()
  await db.open()
})

describe('local data repository', () => {
  it('isolates identical message IDs across all characters and conversation replacement', async () => {
    await saveConversation('lu', [message])
    await saveConversation('chen', [{ ...message, text: '陈' }])
    await saveConversation('gu', [{ ...message, text: '顾' }])
    expect(await db.messages.count()).toBe(3)
    expect((await db.messages.get(['chen', 1]))?.text).toBe('陈')
    await saveConversation('lu', [{ ...message, text: '陆更新' }])
    const data = await loadLocalData()
    expect(data.conversations.lu?.[0].text).toBe('陆更新')
    expect(data.conversations.chen?.[0].text).toBe('陈')
    expect(data.conversations.gu?.[0].text).toBe('顾')
  })

  it('upserts stale role snapshots without deleting newer turns or other roles', async () => {
    await persistChatChanges('lu', [message])
    await persistChatChanges('chen', [{ ...message, text: 'other role' }])
    const olderSnapshot = await loadRoleConversation('lu')
    const newerTurn: ChatMessage = { ...message, id: 2, text: 'newer user turn' }
    const newerReply: ChatMessage = { ...message, id: 3, from: 'character', text: 'newer reply' }
    const newerSnapshot = [...olderSnapshot, newerTurn, newerReply]
    await persistChatChanges('lu', newerSnapshot)
    const changedOldTurn: ChatMessage = { ...olderSnapshot[0], withdrawn: true, text: '' }
    const merged = await persistChatChanges('lu', [changedOldTurn])
    expect(merged).toEqual([changedOldTurn, newerTurn, newerReply])
    expect(await loadRoleConversation('lu')).toEqual(merged)
    expect(await loadRoleConversation('chen')).toEqual([{ ...message, text: 'other role' }])
  })

  it('serializes upserts from two stale snapshots and loads IDs in ascending order', async () => {
    await persistChatChanges('lu', [message])
    const firstSnapshot = await loadRoleConversation('lu')
    const secondSnapshot = await loadRoleConversation('lu')
    await Promise.all([
      persistChatChanges('lu', [...firstSnapshot, { ...message, id: 7, text: 'first tab' }]),
      persistChatChanges('lu', [...secondSnapshot, { ...message, id: 4, text: 'second tab' }]),
    ])
    expect((await loadRoleConversation('lu')).map(item => item.id)).toEqual([1, 4, 7])
    expect((await loadLocalData()).conversations.lu?.map(item => item.id)).toEqual([1, 4, 7])
    await persistChatChanges('lu', [])
    expect((await loadRoleConversation('lu')).map(item => item.id)).toEqual([1, 4, 7])
  })

  it('does not mark live sends failed when reading one role', async () => {
    await persistChatChanges('lu', [{ ...message, status: 'sending' }])
    expect((await loadRoleConversation('lu'))[0].status).toBe('sending')
    expect((await db.messages.get(['lu', 1]))?.status).toBe('sending')
  })

  it('rejects invalid changes and rolls back failed upserts without touching history', async () => {
    await persistChatChanges('lu', [message])
    await expect(persistChatChanges('lu', [{ ...message, id: -1 }])).rejects.toThrow('不是有效的 Aily 备份文件')
    vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('quota failure'))
    await expect(persistChatChanges('lu', [{ ...message, id: 2 }])).rejects.toThrow('quota failure')
    expect(await loadRoleConversation('lu')).toEqual([message])
  })

  it('normalizes explicit undefined optional fields and exports an importable backup', async () => {
    const optionalMessage: ChatMessage = { ...message, attachment: undefined, replyToId: undefined, kind: undefined, createdAt: undefined, withdrawn: undefined, memory: undefined, status: undefined }
    const optionalMemory: ConfirmedMemory = { ...memory, category: undefined, sourceMessageId: undefined, updatedAt: undefined, enabled: undefined }
    await saveConversation('lu', [optionalMessage])
    await persistChatChanges('chen', [optionalMessage])
    await saveMemory(optionalMemory)
    const stored = await db.messages.get(['lu', 1])
    expect(Object.hasOwn(stored!, 'attachment')).toBe(false)
    expect(Object.hasOwn((await db.messages.get(['chen', 1]))!, 'replyToId')).toBe(false)
    expect(Object.hasOwn((await db.memories.get(memory.id))!, 'category')).toBe(false)
    const raw = await exportData()
    expect(JSON.parse(raw).conversations.lu).toEqual([message])
    await expect(importData(raw)).resolves.toMatchObject({ conversations: { lu: [message], chen: [message] }, memories: [memory] })
  })

  it('upgrades v1 records transactionally to the v2 composite key', async () => {
    await db.delete()
    const old = new Dexie('aily')
    old.version(1).stores({ messages: 'id, characterId, time, status', memories: 'id, characterId, confirmedAt', settings: 'key' })
    await old.open()
    await old.table('messages').bulkPut([{ ...message, characterId: 'lu' }, { ...message, id: 2, characterId: 'chen', text: '旧陈' }])
    await old.table('memories').put(memory)
    await old.table('settings').put({ key: 'selected', value: 'chen' })
    old.close()
    await db.open()
    expect(db.verno).toBe(2)
    expect(db.messages.schema.primKey.keyPath).toEqual(['characterId', 'id'])
    expect((await loadLocalData()).memories).toEqual([memory])
    expect((await loadLocalData()).settings.selected).toBe('chen')
    expect((await db.messages.get(['lu', 1]))?.text).toBe('陆')
    expect((await db.messages.get(['chen', 2]))?.text).toBe('旧陈')
    await saveConversation('chen', [{ ...message, text: '新陈' }])
    expect((await loadLocalData()).conversations.lu?.[0].text).toBe('陆')
    db.close(); await db.open()
    expect(await db.messages.count()).toBe(2)
  })

  it('migrates valid legacy data once, retaining colliding IDs and explicit empty conversations', async () => {
    localStorage.setItem('aily-demo-state', JSON.stringify(legacy()))
    const data = await initializeLocalData()
    expect(data.conversations.lu).toEqual([message])
    expect(data.conversations.chen?.[0].text).toBe('陈')
    expect(data.conversations.gu).toEqual([])
    expect(data.memories).toEqual([memory])
    expect(data.settings).toEqual({ onboarded: true, selected: 'chen' })
    expect(localStorage.getItem('aily-demo-state')).toBeNull()
    localStorage.setItem('aily-demo-state', JSON.stringify({ ...legacy(), conversations: { lu: [{ ...message, text: 'stale' }] } }))
    expect((await initializeLocalData()).conversations.lu?.[0].text).toBe('陆')
  })

  it('does not replace any existing DB data with the legacy snapshot', async () => {
    await saveConversation('lu', [{ ...message, text: 'authoritative' }])
    localStorage.setItem('aily-demo-state', JSON.stringify(legacy()))
    const data = await initializeLocalData()
    expect(data.conversations.lu?.[0].text).toBe('authoritative')
    expect(data.conversations.chen).toBeUndefined()
    expect(data.memories).toEqual([])
  })

  it('respects saved empty conversations, full clears, and empty imports as authoritative', async () => {
    await saveConversation('lu', [])
    localStorage.setItem('aily-demo-state', JSON.stringify(legacy()))
    expect((await initializeLocalData()).conversations.lu).toEqual([])
    await clearAllData()
    localStorage.setItem('aily-demo-state', JSON.stringify(legacy()))
    expect((await initializeLocalData()).memories).toEqual([])
    await importData(JSON.stringify({ version: 1, conversations: {}, memories: [], settings: {} }))
    expect((await initializeLocalData()).conversations).toEqual({ lu: [], chen: [], gu: [] })
  })

  it('does not resurrect legacy memories after deleting the last authoritative memory', async () => {
    await saveMemory(memory)
    await deleteMemory(memory.id)
    localStorage.setItem('aily-demo-state', JSON.stringify(legacy()))
    const data = await initializeLocalData()
    expect(data.memories).toEqual([])
    expect(data.conversations).toEqual({})
  })

  it('serializes concurrent initialization without duplicate migration', async () => {
    localStorage.setItem('aily-demo-state', JSON.stringify(legacy()))
    const results = await Promise.all([initializeLocalData(), initializeLocalData()])
    expect(results[0]).toEqual(results[1])
    expect(await db.messages.count()).toBe(2)
    expect(await db.memories.count()).toBe(1)
  })

  it('leaves invalid legacy data untouched and never partially migrates', async () => {
    const raw = JSON.stringify({ ...legacy(), confirmedMemories: [{ ...memory, characterId: 'unknown' }] })
    localStorage.setItem('aily-demo-state', raw)
    expect((await initializeLocalData()).conversations).toEqual({})
    expect(await db.settings.count()).toBe(0)
    expect(localStorage.getItem('aily-demo-state')).toBe(raw)
    localStorage.setItem('aily-demo-state', '{bad JSON')
    await expect(initializeLocalData()).resolves.toBeDefined()
    expect(localStorage.getItem('aily-demo-state')).toBe('{bad JSON')
  })

  it('retains legacy key and rolls back records if migration transaction fails', async () => {
    const raw = JSON.stringify(legacy())
    localStorage.setItem('aily-demo-state', raw)
    const spy = vi.spyOn(db.memories, 'bulkPut').mockRejectedValueOnce(new Error('disk failure'))
    await expect(initializeLocalData()).rejects.toThrow('disk failure')
    expect(localStorage.getItem('aily-demo-state')).toBe(raw)
    expect(await db.messages.count()).toBe(0)
    expect(await db.settings.count()).toBe(0)
    spy.mockRestore()
    expect((await initializeLocalData()).memories).toEqual([memory])
  })

  it('marks interrupted sends failed on load and persists recovery', async () => {
    await saveConversation('lu', [{ ...message, status: 'sending' }])
    expect((await loadLocalData()).conversations.lu?.[0].status).toBe('failed')
    expect((await db.messages.get(['lu', 1]))?.status).toBe('failed')
  })

  it('exports only allowlisted settings and imports a versioned backup', async () => {
    await saveConversation('lu', [message])
    await saveSetting('onboarded', true)
    await saveSetting('selected', 'lu')
    await saveSetting('apiKey', 'secret')
    await saveSetting('provider', { token: 'secret' })
    const raw = await exportData()
    expect(raw).not.toContain('secret')
    expect(JSON.parse(raw).settings).toEqual({ onboarded: true, selected: 'lu' })
    await db.messages.clear()
    await importData(raw)
    expect((await loadLocalData()).conversations.lu?.[0].text).toBe('陆')
    await expect(importData('{}')).rejects.toThrow('不是有效的 Aily 备份文件')
  })

  it('round-trips supported optional message and memory fields', async () => {
    const richMessage: ChatMessage = { ...message, replyToId: 0, withdrawn: false, kind: 'image', attachment: { name: 'photo.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,aGVsbG8=' }, createdAt: '2026-01-01T00:00:00.000Z', memory: true, status: 'sent' }
    const richMemory: ConfirmedMemory = { ...memory, category: 'profile', sourceMessageId: 1, updatedAt: memory.confirmedAt, enabled: false }
    await saveConversation('lu', [richMessage]); await saveMemory(richMemory)
    const data = await importData(await exportData())
    expect(data.conversations.lu).toEqual([richMessage])
    expect(data.memories).toEqual([richMemory])
  })

  const invalidCases: [string, (data: ReturnType<typeof backup>) => unknown][] = [
    ['unknown character', data => ({ ...data, conversations: { stranger: [message] } })],
    ['invalid role', data => ({ ...data, conversations: { lu: [{ ...message, from: 'system' }] } })],
    ['string ID', data => ({ ...data, conversations: { lu: [{ ...message, id: '1' }] } })],
    ['negative ID', data => ({ ...data, conversations: { lu: [{ ...message, id: -1 }] } })],
    ['fractional ID', data => ({ ...data, conversations: { lu: [{ ...message, id: 1.2 }] } })],
    ['duplicate IDs', data => ({ ...data, conversations: { lu: [message, message] } })],
    ['non-array conversation', data => ({ ...data, conversations: { lu: {} } })],
    ['invalid text type', data => ({ ...data, conversations: { lu: [{ ...message, text: 1 }] } })],
    ['oversize text', data => ({ ...data, conversations: { lu: [{ ...message, text: 'x'.repeat(100_001) }] } })],
    ['invalid optional field', data => ({ ...data, conversations: { lu: [{ ...message, withdrawn: 'false' }] } })],
    ['invalid status', data => ({ ...data, conversations: { lu: [{ ...message, status: 'done' }] } })],
    ['invalid timestamp', data => ({ ...data, conversations: { lu: [{ ...message, createdAt: 'today' }] } })],
    ['invalid kind', data => ({ ...data, conversations: { lu: [{ ...message, kind: 'script' }] } })],
    ['unsafe attachment', data => ({ ...data, conversations: { lu: [{ ...message, attachment: { name: 'bad', mimeType: 'image/png', dataUrl: 'javascript:alert(1)' } }] } })],
    ['invalid reply ID', data => ({ ...data, conversations: { lu: [{ ...message, replyToId: '1' }] } })],
    ['empty memory ID', data => ({ ...data, memories: [{ ...memory, id: '' }] })],
    ['unknown memory character', data => ({ ...data, memories: [{ ...memory, characterId: 'other' }] })],
    ['duplicate memories', data => ({ ...data, memories: [memory, memory] })],
    ['invalid memory category', data => ({ ...data, memories: [{ ...memory, category: 'unknown' }] })],
    ['invalid memory enabled', data => ({ ...data, memories: [{ ...memory, enabled: 'true' }] })],
    ['invalid source ID', data => ({ ...data, memories: [{ ...memory, sourceMessageId: -1 }] })],
    ['invalid settings', data => ({ ...data, settings: { onboarded: 'true' } })],
    ['secret setting', data => ({ ...data, settings: { apiKey: 'secret' } })],
    ['unknown fields', data => ({ ...data, conversations: { lu: [{ ...message, secret: 'secret' }] } })],
  ]
  it.each(invalidCases)('rejects %s before clearing existing data', async (_name, change) => {
    await saveConversation('gu', [{ ...message, text: 'keep me' }])
    await saveMemory({ ...memory, characterId: 'gu' })
    await saveSetting('selected', 'gu')
    const before = await exportData()
    const destructive = vi.spyOn(db.messages, 'clear')
    await expect(importData(JSON.stringify(change(backup())))).rejects.toThrow('不是有效的 Aily 备份文件')
    expect(destructive).not.toHaveBeenCalled()
    const after = await exportData()
    expect({ ...JSON.parse(after), exportedAt: null }).toEqual({ ...JSON.parse(before), exportedAt: null })
  })

  it('rolls back a valid import when storage fails', async () => {
    await saveConversation('gu', [message])
    vi.spyOn(db.memories, 'bulkPut').mockRejectedValueOnce(new Error('write failure'))
    await expect(importData(JSON.stringify(backup()))).rejects.toThrow('write failure')
    expect((await loadLocalData()).conversations.gu).toEqual([message])
    expect((await loadLocalData()).conversations.lu).toBeUndefined()
  })

  it('updates memory with text or patches and timestamps, without changing ownership', async () => {
    await saveMemory(memory)
    await updateMemory('m1', '新记忆')
    let current = (await loadLocalData()).memories[0]
    expect(current.text).toBe('新记忆')
    expect(Number.isFinite(Date.parse(current.updatedAt!))).toBe(true)
    await updateMemory('m1', { enabled: false, category: 'emotion', id: 'other', characterId: 'gu' })
    current = (await loadLocalData()).memories[0]
    expect(current).toMatchObject({ id: 'm1', characterId: 'lu', enabled: false, category: 'emotion' })
    await deleteMemory('m1')
    expect((await loadLocalData()).memories).toHaveLength(0)
  })

  it('persists text and partial memory edits across database close/open and initialization', async () => {
    await saveMemory({ ...memory, category: 'profile', enabled: true })
    await updateMemory(memory.id, 'edited text before refresh')
    db.close(); await db.open()
    expect((await initializeLocalData()).memories[0]).toMatchObject({ ...memory, text: 'edited text before refresh', category: 'profile', enabled: true })
    await updateMemory(memory.id, { text: 'edited again', category: 'relationship', enabled: false })
    db.close(); await db.open()
    const refreshed = (await initializeLocalData()).memories[0]
    expect(refreshed).toMatchObject({ ...memory, text: 'edited again', category: 'relationship', enabled: false })
    expect(Number.isFinite(Date.parse(refreshed.updatedAt!))).toBe(true)
  })

  it('clears only character memories, or both character messages and memories as requested', async () => {
    await saveConversation('lu', [message]); await saveConversation('chen', [message])
    await saveMemory(memory); await saveMemory({ ...memory, id: 'm2', characterId: 'chen' })
    await clearCharacterMemories('lu')
    let data = await loadLocalData()
    expect(data.conversations.lu).toEqual([message])
    expect(data.memories.map(item => item.characterId)).toEqual(['chen'])
    await clearCharacterData('chen')
    data = await loadLocalData()
    expect(data.conversations.chen).toEqual([])
    expect(data.conversations.lu).toEqual([message])
    expect(data.memories).toEqual([])
  })
})
