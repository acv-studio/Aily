import { afterEach, describe, expect, it, vi } from 'vitest'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { streamReply, testDeepSeekConnection } from './chatService'
vi.mock('./billing', () => ({ reservePoints: vi.fn(async () => ({ commit: async () => {}, release: async () => {} })) }))
vi.mock('@capacitor/core', async importOriginal => { const actual = await importOriginal<typeof import('@capacitor/core')>(); return { ...actual, Capacitor: { ...actual.Capacitor, isNativePlatform: vi.fn(() => false) }, CapacitorHttp: { request: vi.fn() } } })
afterEach(() => vi.restoreAllMocks())
describe('OpenAI gateway wire protocol', () => {
  it('tests a custom /v1 URL using OpenAI bearer authentication and a configured model', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false)
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }))
    await expect(testDeepSeekConnection({ endpoint: 'https://gateway.example/v1', apiKey: 'custom-key', model: 'my-model' })).resolves.toBe(true)
    const [url, request] = fetch.mock.calls[0]
    expect(url).toBe('https://gateway.example/v1/chat/completions')
    expect(request?.headers).toMatchObject({ Authorization: 'Bearer custom-key' })
    expect(JSON.parse(request?.body as string)).toMatchObject({ model: 'my-model', stream: false })
  })
  it('uses native JSON HTTP for Android-host-compatible gateway URLs without CORS or fake SSE', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
    const http = vi.spyOn(CapacitorHttp, 'request').mockResolvedValue({ status: 200, headers: {}, url: '', data: { choices: [{ message: { content: '你好' } }] } })
    const fetch = vi.spyOn(globalThis, 'fetch'), onDelta = vi.fn()
    await streamReply({ endpoint: 'http://10.0.2.2:8000/v1', apiKey: 'local-key', model: 'local-model', characterId: 'lu', messages: [{ id: 1, from: 'user', text: '你好', time: '12:00' }], memories: [], onDelta })
    expect(http).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://10.0.2.2:8000/v1/chat/completions', headers: expect.objectContaining({ authorization: 'Bearer local-key' }), data: expect.objectContaining({ model: 'local-model', stream: false, messages: expect.any(Array) }) }))
    expect(fetch).not.toHaveBeenCalled(); expect(onDelta).toHaveBeenCalledWith('你好')
  })
  it('removes native-compatible gateway outer blank lines but preserves paragraph breaks', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
    vi.spyOn(CapacitorHttp, 'request').mockResolvedValue({ status: 200, headers: {}, url: '', data: { choices: [{ message: { content: '\n\n你好。\n\n今天想聊什么？  \n' } }] } })
    const onDelta = vi.fn()
    await streamReply({ endpoint: 'http://10.0.2.2:8000/v1', apiKey: 'local-key', model: 'local-model', characterId: 'lu', messages: [{ id: 1, from: 'user', text: '你好', time: '12:00' }], memories: [], onDelta })
    expect(onDelta).toHaveBeenCalledExactlyOnceWith('你好。\n\n今天想聊什么？')
  })
  it('removes streamed gateway outer whitespace while retaining internal formatting', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false)
    const sse = ['data: {"choices":[{"delta":{"content":"\\n\\n【虚构场景】\\n第一段。"}}]}', '', 'data: {"choices":[{"delta":{"content":"\\n\\n第二段。  \\n"},"finish_reason":"stop"}]}', '', 'data: [DONE]', '', ''].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    const onDelta = vi.fn()
    await streamReply({ endpoint: 'https://gateway.example/v1/chat/completions', apiKey: 'custom-key', model: 'model', characterId: 'lu', messages: [{ id: 1, from: 'user', text: '你好', time: '12:00' }], memories: [], onDelta })
    expect(onDelta).toHaveBeenCalledExactlyOnceWith('【虚构场景】\n第一段。\n\n第二段。')
  })
  it('blocks nonlocal plaintext HTTP before sending credentials', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    await expect(testDeepSeekConnection({ endpoint: 'http://external.example/v1', apiKey: 'secret', model: 'model' })).rejects.toThrow('API 地址')
    expect(fetch).not.toHaveBeenCalled()
  })
})
