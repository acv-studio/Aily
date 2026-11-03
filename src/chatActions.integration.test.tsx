import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPanel from './ChatPanel'
import { characters } from './data'
import useLocalChat from './useLocalChat'
import { streamReply, type ChatMessage } from './chatService'
import { db, loadLocalData, loadRoleConversation, saveConversation } from './db'
import { defaultMemoryPolicy } from './longMemory'

vi.mock('./chatService', async () => ({ ...await vi.importActual('./chatService'), streamReply: vi.fn() }))
const stream = vi.mocked(streamReply)
const source: ChatMessage = { id: 1, from: 'user', text: '仅此一条的原始内容', time: '现在', status: 'sent', createdAt: '2026-01-01T00:00:00.000Z' }
const echo: ChatMessage = { ...source, id: 2, from: 'character', text: '对原始内容的回复' }
const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear(); await db.delete(); await db.open(); stream.mockReset()
  stream.mockImplementation(async request => request.onDelta('回复'))
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (originalScrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView)
  else delete (Element.prototype as Partial<Element>).scrollIntoView
})
async function setup() {
  const hook = renderHook(useLocalChat)
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  // Drain startup organization before disk snapshots or mode changes.
  await act(() => hook.result.current.changePolicy('lu', defaultMemoryPolicy))
  return hook
}
async function send(hook: Awaited<ReturnType<typeof setup>>, text: string) {
  act(() => hook.result.current.setDraft(text))
  await act(() => hook.result.current.send())
}

// Exercise the real ChatPanel against the live hook rather than a mocked withdraw callback.
let panelChat: ReturnType<typeof useLocalChat>
function ChatHarness() {
  panelChat = useLocalChat()
  return <ChatPanel character={characters[0]} messages={panelChat.chatMessages} draft={panelChat.draft}
    setDraft={panelChat.setDraft} send={panelChat.send} saveMemory={panelChat.saveConfirmed}
    withdraw={panelChat.withdraw} close={() => {}} stop={panelChat.stop} replying={panelChat.replying}
    error={panelChat.error} temporary={panelChat.temporary} demo openGame={() => {}} openStory={() => {}} />
}

describe('chat withdrawal integration', () => {
  it('persists a normal user withdrawal and restores the tombstone after reload and remount', async () => {
    const hook = await setup()
    await send(hook, source.text)
    const user = hook.result.current.chatMessages.find(message => message.from === 'user')!
    const reply = hook.result.current.chatMessages.find(message => message.from === 'character')!
    await act(() => hook.result.current.withdraw(user.id))
    const expected = { ...user, withdrawn: true, text: '' }
    expect(hook.result.current.chatMessages).toEqual([expected, reply])
    expect(await loadRoleConversation('lu')).toEqual([expected, reply])
    await act(() => hook.result.current.reload())
    await act(() => hook.result.current.changePolicy('lu', defaultMemoryPolicy))
    expect(hook.result.current.chatMessages).toEqual([expected, reply])
    hook.unmount()
    const restored = await setup()
    expect(restored.result.current.chatMessages).toEqual([expected, reply])
  })

  it('rejects a stale remember-this draft after withdrawal without recreating enabled memory', async () => {
    await saveConversation('lu', [source, echo])
    const hook = await setup()
    const staleDraft = { text: source.text, category: 'profile' as const, sourceMessageId: source.id }
    await act(() => hook.result.current.withdraw(source.id))
    const before = await loadLocalData()
    await act(async () => { await expect(hook.result.current.saveConfirmed(staleDraft)).rejects.toThrow() })
    expect(hook.result.current.memories.filter(memory => memory.enabled !== false && memory.state === 'confirmed')).toEqual([])
    expect(await loadLocalData()).toEqual(before)
    await act(() => hook.result.current.reload())
    await act(() => hook.result.current.changePolicy('lu', defaultMemoryPolicy))
    expect(hook.result.current.memories.filter(memory => memory.enabled !== false && memory.state === 'confirmed')).toEqual([])
  })

  it('redacts local attachment bytes together with withdrawn text on disk and after reload', async () => {
    await saveConversation('lu', [{ ...source, kind: 'image', attachment: { dataUrl: 'data:image/png;base64,c2VjcmV0', mimeType: 'image/png', name: 'private.png' } }])
    const hook = await setup()
    await act(() => hook.result.current.withdraw(source.id))
    expect(hook.result.current.chatMessages[0]).toMatchObject({ withdrawn: true, text: '' })
    expect(hook.result.current.chatMessages[0].attachment).toBeUndefined()
    expect((await loadRoleConversation('lu'))[0].attachment).toBeUndefined()
    await act(() => hook.result.current.reload())
    await act(() => hook.result.current.changePolicy('lu', defaultMemoryPolicy))
    expect(hook.result.current.chatMessages[0].attachment).toBeUndefined()
  })

  it('makes saved quotes and an active quote preview unavailable after their source is withdrawn', async () => {
    await saveConversation('lu', [source, echo, { ...source, id: 3, text: '引用后的新消息', replyToId: source.id }])
    const view = render(<ChatHarness />)
    await waitFor(() => expect(panelChat.ready).toBe(true))
    await act(() => panelChat.changePolicy('lu', defaultMemoryPolicy))
    expect(view.container.querySelector('blockquote')).toHaveTextContent(source.text)
    fireEvent.click(screen.getByRole('button', { name: `引用消息 ${source.id}` }))
    expect(view.container.querySelector('.quoted-preview')).toHaveTextContent(source.text)
    await act(() => panelChat.withdraw(source.id))
    expect(view.container.querySelector('blockquote')).toHaveTextContent('引用的消息已撤回')
    expect(view.container.querySelector('.quoted-preview')).toBeNull()
    expect(screen.queryByText(source.text)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `引用消息 ${source.id}` })).not.toBeInTheDocument()
    expect(screen.getByText('你撤回了一条消息')).toBeInTheDocument()
    await act(() => panelChat.reload())
    await act(() => panelChat.changePolicy('lu', defaultMemoryPolicy))
    expect(view.container.querySelector('blockquote')).toHaveTextContent('引用的消息已撤回')
    expect((await loadRoleConversation('lu')).find(message => message.id === 3)?.replyToId).toBe(source.id)
  })

  it.each(['user', 'character'] as const)('persists an available %s quote target through reload', async from => {
    await saveConversation('lu', [{ ...source, from }])
    const hook = await setup()
    act(() => hook.result.current.setDraft('新的引用回复'))
    await act(() => hook.result.current.send({ replyToId: source.id }))
    const user = hook.result.current.chatMessages.filter(message => message.from === 'user').at(-1)!
    expect(user.replyToId).toBe(source.id)
    await act(() => hook.result.current.reload())
    await act(() => hook.result.current.changePolicy('lu', defaultMemoryPolicy))
    expect(hook.result.current.chatMessages.find(message => message.id === user.id)?.replyToId).toBe(source.id)
  })

  it.each(['missing', 'withdrawn', 'sending', 'other-role'] as const)('does not persist an unavailable quote target (%s)', async reason => {
    const target = { ...source, ...(reason === 'withdrawn' ? { withdrawn: true, text: '' } : {}), ...(reason === 'sending' ? { status: 'sending' as const } : {}) }
    if (reason === 'other-role') await saveConversation('chen', [target])
    else if (reason !== 'missing') await saveConversation('lu', [target])
    const hook = await setup()
    // Loading recovers interrupted sending rows; exercise the current in-flight state explicitly.
    if (reason === 'sending') act(() => hook.result.current.setConversations(previous => ({ ...previous, lu: [{ ...target, status: 'sending' }] })))
    act(() => hook.result.current.setDraft('新的引用回复'))
    await act(() => hook.result.current.send({ replyToId: source.id }))
    const user = hook.result.current.chatMessages.filter(message => message.from === 'user').at(-1)!
    expect(user.text).toBe('新的引用回复')
    expect(user.replyToId).toBeUndefined()
    expect((await loadRoleConversation('lu')).find(message => message.id === user.id)?.replyToId).toBeUndefined()
  })

  it('withdraws temporary content only in RAM without changing any durable data', async () => {
    await saveConversation('lu', [source, echo])
    const hook = await setup()
    const before = await loadLocalData()
    act(() => hook.result.current.toggleTemporary())
    await send(hook, '临时内容')
    const user = hook.result.current.chatMessages.find(message => message.from === 'user')!
    await act(() => hook.result.current.withdraw(user.id))
    expect(hook.result.current.chatMessages.find(message => message.id === user.id)).toMatchObject({ withdrawn: true, text: '' })
    expect(await loadLocalData()).toEqual(before)
    act(() => hook.result.current.toggleTemporary())
    expect(hook.result.current.chatMessages).toEqual([source, echo])
    act(() => hook.result.current.toggleTemporary())
    expect(hook.result.current.chatMessages).toEqual([])
    expect(await loadLocalData()).toEqual(before)
  })

  it.each([false, true])('cannot withdraw character messages (temporary=%s)', async temporary => {
    await saveConversation('lu', [source, echo])
    const hook = await setup()
    if (temporary) {
      act(() => hook.result.current.toggleTemporary())
      await send(hook, '临时内容')
    }
    const messages = hook.result.current.chatMessages
    const before = await loadLocalData()
    const character = messages.find(message => message.from === 'character')!
    await act(() => hook.result.current.withdraw(character.id))
    expect(hook.result.current.chatMessages).toEqual(messages)
    expect(await loadLocalData()).toEqual(before)
  })

  it.each([false, true])('sends no withdrawn source or its assistant echoes to an external service (temporary=%s)', async temporary => {
    const hook = await setup()
    if (temporary) act(() => hook.result.current.toggleTemporary())
    // Neutral text deliberately produces no linked memory: privacy must not depend on extraction.
    stream.mockImplementation(async request => request.onDelta('secret-response-marker'))
    await send(hook, 'secret-source-marker')
    const user = hook.result.current.chatMessages.find(message => message.from === 'user')!
    expect(hook.result.current.memories).toEqual([])
    await act(() => hook.result.current.withdraw(user.id))
    stream.mockImplementation(async request => request.onDelta('unrelated-response-marker'))
    await send(hook, 'unrelated-turn-marker')
    await act(() => hook.result.current.changePolicy('lu', defaultMemoryPolicy))
    const actualService = await vi.importActual<typeof import('./chatService')>('./chatService')
    stream.mockImplementation(actualService.streamReply)
    const fetchMock = vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"external reply"}}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    act(() => hook.result.current.setApiKey('test-key'))
    await send(hook, 'current-turn-marker')
    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    const context = JSON.stringify(body.messages)
    expect(context).not.toContain('secret-source-marker')
    expect(context).not.toContain('secret-response-marker')
    expect(context).toContain('unrelated-turn-marker')
    expect(context).toContain('unrelated-response-marker')
    expect(context).toContain('current-turn-marker')
    // Privacy changes future requests, not the locally retained assistant transcript.
    expect(hook.result.current.chatMessages.some(message => message.text === 'secret-response-marker')).toBe(true)
  })
})
