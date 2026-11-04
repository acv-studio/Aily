import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { archiveExpiredMemories, confirmProposal, forgottenSourceIds, loadMemoryPolicy, loadSummaries, saveMemoryPolicy, saveProposals, saveSummaries, clearAllData, clearCharacterData, clearCharacterMemories, db, deleteMemory, exportData, importData, initializeLocalData, loadLocalData, loadRoleConversation, persistChatChanges, saveConversation, saveMemory, saveSetting, updateMemory } from './db'
import { MAX_LOCAL_VIDEO_BYTES, type ChatMessage, type ConfirmedMemory } from './chatService'
import { defaultMemoryPolicy, type ConversationSummary } from './longMemory'
import { finishOnboarding, updateOnboarding } from './db'
import { defaultOnboardingProfile, onboardingMemoryId } from './onboarding'
import { getRelationship } from './relationship'

const summary: ConversationSummary = { id: 's1', characterId: 'lu', period: 'day', periodKey: '2026-01-01', text: 'summary text', sourceMessageIds: [1], updatedAt: '2026-01-01T00:00:00.000Z' }

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

describe('atomic onboarding repository', () => {
  it('finishes and reloads profile, primary role, confirmed naming memory and local trial together', async () => {
    const profile = { ...defaultOnboardingProfile('chen'), userName: '小雨', characterName: '阿奕', blockedTopics: '工作', chatLength: 'long' as const }
    const trial = [message, { ...message, id: 2, from: 'character' as const, text: '小雨，阿奕记住了' }]
    await finishOnboarding(profile, trial)
    db.close(); await db.open()
    const data = await initializeLocalData()
    expect(data.settings).toMatchObject({ selected: 'chen', onboarded: true, onboardingProfile: profile })
    expect(data.conversations.chen).toEqual(trial)
    expect(data.memories).toHaveLength(1)
    expect(data.memories[0]).toMatchObject({ id: onboardingMemoryId('chen'), category: 'relationship', state: 'confirmed', enabled: true })
    expect(data.memories[0].text).toContain('阿奕')
  })
  it('updates names without duplicate memory, trial turns or relationship downgrade', async () => {
    const profile = defaultOnboardingProfile('lu')
    await finishOnboarding(profile, [message])
    await saveMemory(memory)
    const before = await loadLocalData()
    await updateOnboarding({ ...profile, userName: '新名字', characterName: '澜澜' })
    await finishOnboarding({ ...profile, userName: '新名字', characterName: '澜澜' }, [{ ...message, id: 2 }])
    const after = await loadLocalData()
    expect(after.memories).toHaveLength(before.memories.length)
    expect(after.memories.find(item => item.id === onboardingMemoryId('lu'))?.confirmedAt).toBe(before.memories.find(item => item.id === onboardingMemoryId('lu'))?.confirmedAt)
    expect(after.memories.find(item => item.id === onboardingMemoryId('lu'))?.text).toContain('新名字')
    expect(after.conversations.lu).toEqual([message])
    expect(getRelationship('lu', after.memories).stage).toEqual(getRelationship('lu', before.memories).stage)
    await updateOnboarding(defaultOnboardingProfile('gu'))
    expect((await loadLocalData()).settings.selected).toBe('lu')
    expect(await db.memories.get(onboardingMemoryId('gu'))).toBeUndefined()
    expect(await db.memories.get(onboardingMemoryId('lu'))).toBeDefined()
    expect((await loadLocalData()).conversations.lu).toEqual([message])
  })
  it('preserves active role, other data and manual naming memory controls on preference-only edits', async () => {
    const profile = defaultOnboardingProfile('lu')
    await finishOnboarding(profile, [message])
    await saveConversation('chen', [{ ...message, text: 'other role' }])
    await saveSetting('selected', 'chen')
    await updateMemory(onboardingMemoryId('lu'), { text: 'manual naming note', enabled: false, state: 'archived', pinned: true, expiresAt: '2027-01-01T00:00:00.000Z' })
    const old = await db.memories.get(onboardingMemoryId('lu'))
    await updateOnboarding({ ...profile, chatLength: 'long' })
    expect(await db.memories.get(onboardingMemoryId('lu'))).toEqual(old)
    expect((await loadLocalData()).settings.selected).toBe('chen')
    expect(await loadRoleConversation('chen')).toEqual([{ ...message, text: 'other role' }])
    await updateOnboarding({ ...profile, chatLength: 'long', userName: '小雨' })
    const renamed = await db.memories.get(onboardingMemoryId('lu'))
    expect(renamed).toMatchObject({ enabled: false, state: 'archived', pinned: true, expiresAt: old!.expiresAt, confirmedAt: old!.confirmedAt })
    expect(renamed!.text).toContain('小雨')
    expect((await loadLocalData()).settings.selected).toBe('chen')
    await deleteMemory(onboardingMemoryId('lu'))
    await updateOnboarding({ ...profile, userName: '又改了', banter: true })
    expect(await db.memories.get(onboardingMemoryId('lu'))).toBeUndefined()
    await finishOnboarding(profile, [{ ...message, id: 5 }])
    expect(await db.memories.get(onboardingMemoryId('lu'))).toBeUndefined()
    expect(await loadRoleConversation('lu')).toEqual([message])
  })
  it('rolls back all onboarding writes and settings updates on failures', async () => {
    const profile = defaultOnboardingProfile('lu')
    await expect(updateOnboarding(profile)).rejects.toThrow('先完成')
    vi.spyOn(db.settings, 'bulkPut').mockRejectedValueOnce(new Error('quota'))
    await expect(finishOnboarding(profile, [message])).rejects.toThrow('quota')
    expect(await db.messages.count()).toBe(0)
    expect(await db.memories.count()).toBe(0)
    expect(await db.settings.count()).toBe(0)
    await finishOnboarding(profile, [message])
    const before = await loadLocalData()
    vi.spyOn(db.settings, 'bulkPut').mockRejectedValueOnce(new Error('update failure'))
    await expect(updateOnboarding({ ...profile, userName: 'not saved' })).rejects.toThrow('update failure')
    expect(await loadLocalData()).toEqual(before)
  })
  it('rejects invalid authorization and duplicate/colliding trial ids without modifying data', async () => {
    const profile = defaultOnboardingProfile('lu')
    await expect(finishOnboarding({ ...profile, adultEnabled: true }, [message])).rejects.toThrow('引导设置无效')
    await expect(finishOnboarding(profile, [message, message])).rejects.toThrow()
    await saveConversation('lu', [message])
    await expect(finishOnboarding(profile, [message])).rejects.toThrow()
    expect((await loadLocalData()).memories).toEqual([])
    expect((await loadLocalData()).settings.onboarded).toBeUndefined()
  })
  it('backs up the optional profile and resets all adult authorization on export and import', async () => {
    const profile = { ...defaultOnboardingProfile('lu'), userName: '雨', adultEnabled: true, ageConfirmed: true, adultConsent: true }
    await finishOnboarding(profile)
    const raw = await exportData()
    expect(JSON.parse(raw).settings.onboardingProfile).toEqual({ ...profile, adultEnabled: false, ageConfirmed: false, adultConsent: false })
    expect((await loadLocalData()).settings.onboardingProfile).toEqual(profile)
    const forged = JSON.parse(raw); forged.settings.onboardingProfile = profile
    expect((await importData(JSON.stringify(forged))).settings.onboardingProfile).toEqual({ ...profile, adultEnabled: false, ageConfirmed: false, adultConsent: false })
    const bad = JSON.parse(raw); bad.settings.onboardingProfile.notificationStart = 'tomorrow'
    const before = await loadLocalData()
    await expect(importData(JSON.stringify(bad))).rejects.toThrow('备份文件')
    expect(await loadLocalData()).toEqual(before)
    await importData(JSON.stringify(backup()))
    expect((await loadLocalData()).settings.onboardingProfile).toBeUndefined()
  })
  it('normalizes corrupt stored profiles safely on local load', async () => {
    await saveSetting('onboardingProfile', { characterId: 'lu', adultEnabled: true, adultConsent: true, ageConfirmed: 'true' })
    expect((await loadLocalData()).settings.onboardingProfile).toMatchObject({ adultEnabled: false, ageConfirmed: false, userName: '你' })
    await saveSetting('onboardingProfile', { characterId: 'unknown' })
    expect((await loadLocalData()).settings.onboardingProfile).toBeNull()
  })
})

describe('local data repository', () => {
  it('upgrades a populated v2 database without replacing data', async () => {
    await db.delete()
    const old = new Dexie('aily')
    old.version(2).stores({ conversationMessages: '[characterId+id], characterId, time, status', memories: 'id, characterId, confirmedAt', settings: 'key' })
    await old.open()
    await old.table('conversationMessages').put({ ...message, characterId: 'lu' })
    await old.table('memories').put(memory)
    await old.table('settings').put({ key: 'selected', value: 'gu' })
    old.close()
    await db.open()
    expect(db.verno).toBe(3)
    expect(await loadLocalData()).toMatchObject({ conversations: { lu: [message] }, memories: [memory], summaries: [], settings: { selected: 'gu' } })
    await saveSummaries('lu', [summary])
    db.close(); await db.open()
    expect(await loadSummaries('lu')).toEqual([summary])
  })

  it('replaces summaries atomically and isolates roles and duplicate IDs', async () => {
    await saveSummaries('lu', [summary])
    const other: ConversationSummary = { ...summary, id: 's2', characterId: 'chen' }
    await saveSummaries('chen', [other])
    await expect(saveSummaries('lu', [{ ...summary, id: 's2' }])).rejects.toThrow()
    await expect(saveSummaries('lu', [summary, summary])).rejects.toThrow()
    vi.spyOn(db.summaries, 'bulkPut').mockRejectedValueOnce(new Error('summary failure'))
    await expect(saveSummaries('lu', [{ ...summary, text: 'new' }])).rejects.toThrow('summary failure')
    expect(await loadSummaries('lu')).toEqual([summary])
    expect(await loadSummaries('chen')).toEqual([other])
    await saveSummaries('lu', [])
    expect(await loadSummaries('lu')).toEqual([])
  })

  it('persists independent validated policies and invalidates only that role summaries', async () => {
    expect(await loadMemoryPolicy('lu')).toEqual(defaultMemoryPolicy)
    await saveSummaries('lu', [summary])
    await saveSummaries('chen', [{ ...summary, id: 's2', characterId: 'chen' }])
    const policy = { disabledCategories: ['emotion' as const], extractionEnabled: false }
    await saveMemoryPolicy('lu', policy)
    await saveMemoryPolicy('gu', { disabledCategories: [], extractionEnabled: true })
    db.close(); await db.open()
    expect(await loadMemoryPolicy('lu')).toEqual(policy)
    expect(await loadMemoryPolicy('chen')).toEqual(defaultMemoryPolicy)
    expect(await loadSummaries('lu')).toEqual([])
    expect(await loadSummaries('chen')).toHaveLength(1)
    const raw = await exportData()
    expect(JSON.parse(raw)).toMatchObject({ version: 2, summaries: [{ characterId: 'chen' }], settings: { memoryPolicies: { lu: policy } } })
    await importData(raw)
    expect(await loadMemoryPolicy('lu')).toEqual(policy)
  })

  it('inserts proposals idempotently without overwriting decisions and confirms same-role conflicts', async () => {
    await saveMemory({ ...memory, sourceMessageId: 1 })
    await saveMemory({ ...memory, id: 'other', characterId: 'chen' })
    const candidate: ConfirmedMemory = { ...memory, id: 'new', text: 'new fact', sourceMessageId: 2, conflictIds: ['m1', 'other', 'new', 'missing'] }
    await Promise.all([saveProposals([candidate]), saveProposals([candidate])])
    expect(await db.memories.get('new')).toMatchObject({ state: 'pending', enabled: false })
    await saveSummaries('lu', [summary])
    const confirmed = await confirmProposal('new')
    expect(confirmed).toMatchObject({ state: 'confirmed', enabled: true })
    expect(await db.memories.get('m1')).toMatchObject({ state: 'archived', enabled: false })
    expect(await db.memories.get('other')).toEqual({ ...memory, id: 'other', characterId: 'chen' })
    expect(await forgottenSourceIds('lu')).toEqual([1])
    expect(await loadSummaries('lu')).toEqual([])
    await saveProposals([{ ...candidate, text: 'stale extraction' }])
    expect(await db.memories.get('new')).toEqual(confirmed)
    expect(await confirmProposal('new')).toEqual(confirmed)
    await updateMemory('new', { state: 'rejected', enabled: false })
    await saveProposals([candidate])
    expect((await db.memories.get('new'))?.state).toBe('rejected')
    expect((await confirmProposal('new'))?.state).toBe('rejected')
  })

  it('rejects stale policy summaries before deleting current digests', async () => {
    const oldPolicy = await loadMemoryPolicy('lu')
    await saveSummaries('lu', [summary], oldPolicy)
    const newPolicy = { disabledCategories: ['emotion' as const], extractionEnabled: true }
    await saveMemoryPolicy('lu', newPolicy)
    const fresh = { ...summary, text: 'fresh permitted digest' }
    await saveSummaries('lu', [fresh], newPolicy)
    const replacement = vi.spyOn(db.summaries, 'bulkPut')
    await expect(saveSummaries('lu', [{ ...summary, text: 'stale digest' }], oldPolicy)).rejects.toThrow()
    expect(replacement).not.toHaveBeenCalled()
    expect(await loadSummaries('lu')).toEqual([fresh])
    expect(await loadMemoryPolicy('lu')).toEqual(newPolicy)
  })

  it('rejects a confirmation when another decision changes the expected conflict set', async () => {
    await saveProposals([
      { ...memory, id: 'first', text: '我喜欢咖啡', sourceMessageId: 1, conflictIds: [] },
      { ...memory, id: 'second', text: '我不喜欢咖啡', sourceMessageId: 2, conflictIds: [] },
    ])
    // Both were pending at the time the empty expected set was observed.
    const first = await confirmProposal('first', [])
    await saveSummaries('lu', [summary])
    const before = await db.memories.toArray()
    await expect(confirmProposal('second', [])).rejects.toThrow()
    expect(await db.memories.toArray()).toEqual(before)
    expect(await db.memories.get('first')).toEqual(first)
    expect((await db.memories.get('second'))?.state).toBe('pending')
    expect(await forgottenSourceIds('lu')).toEqual([])
    expect(await loadSummaries('lu')).toEqual([summary])
    // A refreshed and explicitly accepted conflict decision succeeds atomically.
    await updateMemory('second', { conflictIds: ['first'] })
    expect(await confirmProposal('second', ['first'])).toMatchObject({ state: 'confirmed', enabled: true })
    expect(await db.memories.get('first')).toMatchObject({ state: 'archived', enabled: false })
    expect(await forgottenSourceIds('lu')).toEqual([1])
    expect(await loadSummaries('lu')).toEqual([])
  })

  it('checked confirmation never archives conflict IDs changed outside the accepted decision', async () => {
    await saveMemory({ ...memory, id: 'accepted-old', text: '我喜欢咖啡', sourceMessageId: 1 })
    await saveMemory({ ...memory, id: 'unapproved', text: '我喜欢海边', sourceMessageId: 3 })
    await saveProposals([{ ...memory, id: 'new', text: '我不喜欢咖啡', sourceMessageId: 2, conflictIds: ['accepted-old'] }])
    // Simulate a stale concurrent writer modifying the candidate after consent.
    await updateMemory('new', { conflictIds: ['unapproved'] })
    try { await confirmProposal('new', ['accepted-old']) } catch { /* Rejecting stale candidate metadata is also safe. */ }
    expect(await db.memories.get('unapproved')).toEqual({ ...memory, id: 'unapproved', text: '我喜欢海边', sourceMessageId: 3 })
    expect((await forgottenSourceIds('lu')).includes(3)).toBe(false)
    const candidate = await db.memories.get('new')
    if (candidate?.state === 'confirmed') {
      expect(await db.memories.get('accepted-old')).toMatchObject({ state: 'archived', enabled: false })
      expect(await forgottenSourceIds('lu')).toEqual([1])
    } else {
      expect(candidate?.state).toBe('pending')
      expect((await db.memories.get('accepted-old'))?.state).toBeUndefined()
      expect(await forgottenSourceIds('lu')).toEqual([])
    }
  })

  it('refuses stale proposal batches after policy disable or source forgetting', async () => {
    await saveMemoryPolicy('lu', { disabledCategories: ['profile'], extractionEnabled: true })
    await saveProposals([{ ...memory, id: 'disabled-category', category: 'profile' }])
    expect(await db.memories.count()).toBe(0)
    await saveMemoryPolicy('lu', { disabledCategories: [], extractionEnabled: false })
    await saveProposals([{ ...memory, id: 'disabled-extraction' }])
    expect(await db.memories.count()).toBe(0)
    await saveMemoryPolicy('lu', defaultMemoryPolicy)
    await saveMemory({ ...memory, sourceMessageId: 1 })
    await deleteMemory('m1')
    await saveProposals([{ ...memory, id: 'forgotten-source', sourceMessageId: 1 }])
    expect(await db.memories.count()).toBe(0)
  })

  it('rolls back conflict archival and confirmation together', async () => {
    await saveMemory({ ...memory, sourceMessageId: 1 })
    await saveProposals([{ ...memory, id: 'new', conflictIds: ['m1'] }])
    await saveSummaries('lu', [summary])
    vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('quota'))
    await expect(confirmProposal('new')).rejects.toThrow('quota')
    expect(await db.memories.get('m1')).toEqual({ ...memory, sourceMessageId: 1 })
    expect((await db.memories.get('new'))?.state).toBe('pending')
    expect(await loadSummaries('lu')).toEqual([summary])
    expect(await forgottenSourceIds('lu')).toEqual([])
  })

  it('archives expired legacy and active memories without reviving rejected or future items', async () => {
    await saveMemory({ ...memory, expiresAt: '2026-01-01T00:00:00.000Z', sourceMessageId: 1, pinned: true })
    await saveMemory({ ...memory, id: 'future', state: 'confirmed', expiresAt: '2027-01-01T00:00:00.000Z' })
    await saveMemory({ ...memory, id: 'rejected', state: 'rejected', expiresAt: memory.confirmedAt })
    await saveSummaries('lu', [summary])
    expect(await archiveExpiredMemories('2026-01-01T00:00:00.000Z')).toBe(1)
    expect(await db.memories.get('m1')).toMatchObject({ state: 'archived', enabled: false })
    expect((await db.memories.get('future'))?.state).toBe('confirmed')
    expect((await db.memories.get('rejected'))?.state).toBe('rejected')
    expect(await archiveExpiredMemories('2026-01-01T00:00:00.000Z')).toBe(0)
    expect(await loadSummaries('lu')).toEqual([])
    expect(await forgottenSourceIds('lu')).toEqual([1])
  })

  it('rolls back deletion and clear-memory tombstones when summary removal fails', async () => {
    await saveConversation('lu', [message])
    await saveMemory({ ...memory, sourceMessageId: 1 })
    await saveSummaries('lu', [summary])
    vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('forget failure'))
    await expect(deleteMemory('m1')).rejects.toThrow('forget failure')
    expect(await db.memories.get('m1')).toMatchObject(memory)
    expect(await loadSummaries('lu')).toEqual([summary])
    expect(await forgottenSourceIds('lu')).toEqual([])
    vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('clear failure'))
    await expect(clearCharacterMemories('lu')).rejects.toThrow('clear failure')
    expect(await db.memories.get('m1')).toMatchObject(memory)
    expect(await loadSummaries('lu')).toEqual([summary])
    expect(await forgottenSourceIds('lu')).toEqual([])
  })

  it('validates the full proposal batch before inserting and rolls back failed batches', async () => {
    await expect(saveProposals([memory, { ...memory, id: 'bad', importance: 0 as never }])).rejects.toThrow()
    expect(await db.memories.count()).toBe(0)
    vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('batch failure'))
    await expect(saveProposals([memory])).rejects.toThrow('batch failure')
    expect(await db.memories.count()).toBe(0)
  })

  it('forgets deleted sources across backups and rejects stale summary regeneration', async () => {
    await saveMemory({ ...memory, sourceMessageId: 1 })
    await saveSummaries('lu', [summary])
    await saveSummaries('chen', [{ ...summary, id: 's2', characterId: 'chen' }])
    await deleteMemory(memory.id)
    expect(await loadSummaries('lu')).toEqual([])
    expect(await loadSummaries('chen')).toHaveLength(1)
    expect(await forgottenSourceIds('lu')).toEqual([1])
    await expect(saveSummaries('lu', [summary])).rejects.toThrow()
    await importData(await exportData())
    expect(await forgottenSourceIds('lu')).toEqual([1])
    await expect(saveSummaries('lu', [summary])).rejects.toThrow()
  })

  it('corrections and disabling scrub summaries and retain source exclusions', async () => {
    await saveMemory({ ...memory, sourceMessageId: 1 })
    await saveSummaries('lu', [summary])
    await updateMemory('m1', 'corrected text')
    expect(await loadSummaries('lu')).toEqual([])
    expect(await forgottenSourceIds('lu')).toEqual([1])
    await saveSummaries('lu', [{ ...summary, sourceMessageIds: [2] }])
    await updateMemory('m1', { enabled: false })
    expect(await loadSummaries('lu')).toEqual([])
  })

  it('clear memories excludes all previous chat and summary sources; full clears remove summaries', async () => {
    await saveConversation('lu', [message, { ...message, id: 2 }])
    await saveMemory({ ...memory, sourceMessageId: 3 })
    await saveSummaries('lu', [{ ...summary, sourceMessageIds: [4] }])
    await saveSummaries('chen', [{ ...summary, id: 's2', characterId: 'chen' }])
    await clearCharacterMemories('lu')
    expect(await forgottenSourceIds('lu')).toEqual([1, 2, 3, 4])
    expect(await loadSummaries('lu')).toEqual([])
    expect(await loadRoleConversation('lu')).toHaveLength(2)
    await clearCharacterData('chen')
    expect(await loadSummaries('chen')).toEqual([])
    await clearAllData()
    expect((await loadLocalData()).summaries).toEqual([])
    expect(await forgottenSourceIds('lu')).toEqual([])
  })

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
    expect(db.verno).toBe(3)
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

  it.each(['video/mp4', 'video/webm', 'video/quicktime'])('persists and backs up local %s videos, including withdrawal', async mimeType => {
    const video: ChatMessage = { ...message, kind: 'video', attachment: { name: 'clip', mimeType, dataUrl: `data:${mimeType};base64,aGVsbG8=` }, status: 'sent', replyToId: 0 }
    await persistChatChanges('lu', [video])
    db.close(); await db.open()
    expect(await loadRoleConversation('lu')).toEqual([video])
    expect((await importData(await exportData())).conversations.lu).toEqual([video])
    const withdrawn = { ...video, withdrawn: true, text: '', attachment: undefined }
    await persistChatChanges('lu', [withdrawn])
    const restored = await importData(await exportData())
    expect(restored.conversations.lu?.[0]).toMatchObject({ kind: 'video', withdrawn: true, text: '' })
    expect(restored.conversations.lu?.[0]).not.toHaveProperty('attachment')
  })

  it('round-trips a 20MB video beyond the legacy attachment cap and rejects one byte over atomically', async () => {
    const base64 = (bytes: number) => 'A'.repeat(Math.floor(bytes / 3) * 4) + (bytes % 3 === 1 ? 'AA==' : bytes % 3 === 2 ? 'AAA=' : '')
    const video: ChatMessage = { ...message, kind: 'video', attachment: { name: 'large.mp4', mimeType: 'video/mp4', dataUrl: `data:video/mp4;base64,${base64(MAX_LOCAL_VIDEO_BYTES)}` } }
    await persistChatChanges('lu', [video])
    const raw = await exportData()
    expect(raw.length).toBeGreaterThan(10_000_000)
    expect((await importData(raw)).conversations.lu?.[0]).toEqual(video)
    const tooLarge = { ...video, attachment: { ...video.attachment!, dataUrl: `data:video/mp4;base64,${base64(MAX_LOCAL_VIDEO_BYTES + 1)}` } }
    await expect(persistChatChanges('lu', [tooLarge])).rejects.toThrow('备份文件')
    await expect(importData(JSON.stringify({ ...backup(), conversations: { lu: [tooLarge] } }))).rejects.toThrow('备份文件')
    expect(await loadRoleConversation('lu')).toEqual([video])
  })

  it.each([
    ['unsupported MIME', { name: 'clip.avi', mimeType: 'video/avi', dataUrl: 'data:video/avi;base64,aGVsbG8=' }],
    ['external URL', { name: 'clip.mp4', mimeType: 'video/mp4', dataUrl: 'https://example.com/clip.mp4' }],
    ['mismatched MIME', { name: 'clip.mp4', mimeType: 'video/mp4', dataUrl: 'data:video/webm;base64,aGVsbG8=' }],
    ['bad base64', { name: 'clip.mp4', mimeType: 'video/mp4', dataUrl: 'data:video/mp4;base64,AAAA!' }],
    ['bad padding', { name: 'clip.mp4', mimeType: 'video/mp4', dataUrl: 'data:video/mp4;base64,A=' }],
    ['empty video', { name: 'clip.mp4', mimeType: 'video/mp4', dataUrl: 'data:video/mp4;base64,' }],
  ])('rejects %s videos before persistence or backup replacement', async (_name, attachment) => {
    await persistChatChanges('lu', [message])
    const video = { ...message, kind: 'video' as const, attachment }
    await expect(persistChatChanges('lu', [video])).rejects.toThrow('备份文件')
    await expect(importData(JSON.stringify({ ...backup(), conversations: { lu: [video] } }))).rejects.toThrow('备份文件')
    expect(await loadRoleConversation('lu')).toEqual([message])
  })

  it('rejects video kind/MIME mismatches and preserves the legacy image/audio cap', async () => {
    const attachment = { name: 'clip.mp4', mimeType: 'video/mp4', dataUrl: 'data:video/mp4;base64,aGVsbG8=' }
    await expect(persistChatChanges('lu', [{ ...message, kind: 'text', attachment }])).rejects.toThrow()
    await expect(persistChatChanges('lu', [{ ...message, kind: 'video' }])).rejects.toThrow()
    await expect(persistChatChanges('lu', [{ ...message, kind: 'video', attachment: { ...attachment, mimeType: 'image/png', dataUrl: 'data:image/png;base64,aGVsbG8=' } }])).rejects.toThrow()
    for (const mimeType of ['image/png', 'audio/webm']) {
      await expect(persistChatChanges('lu', [{ ...message, attachment: { name: 'large', mimeType, dataUrl: `data:${mimeType};base64,${'A'.repeat(10_000_000)}` } }])).rejects.toThrow()
    }
    expect(await db.messages.count()).toBe(0)
  })

  it('round-trips supported optional message and memory fields', async () => {
    const richMessage: ChatMessage = { ...message, replyToId: 0, withdrawn: false, kind: 'image', attachment: { name: 'photo.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,aGVsbG8=' }, createdAt: '2026-01-01T00:00:00.000Z', memory: true, status: 'sent' }
    const richMemory: ConfirmedMemory = { ...memory, category: 'profile', sourceMessageId: 1, updatedAt: memory.confirmedAt, enabled: false, state: 'archived', importance: 5, pinned: true, expiresAt: memory.confirmedAt, originalText: 'original', sensitive: true, conflictIds: ['old'], topics: ['work'] }
    await saveConversation('lu', [richMessage]); await saveMemory(richMemory)
    const data = await importData(await exportData())
    expect(data.conversations.lu).toEqual([richMessage])
    expect(data.memories).toEqual([richMemory])
  })

  const invalidV2Cases: [string, unknown][] = [
    ['summary period', { summaries: [{ ...summary, period: 'hour' }] }],
    ['summary role', { summaries: [{ ...summary, characterId: 'stranger' }] }],
    ['summary source', { summaries: [{ ...summary, sourceMessageIds: [-1] }] }],
    ['duplicate summary', { summaries: [summary, summary] }],
    ['summary secret', { summaries: [{ ...summary, apiKey: 'secret' }] }],
    ['non-array summaries', { summaries: {} }],
    ['null summaries', { summaries: null }],
    ['null settings', { settings: null }],
    ['non-ISO expiry', { memories: [{ ...memory, expiresAt: '2026-01-01' }] }],
    ['policy category', { settings: { memoryPolicies: { lu: { disabledCategories: ['secret'], extractionEnabled: true } } } }],
    ['policy duplicate category', { settings: { memoryPolicies: { lu: { disabledCategories: ['emotion', 'emotion'], extractionEnabled: true } } } }],
    ['policy unknown role', { settings: { memoryPolicies: { stranger: defaultMemoryPolicy } } }],
    ['policy credentials', { settings: { memoryPolicies: { lu: { ...defaultMemoryPolicy, apiKey: 'secret' } } } }],
    ['policy enabled type', { settings: { memoryPolicies: { lu: { disabledCategories: [], extractionEnabled: 'false' } } } }],
    ['forgotten source type', { settings: { '__forgotten:lu': ['1'] } }],
    ['forgotten summary source', { summaries: [summary], settings: { '__forgotten:lu': [1] } }],
    ['memory state', { memories: [{ ...memory, state: 'unknown' }] }],
    ['memory importance', { memories: [{ ...memory, importance: 6 }] }],
    ['memory importance fractional', { memories: [{ ...memory, importance: 1.5 }] }],
    ['memory expiry', { memories: [{ ...memory, expiresAt: 'tomorrow' }] }],
    ['memory pinned', { memories: [{ ...memory, pinned: 'true' }] }],
    ['memory sensitive', { memories: [{ ...memory, sensitive: 1 }] }],
    ['memory conflict IDs', { memories: [{ ...memory, conflictIds: [1] }] }],
    ['memory topics', { memories: [{ ...memory, topics: {} }] }],
  ]
  it.each(invalidV2Cases)('rejects v2 %s before replacing any store', async (_name, changes) => {
    await saveSummaries('lu', [summary])
    const clear = vi.spyOn(db.summaries, 'clear')
    await expect(importData(JSON.stringify({ ...backup(), version: 2, summaries: [], ...(changes as object) }))).rejects.toThrow('不是有效的 Aily 备份文件')
    expect(clear).not.toHaveBeenCalled()
    expect(await loadSummaries('lu')).toEqual([summary])
  })

  it('v1 import clears summaries and restores default policies without requiring new fields', async () => {
    await saveSummaries('lu', [summary])
    await saveMemoryPolicy('lu', { disabledCategories: ['emotion'], extractionEnabled: false })
    const imported = await importData(JSON.stringify(backup()))
    expect(imported.summaries).toEqual([])
    expect(await loadMemoryPolicy('lu')).toEqual(defaultMemoryPolicy)
  })

  it('rolls back summary replacement with other stores if v2 import fails', async () => {
    await saveConversation('gu', [message])
    await saveSummaries('lu', [summary])
    vi.spyOn(db.summaries, 'bulkPut').mockRejectedValueOnce(new Error('summary import failure'))
    await expect(importData(JSON.stringify({ ...backup(), version: 2, summaries: [] }))).rejects.toThrow('summary import failure')
    expect(await loadSummaries('lu')).toEqual([summary])
    expect(await loadRoleConversation('gu')).toEqual([message])
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
