import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useLocalChat from './useLocalChat'
import { buildContext, streamReply, type ChatMessage, type ConfirmedMemory } from './chatService'
import { db, forgottenSourceIds, loadLocalData, loadSummaries, saveConversation, saveMemory } from './db'
import { defaultMemoryPolicy } from './longMemory'

vi.mock('./chatService', async () => ({ ...await vi.importActual('./chatService'), streamReply: vi.fn() }))
const stream = vi.mocked(streamReply)
const source: ChatMessage = { id: 1, from: 'user', text: '我喜欢咖啡', time: '现在', status: 'sent', createdAt: '2026-01-01T00:00:00.000Z' }
const confirmed: ConfirmedMemory = { id: 'fact', characterId: 'lu', text: source.text, originalText: source.text, sourceMessageId: source.id, category: 'profile', state: 'confirmed', enabled: true, confirmedAt: source.createdAt! }

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear(); await db.delete(); await db.open(); stream.mockReset()
  stream.mockImplementation(async request => request.onDelta('回复'))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
async function setup() {
  const hook = renderHook(useLocalChat)
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  // Wait for startup organization through the public operation's queue barrier.
  await act(() => hook.result.current.changePolicy('lu', defaultMemoryPolicy))
  return hook
}
async function seed() { await saveConversation('lu', [source]); await saveMemory(confirmed) }

describe('long-memory hook integration and privacy boundaries', () => {
  it('refreshes conflicts when a formerly pending alternative is confirmed first', async () => {
    await saveConversation('lu', [source, { ...source, id: 2, text: '我不喜欢咖啡' }])
    const hook = await setup()
    const first = hook.result.current.memories.find(memory => memory.sourceMessageId === 1)!
    const second = hook.result.current.memories.find(memory => memory.sourceMessageId === 2)!
    expect(first.conflictIds).toEqual([])
    expect(second.conflictIds).toEqual([])
    const prompt = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(() => hook.result.current.approveProposal(first.id))
    expect(prompt).not.toHaveBeenCalled()
    await act(() => hook.result.current.approveProposal(second.id))
    expect(prompt).toHaveBeenCalledOnce()
    expect(prompt.mock.calls[0][0]).toContain('我喜欢咖啡')
    expect(await db.memories.get(first.id)).toMatchObject({ state: 'archived', enabled: false })
    expect(await db.memories.get(second.id)).toMatchObject({ state: 'confirmed', enabled: true, conflictIds: [first.id] })
    expect(await forgottenSourceIds('lu')).toEqual([1])
    expect((await loadSummaries('lu')).every(summary => !summary.sourceMessageIds.includes(1))).toBe(true)
  })

  it('declining refreshed conflicts leaves both decisions and source privacy state untouched', async () => {
    await saveConversation('lu', [source, { ...source, id: 2, text: '我不喜欢咖啡' }])
    const hook = await setup()
    const first = hook.result.current.memories.find(memory => memory.sourceMessageId === 1)!
    const second = hook.result.current.memories.find(memory => memory.sourceMessageId === 2)!
    await act(() => hook.result.current.approveProposal(first.id))
    const before = await loadLocalData()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(() => hook.result.current.approveProposal(second.id))
    expect(await loadLocalData()).toEqual(before)
    expect(await db.memories.get(first.id)).toMatchObject({ state: 'confirmed', enabled: true })
    expect(await db.memories.get(second.id)).toMatchObject({ state: 'pending', enabled: false })
    expect(await forgottenSourceIds('lu')).toEqual([])
  })

  it.each(['delete', 'correct'] as const)('%s excludes forgotten raw user turns and all their assistant replies from request context', async action => {
    const echo: ChatMessage = { ...source, id: 2, from: 'character', text: '你喜欢咖啡，我记住了' }
    const secondEcho: ChatMessage = { ...echo, id: 3, text: '原来的咖啡偏好' }
    const later: ChatMessage = { ...source, id: 4, text: '天气怎么样？' }
    const laterReply: ChatMessage = { ...echo, id: 5, text: '天气很好' }
    await saveConversation('lu', [source, echo, secondEcho, later, laterReply])
    await saveMemory(confirmed)
    const hook = await setup()
    if (action === 'delete') await act(() => hook.result.current.removeMemory('fact'))
    else await act(() => hook.result.current.editMemory('fact', { text: '我不喜欢咖啡' }))
    act(() => hook.result.current.setDraft('咖啡是什么口味？'))
    await act(() => hook.result.current.send())
    const request = stream.mock.calls.at(-1)![0]
    expect(request.messages.some(message => [1, 2, 3].includes(message.id))).toBe(false)
    expect(request.messages.some(message => message.id === 4)).toBe(true)
    expect(request.messages.some(message => message.id === 5)).toBe(true)
    expect(request.messages.at(-1)?.text).toBe('咖啡是什么口味？')
    const context = buildContext(request.characterId, request.messages, request.memories, request.summaries, request.memoryPolicy, request.onboardingProfile, request.locale, request.replyMode, request.memorySources)
    expect(JSON.stringify(context)).not.toContain('你喜欢咖啡，我记住了')
    expect(JSON.stringify(context)).not.toContain('原来的咖啡偏好')
    expect(JSON.stringify(context)).not.toContain('"text":"我喜欢咖啡"')
    if (action === 'correct') expect(context[0].content).toContain('我不喜欢咖啡')
    // Forgetting changes future context, not the user's retained chat transcript.
    expect((await loadLocalData()).conversations.lu?.find(message => message.id === 1)?.text).toBe(source.text)
  })

  it('recalls the corrected confirmed fact cross-character while keeping original wording and replies forgotten', async () => {
    await saveConversation('lu', [source, { ...source, id: 2, from: 'character', text: '原来的咖啡偏好回复' }])
    await saveMemory(confirmed)
    const hook = await setup()
    await act(() => hook.result.current.editMemory('fact', { text: '我不喜欢咖啡' }))
    act(() => { hook.result.current.setSelected('chen'); hook.result.current.setDraft('咖啡是什么口味？') })
    await act(() => hook.result.current.send())
    const request = stream.mock.calls.at(-1)![0]
    const prompt = buildContext(request.characterId, request.messages, request.memories, request.summaries, request.memoryPolicy, request.onboardingProfile, request.locale, request.replyMode, request.memorySources)[0].content
    expect(prompt).toContain('我不喜欢咖啡')
    expect(prompt).toContain('"sourceCharacterId":"lu"')
    expect(prompt).not.toContain('"text":"我喜欢咖啡"')
    expect(prompt).not.toContain('原来的咖啡偏好回复')
    expect(await forgottenSourceIds('lu')).toEqual([1])
  })

  it('never persists temporary conversations or supplies durable memories/summaries', async () => {
    await seed()
    const hook = await setup()
    const before = await loadLocalData()
    act(() => hook.result.current.toggleTemporary())
    act(() => hook.result.current.setDraft('我喜欢海边'))
    await act(() => hook.result.current.send())
    expect(hook.result.current.chatMessages.map(message => message.text)).toEqual(['我喜欢海边', '回复'])
    expect(stream.mock.calls.at(-1)![0]).toMatchObject({ memories: [], summaries: [] })
    expect(await loadLocalData()).toEqual(before)
    await expect(hook.result.current.saveConfirmed({ text: '临时偏好', category: 'profile' })).rejects.toThrow('临时会话')
    act(() => hook.result.current.toggleTemporary())
    expect(hook.result.current.chatMessages).toEqual([source])
    act(() => hook.result.current.toggleTemporary())
    expect(hook.result.current.chatMessages).toEqual([])
  })

  it('keeps stopped temporary partial output only in RAM and retries without duplicating the user', async () => {
    const hook = await setup()
    const before = await loadLocalData()
    act(() => hook.result.current.toggleTemporary())
    stream.mockImplementation(async request => {
      request.onDelta('temporary partial')
      await new Promise<void>((_, reject) => request.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
    })
    act(() => hook.result.current.setDraft('我喜欢咖啡'))
    let pending!: Promise<void>
    act(() => { pending = hook.result.current.send() })
    await waitFor(() => expect(stream).toHaveBeenCalledOnce())
    act(() => hook.result.current.stop())
    await act(() => pending)
    const user = hook.result.current.chatMessages.find(message => message.from === 'user')!
    expect(user.status).toBe('failed')
    expect(hook.result.current.chatMessages.at(-1)).toMatchObject({ text: 'temporary partial', status: 'failed' })
    expect(await loadLocalData()).toEqual(before)
    stream.mockImplementation(async request => request.onDelta('retried'))
    await act(() => hook.result.current.send({ retryId: user.id }))
    expect(hook.result.current.chatMessages.filter(message => message.from === 'user')).toHaveLength(1)
    expect(hook.result.current.chatMessages.at(-1)?.text).toBe('retried')
    expect(stream.mock.calls.at(-1)![0]).toMatchObject({ memories: [], summaries: [] })
    expect(await loadLocalData()).toEqual(before)
    hook.unmount()
    const restored = await setup()
    expect(restored.result.current.chatMessages).toEqual([])
    expect(restored.result.current.memories).toEqual([])
  })

  it('temporary withdrawal redacts only the in-memory source and never touches durable role data', async () => {
    await seed()
    const hook = await setup()
    const before = await loadLocalData()
    act(() => hook.result.current.toggleTemporary())
    act(() => hook.result.current.setDraft('我喜欢海边'))
    await act(() => hook.result.current.send())
    const temporaryId = hook.result.current.chatMessages.find(message => message.from === 'user')!.id
    await act(() => hook.result.current.withdraw(temporaryId))
    expect(hook.result.current.chatMessages.find(message => message.id === temporaryId)).toMatchObject({ withdrawn: true, text: '' })
    expect(await loadLocalData()).toEqual(before)
    act(() => hook.result.current.toggleTemporary())
    expect(hook.result.current.chatMessages).toEqual([source])
  })

  it('disabling a category excludes existing recall and digest generation while retaining raw chat', async () => {
    await seed()
    const hook = await setup()
    expect(await loadSummaries('lu')).toHaveLength(4)
    await act(() => hook.result.current.changePolicy('lu', { disabledCategories: ['profile'], extractionEnabled: true }))
    expect(await loadSummaries('lu')).toEqual([])
    expect((await loadLocalData()).conversations.lu).toEqual([source])
    act(() => hook.result.current.setDraft('咖啡是什么口味？'))
    await act(() => hook.result.current.send())
    const request = stream.mock.calls.at(-1)![0]
    const system = buildContext(request.characterId, request.messages, request.memories, request.summaries, request.memoryPolicy)[0].content
    expect(system).toContain('已确认记忆（引用数据）：[]')
    expect(hook.result.current.memories.filter(memory => memory.state === 'pending')).toEqual([])
  })

  it('disabling automatic organization leaves no persisted or rendered summaries', async () => {
    await seed()
    const hook = await setup()
    expect(await loadSummaries('lu')).toHaveLength(4)
    await act(() => hook.result.current.changePolicy('lu', { disabledCategories: [], extractionEnabled: false }))
    expect(await loadSummaries('lu')).toEqual([])
    expect(hook.result.current.summaries.filter(summary => summary.characterId === 'lu')).toEqual([])
    expect((await loadLocalData()).conversations.lu).toEqual([source])
  })

  it('a correction invalidates all original-source digest text across regeneration and reload', async () => {
    await seed()
    const hook = await setup()
    expect(await loadSummaries('lu')).toHaveLength(4)
    await act(() => hook.result.current.editMemory('fact', { text: '我不喜欢咖啡' }))
    expect(await loadSummaries('lu')).toEqual([])
    expect(await forgottenSourceIds('lu')).toEqual([1])
    expect(hook.result.current.memories.find(memory => memory.id === 'fact')?.text).toBe('我不喜欢咖啡')
    await act(() => hook.result.current.reload())
    await act(() => hook.result.current.changePolicy('lu', defaultMemoryPolicy))
    expect(await loadSummaries('lu')).toEqual([])
    expect(hook.result.current.memories).toHaveLength(1)
    expect((await loadLocalData()).conversations.lu?.[0].text).toBe(source.text)
  })

  it('rejection excludes proposal sources and prevents regeneration or duplicate proposals', async () => {
    await saveConversation('lu', [source])
    const hook = await setup()
    const proposal = hook.result.current.memories.find(memory => memory.sourceMessageId === source.id)!
    expect(proposal.state).toBe('pending')
    expect(await loadSummaries('lu')).toEqual([])
    await act(() => hook.result.current.editMemory(proposal.id, { state: 'rejected', enabled: false }))
    await act(() => hook.result.current.reload())
    await act(() => hook.result.current.changePolicy('lu', defaultMemoryPolicy))
    expect(await forgottenSourceIds('lu')).toEqual([1])
    expect(await loadSummaries('lu')).toEqual([])
    expect(hook.result.current.memories).toHaveLength(1)
    expect(hook.result.current.memories[0].state).toBe('rejected')
  })

  it('deletion does not reconstruct a memory from retained raw history after reload', async () => {
    await seed()
    const hook = await setup()
    await act(() => hook.result.current.removeMemory('fact'))
    await act(() => hook.result.current.reload())
    await act(() => hook.result.current.changePolicy('lu', defaultMemoryPolicy))
    expect(hook.result.current.memories).toEqual([])
    expect(await loadSummaries('lu')).toEqual([])
    expect(await forgottenSourceIds('lu')).toEqual([1])
    expect((await loadLocalData()).conversations.lu).toEqual([source])
  })

  it('withdrawal archives linked memories, redacts raw text and clears all summary references', async () => {
    await seed()
    const hook = await setup()
    await act(() => hook.result.current.withdraw(source.id))
    expect(hook.result.current.chatMessages[0]).toMatchObject({ withdrawn: true, text: '' })
    expect(hook.result.current.memories[0]).toMatchObject({ state: 'archived', enabled: false })
    expect(await forgottenSourceIds('lu')).toEqual([1])
    expect(await loadSummaries('lu')).toEqual([])
    await act(() => hook.result.current.reload())
    await act(() => hook.result.current.changePolicy('lu', defaultMemoryPolicy))
    expect(await loadSummaries('lu')).toEqual([])
    expect((await loadLocalData()).conversations.lu?.[0].text).toBe('')
  })
})
