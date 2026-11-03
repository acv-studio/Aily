import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useLocalChat from './useLocalChat'
import { db, loadLocalData } from './db'
import { streamReply } from './chatService'

vi.mock('./chatService', async () => ({ ...await vi.importActual('./chatService'), streamReply: vi.fn() }))
const stream = vi.mocked(streamReply)
beforeEach(async () => { localStorage.clear(); sessionStorage.clear(); await db.delete(); await db.open(); stream.mockReset() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
async function setup() { const hook = renderHook(useLocalChat); await waitFor(() => expect(hook.result.current.ready).toBe(true)); return hook }

describe('durable chat orchestration', () => {
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
