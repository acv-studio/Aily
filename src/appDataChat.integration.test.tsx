import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useLocalChat from './useLocalChat'
import { db, loadLocalData, persistChatChanges } from './db'
import { defaultOnboardingProfile } from './onboarding'
import { buildContext, streamReply } from './chatService'
import { approveAppDataPreview, invalidateAppDataAccess, previewAppData } from './appDataGateway'
import { initializeAppDataProviders } from './appDataProviders'
import { setExtensionInstalled } from './extensionApps'
import { mediaDb } from './mediaLibrary'
import type { AppDataIdentity } from './appDataTypes'

vi.mock('./billing', () => ({ reservePoints: vi.fn(async () => ({ commit: vi.fn(async () => {}), release: vi.fn(async () => {}) })) }))
const question = '请总结所选应用的收支'
const identity: AppDataIdentity = { role: 'lu', primaryId: 'lu', temporary: false, endpoint: 'https://api.example.test/v1/chat/completions', model: 'test-model' }
const ledger = [{ id: 'entry', kind: 'expense', cents: 1234, date: '2026-11-01', note: 'NEVER-SEND-UNAUTHORIZED-NOTE', category: 'food' }]
let fetchMock: ReturnType<typeof vi.spyOn>
beforeEach(async () => {
  vi.stubGlobal('Blob', NodeBlob)
  localStorage.clear(); sessionStorage.clear(); invalidateAppDataAccess()
  await db.delete(); await db.open(); await mediaDb.items.clear(); await mediaDb.photoDecisions.clear(); initializeAppDataProviders()
  localStorage.setItem('aily-desktop-ledger', JSON.stringify(ledger))
  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input).endsWith('/messages')) return new Response(JSON.stringify({ content: [{ type: 'text', text: 'CONFIDENTIAL-APP-ANSWER' }] }), { headers: { 'Content-Type': 'application/json' } })
    const text = `data: ${JSON.stringify({ choices: [{ delta: { content: 'CONFIDENTIAL-APP-ANSWER' } }] })}\n\ndata: [DONE]\n\n`
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close() } }))
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); invalidateAppDataAccess() })
async function ticket(who = identity, text = question) {
  return approveAppDataPreview(await previewAppData([{ appId: 'ledger', scope: 'totals' }], { text, limit: 20 }, who, new AbortController().signal))
}
async function hookSetup() {
  const hook = renderHook(useLocalChat)
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  await act(() => hook.result.current.finishOnboarding(defaultOnboardingProfile('lu')))
  act(() => { hook.result.current.setApiKey('test-key'); hook.result.current.setEndpoint(identity.endpoint); hook.result.current.setModel(identity.model) })
  return hook
}
const body = (index: number) => String(fetchMock.mock.calls[index][1]?.body)
describe('app data through the real model and persistence pipeline', () => {
  it.each(['最近的纪念日', '我相册里面有几张照片'])('routes the newest screenshot phrase through real local repositories without a model request: %s', async text => {
    const hook = await hookSetup()
    let expected: string
    if (text.includes('相册')) {
      await mediaDb.items.bulkAdd(Array.from({ length: 3 }, (_, index) => ({ id: `photo-${index}`, kind: 'album' as const, name: `PRIVATE-PHOTO-${index}`, blob: new Blob(['fake'], { type: 'image/png' }), mime: 'image/png', addedAt: new Date().toISOString(), favorite: false, collection: '' })))
      expected = '照片数量：3'
    } else {
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
      const monthDay = `${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
      setExtensionInstalled('anniversary', true)
      localStorage.setItem('aily.ext.anniversary', JSON.stringify([{ id: 'one', name: 'PRIVATE-UPCOMING-ANNIVERSARY', date: `2000-${monthDay}`, yearly: true }]))
      expected = `下一次日期：${tomorrow.getFullYear()}-${monthDay}`
    }
    await act(() => hook.result.current.send({ text }))
    const answer = hook.result.current.chatMessages.at(-1)!
    expect(answer.text).toContain(expected)
    expect(answer).toMatchObject({ localOnly: true, appDataReply: true, status: 'sent' })
    expect(hook.result.current.error).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
    await act(() => hook.result.current.send({ text: '你好，我们聊点别的' }))
    expect(body(0)).not.toContain('PRIVATE-UPCOMING-ANNIVERSARY')
    expect(body(0)).not.toContain('PRIVATE-PHOTO-')
    expect(body(0)).toContain('宿主应用能力')
    await act(() => hook.result.current.beforeDataChange())
  })
  it('answers the screenshot question from real installation state without invoking the model or reading private records', async () => {
    const hook = await hookSetup()
    setExtensionInstalled('meal-planner', true)
    setExtensionInstalled('skincare-diary', true)
    await act(() => hook.result.current.send({ text: '我安装了哪些软件' }))
    const answer = hook.result.current.chatMessages.at(-1)!
    expect(answer.text).toContain('安装了 2 个小应用')
    expect(answer.text).toContain('吃什么')
    expect(answer.text).toContain('护肤日记')
    expect(answer).toMatchObject({ localOnly: true, appDataReply: true, status: 'sent' })
    expect(fetchMock).not.toHaveBeenCalled()
    setExtensionInstalled('meal-planner', false)
    await act(() => hook.result.current.send({ text: '我安装了哪些软件' }))
    expect(hook.result.current.chatMessages.at(-1)!.text).toContain('安装了 1 个小应用')
    expect(hook.result.current.chatMessages.at(-1)!.text).not.toContain('吃什么')
    expect(fetchMock).not.toHaveBeenCalled()
    await act(() => hook.result.current.beforeDataChange())
  })
  it('retries the failed anniversary screenshot locally without duplicating the original user message or sending App data', async () => {
    const hook = await hookSetup()
    setExtensionInstalled('anniversary', true)
    localStorage.setItem('aily.ext.anniversary', JSON.stringify([{ id: 'one', name: 'PRIVATE-ANNIVERSARY', date: '2026-12-01', yearly: true }]))
    await persistChatChanges('lu', [{ id: 100, from: 'user', text: '纪念日有哪些数据', time: '17:19', status: 'failed' }])
    await act(() => hook.result.current.reload())
    await act(() => hook.result.current.send({ retryId: 100 }))
    expect(hook.result.current.chatMessages.filter(message => message.id === 100)).toHaveLength(1)
    expect(hook.result.current.chatMessages.find(message => message.id === 100)?.status).toBe('sent')
    expect(hook.result.current.chatMessages.at(-1)).toMatchObject({ appDataReply: true, localOnly: true, status: 'sent' })
    expect(hook.result.current.chatMessages.at(-1)!.text).toContain('PRIVATE-ANNIVERSARY')
    expect(fetchMock).not.toHaveBeenCalled()
    await act(() => hook.result.current.send({ text: '继续聊聊吧' }))
    expect(body(0)).not.toContain('PRIVATE-ANNIVERSARY')
    await act(() => hook.result.current.beforeDataChange())
  })
  it('answers an empty named App with no-records copy rather than a network error', async () => {
    const hook = await hookSetup()
    setExtensionInstalled('anniversary', true)
    await act(() => hook.result.current.send({ text: '纪念日有哪些数据' }))
    expect(hook.result.current.chatMessages.at(-1)!.text).toContain('没有已保存记录')
    expect(hook.result.current.error).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
    await act(() => hook.result.current.beforeDataChange())
  })
  it.each(['https://api.example.test/v1/chat/completions', 'https://api.example.test/v1/messages'])('adds the same sanitized data block to provider %s, never source revisions or unselected notes', async endpoint => {
    const who = { ...identity, endpoint }
    const capability = await ticket(who)
    await streamReply({ characterId: 'lu', messages: [{ id: 1, from: 'user', text: question, time: '' }], memories: [], apiKey: 'test-key', endpoint, model: who.model, appDataTicket: capability, appDataIdentity: () => who, onDelta: vi.fn(), requireCompletion: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(body(0)).toContain('APP_DATA_JSON')
    expect(body(0)).toContain('1234')
    expect(body(0)).toContain('expenseCents')
    expect(body(0)).not.toContain('NEVER-SEND-UNAUTHORIZED-NOTE')
    const payload = JSON.parse(body(0))
    const system = payload.system || payload.messages[0].content
    const block = JSON.parse(system.split('APP_DATA_JSON\n')[1])
    expect(block[0].result).not.toHaveProperty('revision')
  })
  it('rejects forged and stale capabilities before any model request', async () => {
    const request = { characterId: 'lu' as const, messages: [{ id: 1, from: 'user' as const, text: question, time: '' }], memories: [], apiKey: 'key', endpoint: identity.endpoint, model: identity.model, appDataIdentity: () => identity, onDelta: vi.fn() }
    await expect(streamReply({ ...request, appDataTicket: { token: 'forged' } })).rejects.toThrow()
    const capability = await ticket()
    localStorage.setItem('aily-desktop-ledger', JSON.stringify([...ledger, { ...ledger[0], id: 'new', cents: 9999 }]))
    await expect(streamReply({ ...request, appDataTicket: capability })).rejects.toThrow('source changed')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('checks identity again after asynchronous source reads', async () => {
    const capability = await ticket()
    let called = 0
    await expect(streamReply({ characterId: 'lu', messages: [{ id: 1, from: 'user', text: question, time: '' }], memories: [], apiKey: 'key', endpoint: identity.endpoint, model: identity.model, appDataTicket: capability, appDataIdentity: () => (++called === 1 ? identity : { ...identity, primaryId: 'chen' }), onDelta: vi.fn() })).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('persists app-derived answers as local-only and never replays them via history, quotes, summaries or memory', async () => {
    const hook = await hookSetup()
    const capability = await ticket(hook.result.current.appDataIdentity())
    await act(() => hook.result.current.send({ text: question, appDataTicket: capability, rejectOnFailure: true }))
    const answer = hook.result.current.chatMessages.find(message => message.appDataReply)
    expect(answer).toMatchObject({ localOnly: true, status: 'sent', appDataReply: true })
    expect(answer?.text).toContain('CONFIDENTIAL-APP-ANSWER')
    expect(hook.result.current.chatMessages[0].appDataRequest).toBe(true)
    await act(() => hook.result.current.beforeDataChange())
    expect(hook.result.current.summaries.map(summary => summary.text).join('')).not.toContain('CONFIDENTIAL-APP-ANSWER')
    await expect(hook.result.current.saveConfirmed({ text: 'CONFIDENTIAL-APP-ANSWER', category: 'profile', sourceMessageId: answer!.id })).rejects.toThrow('不可用')
    // An old/imported digest must not revive a local-only source after orchestration filters it out.
    await db.summaries.put({ id: 'stale-app-summary', characterId: 'lu', period: 'day', periodKey: '2026-11-01', text: '咖啡 STALE-PRIVATE-APP-SUMMARY', sourceMessageIds: [answer!.id], updatedAt: new Date().toISOString() })
    await act(() => hook.result.current.send({ text: '聊聊咖啡吧', replyToId: answer!.id }))
    expect(body(1)).not.toContain('CONFIDENTIAL-APP-ANSWER')
    expect(body(1)).not.toContain('APP_DATA_JSON')
    expect(body(1)).not.toContain('STALE-PRIVATE-APP-SUMMARY')
    const stored = await loadLocalData()
    expect(stored.conversations.lu?.find(message => message.id === answer!.id)).toMatchObject({ localOnly: true, appDataReply: true })
    expect(JSON.stringify(stored)).not.toContain('NEVER-SEND-UNAUTHORIZED-NOTE')
    const context = JSON.stringify(buildContext('lu', stored.conversations.lu || [], [], []))
    expect(context).not.toContain('【应用数据来源：')
    await act(() => hook.result.current.beforeDataChange())
  })
  it('never reuses a ticket for retry and requires fresh authorization after failure', async () => {
    const hook = await hookSetup()
    const capability = await ticket(hook.result.current.appDataIdentity())
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await act(async () => { await expect(hook.result.current.send({ text: question, appDataTicket: capability, rejectOnFailure: true })).rejects.toThrow() })
    const user = hook.result.current.chatMessages.find(message => message.appDataRequest)!
    await act(() => hook.result.current.send({ retryId: user.id }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(hook.result.current.error).toContain('重新选择数据')
    await act(async () => { await expect(hook.result.current.send({ text: question, appDataTicket: capability, rejectOnFailure: true })).rejects.toThrow() })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(() => hook.result.current.beforeDataChange())
  })
  it('does not pass app data to demo replies or safety responses', async () => {
    const capability = await ticket()
    await expect(streamReply({ characterId: 'lu', messages: [{ id: 1, from: 'user', text: question, time: '' }], memories: [], endpoint: identity.endpoint, model: identity.model, appDataTicket: capability, appDataIdentity: () => identity, onDelta: vi.fn() })).rejects.toThrow('演示')
    const safe = vi.fn()
    const safetyTicket = await ticket(identity, '我要自杀')
    await streamReply({ characterId: 'lu', messages: [{ id: 1, from: 'user', text: '我要自杀', time: '' }], memories: [], apiKey: 'key', appDataTicket: safetyTicket, appDataIdentity: () => identity, onDelta: safe })
    expect(safe).toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled()
  })
})
