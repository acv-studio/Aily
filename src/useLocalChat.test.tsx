import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useLocalChat from './useLocalChat'
import Dexie from 'dexie'
import { db, deleteMemory, loadLocalData, persistChatChanges, saveMemory, saveMemoryPolicy } from './db'
import { buildContext, retrieveMemories, streamReply, type ConfirmedMemory } from './chatService'
import { defaultOnboardingProfile } from './onboarding'

vi.mock('./chatService', async () => ({ ...await vi.importActual('./chatService'), streamReply: vi.fn() }))
const stream = vi.mocked(streamReply)
beforeEach(async () => { localStorage.clear(); sessionStorage.clear(); await db.delete(); await db.open(); stream.mockReset() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
async function setup() { const hook = renderHook(useLocalChat); await waitFor(() => expect(hook.result.current.ready).toBe(true)); return hook }

describe('local video attachment orchestration', () => {
  const attachment = { name: 'clip.mp4', mimeType: 'video/mp4', dataUrl: 'data:video/mp4;base64,aGVsbG8=' }

  it('saves video locally without a model request or assistant turn, including retry and withdrawal', async () => {
    const hook = await setup()
    act(() => { hook.result.current.setApiKey('configured-key'); hook.result.current.setDraft('local video caption') })
    await act(() => hook.result.current.send({ kind: 'video', attachment }))
    expect(stream).not.toHaveBeenCalled()
    expect(hook.result.current.chatMessages).toHaveLength(1)
    expect(hook.result.current.chatMessages[0]).toMatchObject({ kind: 'video', attachment, text: 'local video caption', status: 'sent' })
    expect(hook.result.current.error).toContain('文字模型不会读取图片、语音或视频')
    expect(hook.result.current.replying).toBe(false)
    const id = hook.result.current.chatMessages[0].id
    hook.unmount()
    const restored = await setup()
    expect(restored.result.current.chatMessages[0].attachment).toEqual(attachment)
    await act(() => restored.result.current.send({ retryId: id }))
    expect(restored.result.current.chatMessages).toHaveLength(1)
    expect(stream).not.toHaveBeenCalled()
    await act(() => restored.result.current.withdraw(id))
    expect((await loadLocalData()).conversations.lu?.[0]).toMatchObject({ withdrawn: true, kind: 'video', text: '' })
    expect((await loadLocalData()).conversations.lu?.[0]).not.toHaveProperty('attachment')
    await act(() => restored.result.current.send({ retryId: id }))
    expect(stream).not.toHaveBeenCalled()
  })

  it('keeps temporary video in memory only, infers video kind, and discards it when leaving', async () => {
    const hook = await setup()
    act(() => hook.result.current.toggleTemporary())
    await act(() => hook.result.current.send({ attachment }))
    expect(hook.result.current.chatMessages).toHaveLength(1)
    expect(hook.result.current.chatMessages[0].kind).toBe('video')
    expect(hook.result.current.error).toContain('未落盘')
    expect(await db.messages.count()).toBe(0)
    expect(stream).not.toHaveBeenCalled()
    const id = hook.result.current.chatMessages[0].id
    await act(() => hook.result.current.withdraw(id))
    expect(hook.result.current.chatMessages[0]).toMatchObject({ withdrawn: true, text: '' })
    expect(hook.result.current.chatMessages[0].attachment).toBeUndefined()
    act(() => hook.result.current.toggleTemporary())
    expect(hook.result.current.chatMessages).toEqual([])
    expect(await db.messages.count()).toBe(0)
  })

  it.each([false, true])('rejects invalid video without clearing draft or sending in temporary=%s', async temporary => {
    const hook = await setup()
    if (temporary) act(() => hook.result.current.toggleTemporary())
    act(() => hook.result.current.setDraft('keep this draft'))
    await act(() => hook.result.current.send({ kind: 'video', attachment: { ...attachment, mimeType: 'video/avi' } }))
    expect(hook.result.current.error).toContain('20MB')
    expect(hook.result.current.draft).toBe('keep this draft')
    expect(hook.result.current.chatMessages).toEqual([])
    expect(await db.messages.count()).toBe(0)
    expect(stream).not.toHaveBeenCalled()
  })
})

describe('onboarding hook integration', () => {
  it('blocks deletion during onboarding writes and rejects onboarding after deletion begins', async () => {
    const hook = await setup()
    let unblock!: () => void
    const delayed = new Promise<void>(resolve => { unblock = resolve })
    const original = db.settings.bulkPut.bind(db.settings)
    const write = vi.spyOn(db.settings, 'bulkPut').mockImplementation((...args) => Dexie.Promise.resolve(delayed).then(() => original(...args)))
    let pending!: Promise<void>
    act(() => { pending = hook.result.current.finishOnboarding() })
    await expect(hook.result.current.prepareForDeletion()).rejects.toThrow('等待保存')
    await expect(hook.result.current.updateOnboarding(defaultOnboardingProfile('lu'))).rejects.toThrow('等待本机数据保存')
    unblock()
    await act(() => pending)
    write.mockRestore()
    await act(() => hook.result.current.prepareForDeletion())
    await expect(hook.result.current.finishOnboarding()).rejects.toThrow('正在删除')
    await expect(hook.result.current.updateOnboarding(defaultOnboardingProfile('lu'))).rejects.toThrow('正在删除')
  })
  it('finishes atomically, exposes profile and restores settings and trial after remount', async () => {
    const hook = await setup()
    expect(hook.result.current.onboardingProfile).toBeNull()
    const profile = { ...defaultOnboardingProfile('gu'), userName: '小雨', characterName: '阿泽' }
    const trial = [{ id: 1, from: 'character' as const, text: '小雨，阿泽在这里', time: '现在' }]
    await act(() => hook.result.current.finishOnboarding(profile, trial))
    expect(hook.result.current.onboarded).toBe(true)
    expect(hook.result.current.selected).toBe('gu')
    expect(hook.result.current.onboardingProfile).toEqual(profile)
    expect(hook.result.current.conversations.gu).toEqual(trial)
    hook.unmount()
    const restored = await setup()
    expect(restored.result.current.onboardingProfile).toEqual(profile)
    expect(restored.result.current.selected).toBe('gu')
    await act(() => restored.result.current.updateOnboarding({ ...profile, userName: '新称呼' }))
    expect(restored.result.current.memories.filter(memory => memory.state === 'confirmed')).toHaveLength(1)
    expect(restored.result.current.conversations.gu).toEqual(trial)
    stream.mockImplementation(async request => request.onDelta('回复'))
    act(() => restored.result.current.setDraft('你好'))
    await act(() => restored.result.current.send())
    expect(stream.mock.calls.at(-1)![0].onboardingProfile?.userName).toBe('新称呼')
  })
  it('does not switch active role, clear its draft or revive deleted naming memory on settings update', async () => {
    const hook = await setup()
    const profile = defaultOnboardingProfile('lu')
    await act(() => hook.result.current.finishOnboarding(profile))
    const id = hook.result.current.memories[0].id
    await act(() => hook.result.current.removeMemory(id))
    act(() => { hook.result.current.setSelected('chen'); hook.result.current.setDraft('not sent yet') })
    await act(() => hook.result.current.updateOnboarding({ ...profile, userName: '小雨', proactiveFrequency: 'daily' }))
    expect(hook.result.current.selected).toBe('chen')
    expect(hook.result.current.draft).toBe('not sent yet')
    expect(hook.result.current.memories).toEqual([])
    expect((await loadLocalData()).settings.selected).toBe('chen')
    await act(() => hook.result.current.reload())
    expect(hook.result.current.selected).toBe('chen')
    expect(hook.result.current.onboardingProfile?.userName).toBe('小雨')
    expect(hook.result.current.memories).toEqual([])
  })
  it('keeps no-argument finish compatible and rejects failures without advancing state', async () => {
    const hook = await setup()
    vi.spyOn(db.settings, 'bulkPut').mockRejectedValueOnce(new Error('quota'))
    await act(async () => { await expect(hook.result.current.finishOnboarding()).rejects.toThrow('quota') })
    expect(hook.result.current.onboarded).toBe(false)
    expect(hook.result.current.onboardingProfile).toBeNull()
    expect(hook.result.current.memories).toEqual([])
    expect(hook.result.current.error).toContain('无法保存引导设置')
    await act(() => hook.result.current.finishOnboarding())
    expect(hook.result.current.onboardingProfile).toEqual(defaultOnboardingProfile('lu'))
    const before = hook.result.current.onboardingProfile
    await act(async () => { await expect(hook.result.current.updateOnboarding({ ...before!, adultEnabled: true })).rejects.toThrow('引导设置无效') })
    expect(hook.result.current.onboardingProfile).toEqual(before)
  })
})

describe('reply-mode orchestration', () => {
  it('persists modes per role and passes the selected mode on send and retry', async () => {
    const hook = await setup()
    expect(hook.result.current.replyMode).toBe('brief')
    await act(() => hook.result.current.setReplyMode('story'))
    act(() => hook.result.current.setSelected('chen'))
    expect(hook.result.current.replyMode).toBe('brief')
    await act(() => hook.result.current.setReplyMode('deep'))
    stream.mockRejectedValueOnce(new Error('network'))
    act(() => hook.result.current.setDraft('你好'))
    await act(() => hook.result.current.send())
    expect(stream.mock.calls.at(-1)![0].replyMode).toBe('deep')
    const id = hook.result.current.chatMessages.find(item => item.from === 'user')!.id
    await act(() => hook.result.current.setReplyMode('brief'))
    stream.mockImplementation(async request => request.onDelta('好'))
    await act(() => hook.result.current.send({ retryId: id }))
    expect(stream.mock.calls.at(-1)![0].replyMode).toBe('brief')
    expect(hook.result.current.chatMessages.filter(item => item.from === 'user')).toHaveLength(1)
    hook.unmount()
    const restored = await setup()
    act(() => restored.result.current.setSelected('lu'))
    expect(restored.result.current.replyMode).toBe('story')
  })
  it('keeps temporary changes in memory and restores the regular mode', async () => {
    const hook = await setup()
    await act(() => hook.result.current.setReplyMode('story'))
    act(() => hook.result.current.toggleTemporary())
    await act(() => hook.result.current.setReplyMode('deep'))
    expect(hook.result.current.replyMode).toBe('deep')
    expect((await db.settings.get('__replyMode:lu'))?.value).toBe('story')
    act(() => hook.result.current.toggleTemporary())
    expect(hook.result.current.replyMode).toBe('story')
  })
  it('uses the old length preference until a mode is explicitly chosen and keeps failed saves unchanged', async () => {
    const hook = await setup()
    await act(() => hook.result.current.finishOnboarding({ ...defaultOnboardingProfile('lu'), chatLength: 'long' }))
    expect(hook.result.current.replyMode).toBe('deep')
    vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('quota'))
    await act(async () => { await expect(hook.result.current.setReplyMode('story')).rejects.toThrow('quota') })
    expect(hook.result.current.replyMode).toBe('deep')
    expect(hook.result.current.error).toContain('仍使用原模式')
    expect(hook.result.current.modeSaving).toBe(false)
  })
  it('rejects mode changes while replying without changing the captured request', async () => {
    const hook = await setup()
    let finish!: () => void
    stream.mockImplementation(async () => new Promise<void>(resolve => { finish = resolve }))
    act(() => hook.result.current.setDraft('你好'))
    let pending!: Promise<void>
    act(() => { pending = hook.result.current.send() })
    await waitFor(() => expect(stream).toHaveBeenCalled())
    await expect(hook.result.current.setReplyMode('story')).rejects.toThrow('请先停止回复')
    expect(stream.mock.calls[0][0].replyMode).toBe('brief')
    await act(async () => { finish(); await pending })
    expect(hook.result.current.replyMode).toBe('brief')
  })
})

describe('unified confirmed-memory orchestration', () => {
  const fact = (id: string, characterId: ConfirmedMemory['characterId'], sourceMessageId?: number): ConfirmedMemory => ({ id, characterId, sourceMessageId, text: `晚饭偏好 ${id}`, category: 'profile', state: 'confirmed', enabled: true, confirmedAt: '2026-01-01' })

  it('shares confirmed facts but not raw histories, summaries or relationship progress', async () => {
    const hook = await setup()
    await act(() => hook.result.current.beforeDataChange())
    await persistChatChanges('chen', [{ id: 1, from: 'user', text: 'source-private-history', time: '' }])
    await saveMemory(fact('shared', 'chen', 1))
    await db.summaries.put({ id: 'chen-summary', characterId: 'chen', period: 'day', periodKey: '2026-01-01', text: '晚饭 source-summary', sourceMessageIds: [1], updatedAt: '2026-01-01' })
    stream.mockImplementation(async request => {
      expect(request.messages.some(message => message.text === 'source-private-history')).toBe(false)
      expect(request.summaries).toEqual([])
      const recalled = retrieveMemories(request.characterId, request.messages, request.memories, request.memoryPolicy, request.memorySources)
      expect(recalled.map(memory => [memory.id, memory.characterId])).toEqual([['shared', 'chen']])
      const prompt = buildContext(request.characterId, request.messages, request.memories, request.summaries, request.memoryPolicy, request.onboardingProfile, request.locale, request.replyMode, request.memorySources)[0].content
      expect(prompt).toContain('"sourceCharacterId":"chen"')
      expect(prompt).not.toContain('source-private-history')
      expect(prompt).not.toContain('source-summary')
      request.onDelta('回复')
    })
    act(() => hook.result.current.setDraft('晚饭怎么安排'))
    await act(() => hook.result.current.send())
    expect(stream).toHaveBeenCalledTimes(1)
    expect((await db.memories.get('shared'))?.characterId).toBe('chen')
    expect(await db.summaries.get('chen-summary')).toBeDefined()
  })

  it('reads fresh source policies and role-qualified withdrawn/deleted/missing exclusions', async () => {
    const hook = await setup()
    await act(() => hook.result.current.beforeDataChange())
    await persistChatChanges('lu', [{ id: 1, from: 'user', text: '', withdrawn: true, time: '' }])
    await persistChatChanges('chen', [
      { id: 1, from: 'user', text: 'valid source', time: '' },
      { id: 2, from: 'user', text: '', withdrawn: true, time: '' },
      { id: 3, from: 'character', text: 'paired withdrawn source', time: '' },
      { id: 4, from: 'user', text: 'deleted fact source', time: '' },
      { id: 5, from: 'character', text: 'paired deleted source', time: '' },
      { id: 6, from: 'user', text: '我想自杀', time: '' },
      { id: 7, from: 'character', text: 'paired unsafe source', time: '' },
    ])
    await saveMemory(fact('deleted', 'chen', 4)); await deleteMemory('deleted')
    for (const memory of [fact('shared', 'chen', 1), fact('withdrawn', 'chen', 2), fact('withdrawn-reply', 'chen', 3), fact('deleted-reply', 'chen', 5), fact('unsafe-reply', 'chen', 7), fact('missing', 'chen', 99), fact('policy-blocked', 'gu')]) await saveMemory(memory)
    // Changed outside this hook: send must use current DB policies, not state snapshots.
    await saveMemoryPolicy('gu', { extractionEnabled: true, disabledCategories: ['profile'] })
    stream.mockImplementation(async request => {
      expect(request.memorySources?.chen?.excludedSourceMessageIds).toEqual(expect.arrayContaining([2, 3, 6, 7, 99]))
      expect(request.memorySources?.chen?.forgottenSourceMessageIds).toEqual(expect.arrayContaining([4, 5]))
      expect(request.memorySources?.lu?.excludedSourceMessageIds).toContain(1)
      expect(retrieveMemories(request.characterId, request.messages, request.memories, request.memoryPolicy, request.memorySources).map(memory => memory.id)).toEqual(['shared'])
      request.onDelta('回复')
    })
    act(() => hook.result.current.setDraft('晚饭怎么安排'))
    await act(() => hook.result.current.send())
    expect(stream).toHaveBeenCalledTimes(1)
  })

  it('does not load or recall durable memory in temporary sessions', async () => {
    const hook = await setup()
    await act(() => hook.result.current.beforeDataChange())
    await saveMemory(fact('shared', 'chen'))
    act(() => { hook.result.current.toggleTemporary(); hook.result.current.setDraft('晚饭怎么安排') })
    stream.mockImplementation(async request => request.onDelta('回复'))
    await act(() => hook.result.current.send())
    expect(stream.mock.calls[0][0]).toMatchObject({ memories: [], summaries: [], memorySources: {} })
    expect(await db.memories.get('shared')).toBeDefined()
    expect(await db.messages.count()).toBe(0)
  })
})

describe('durable chat orchestration', () => {
  it('blocks deletion during an uncompleted policy write and rejects new writes after draining', async () => {
    const hook = await setup()
    let unblock!: () => void
    const delayed = new Promise<void>(resolve => { unblock = resolve })
    const original = db.settings.put.bind(db.settings)
    const write = vi.spyOn(db.settings, 'put').mockImplementation((...args) => {
      if (args[0].key === 'memoryPolicies') return Dexie.Promise.resolve(delayed).then(() => original(...args))
      return original(...args)
    })
    let pending!: Promise<void>
    act(() => { pending = hook.result.current.changePolicy('lu', { disabledCategories: ['profile'], extractionEnabled: false }) })
    await expect(hook.result.current.prepareForDeletion()).rejects.toThrow('等待保存')
    unblock()
    await act(async () => { await pending; await hook.result.current.prepareForDeletion() })
    write.mockRestore()
    await expect(hook.result.current.saveConfirmed({ text: 'late write', category: 'context' })).rejects.toThrow('正在删除')
    await expect(hook.result.current.changePolicy('lu', { disabledCategories: [], extractionEnabled: true })).rejects.toThrow('正在删除')
  })

  it('saves the user turn before the API and preserves failure through reload', async () => {
    const hook = await setup()
    stream.mockImplementation(async () => {
      expect((await loadLocalData()).conversations.lu?.some(message => message.text === '不能丢失')).toBe(true)
      throw new Error('network failure')
    })
    act(() => hook.result.current.setDraft('不能丢失'))
    await act(() => hook.result.current.send())
    expect(hook.result.current.conversations.lu.filter(item => item.from === 'user')).toHaveLength(1)
    expect(hook.result.current.conversations.lu[0].status).toBe('failed')
    const id = hook.result.current.conversations.lu[0].id
    hook.unmount()
    const restored = await setup()
    expect(restored.result.current.conversations.lu[0].text).toBe('不能丢失')
    stream.mockImplementation(async request => request.onDelta('成功回复'))
    await act(() => restored.result.current.send({ retryId: id }))
    expect(restored.result.current.conversations.lu.filter(message => message.from === 'user')).toHaveLength(1)
    expect(restored.result.current.conversations.lu.at(-1)?.text).toBe('成功回复')
    expect(restored.result.current.conversations.lu[0].status).toBe('sent')
  })

  it('can stop a partial stream and keep the partial reply', async () => {
    const hook = await setup()
    stream.mockImplementation(async request => {
      request.onDelta('已生成片段')
      await new Promise<void>((_, reject) => request.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
    })
    act(() => hook.result.current.setDraft('你好'))
    let pending!: Promise<void>
    act(() => { pending = hook.result.current.send() })
    await waitFor(() => expect(stream).toHaveBeenCalled())
    act(() => hook.result.current.stop())
    await act(() => pending)
    expect(hook.result.current.replying).toBe(false)
    expect(hook.result.current.conversations.lu[1].text).toBe('已生成片段')
    expect(hook.result.current.conversations.lu[1].status).toBe('failed')
  })

  it('isolates role histories and supports memory correction, pause and deletion', async () => {
    const hook = await setup()
    stream.mockImplementation(async request => request.onDelta('回复'))
    act(() => hook.result.current.setDraft('陆的记录'))
    await act(() => hook.result.current.send())
    await act(() => hook.result.current.saveConfirmed({ text: '旧偏好', category: 'profile' }))
    const id = hook.result.current.memories[0].id
    await act(() => hook.result.current.editMemory(id, { text: '新偏好', enabled: false }))
    expect((await loadLocalData()).memories[0].text).toBe('新偏好')
    act(() => hook.result.current.setSelected('chen'))
    expect(hook.result.current.conversations.chen).toHaveLength(0)
    act(() => hook.result.current.setDraft('陈的记录'))
    await act(() => hook.result.current.send())
    const lastRequest = stream.mock.calls.at(-1)![0]
    expect(lastRequest.characterId).toBe('chen')
    expect(lastRequest.messages.some(message => message.text === '陆的记录')).toBe(false)
    await act(() => hook.result.current.removeMemory(id))
    expect((await loadLocalData()).memories).toHaveLength(0)
  })

  it('preserves newer messages from a second stale hook and serializes withdrawals', async () => {
    const first = await setup(); const second = await setup()
    stream.mockImplementation(async request => request.onDelta('回复'))
    act(() => first.result.current.setDraft('第一条'))
    await act(() => first.result.current.send())
    act(() => second.result.current.setDraft('第二条'))
    await act(() => second.result.current.send())
    const ids = (await loadLocalData()).conversations.lu!.filter(item => item.from === 'user').map(item => item.id)
    expect(ids).toHaveLength(2)
    await act(async () => { await Promise.all(ids.map(id => second.result.current.withdraw(id))) })
    expect((await loadLocalData()).conversations.lu!.filter(item => item.from === 'user').every(item => item.withdrawn)).toBe(true)
  })

  it('survives blocked preference storage without crashing', async () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
    const hook = await setup()
    expect(hook.result.current.apiKey).toBe('')
    read.mockRestore()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
    act(() => hook.result.current.setApiKey('temporary-key'))
    expect(hook.result.current.apiKey).toBe('temporary-key')
    expect(hook.result.current.error).toContain('仅暂留内存')
  })

  it('withdraws a user message persistently without deleting separately confirmed memories', async () => {
    const hook = await setup()
    stream.mockImplementation(async request => request.onDelta('回复'))
    act(() => hook.result.current.setDraft('原消息'))
    await act(() => hook.result.current.send())
    const id = hook.result.current.conversations.lu[0].id
    await act(() => hook.result.current.saveConfirmed({ text: '确认的偏好', category: 'profile', sourceMessageId: id }))
    await act(() => hook.result.current.withdraw(id))
    const data = await loadLocalData()
    expect(data.conversations.lu?.[0].withdrawn).toBe(true)
    expect(data.conversations.lu?.[0].text).toBe('')
    expect(data.memories).toHaveLength(1)
  })
})
