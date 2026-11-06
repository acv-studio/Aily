import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ reserve: vi.fn(), commit: vi.fn(), release: vi.fn() }))
vi.mock('./billing', () => ({ reservePoints: mocks.reserve }))
import { streamReply, interpretDivination, testDeepSeekConnection } from './chatService'

afterEach(() => {
  vi.restoreAllMocks()
  mocks.reserve.mockReset(); mocks.commit.mockReset(); mocks.release.mockReset()
})
const request = { characterId: 'lu' as const, messages: [{ id: 1, from: 'user' as const, text: 'Hi', time: '' }], memories: [], apiKey: 'test', endpoint: 'http://127.0.0.1:3425/v1/messages', model: 'test', onDelta: vi.fn() }
const divination = { apiKey: 'test', endpoint: request.endpoint, model: 'test', question: 'reflection', original: '乾', nuclear: '乾', changed: '坤', movingLine: 1 }
function setup() {
  mocks.reserve.mockResolvedValue({ commit: mocks.commit.mockResolvedValue(undefined), release: mocks.release.mockResolvedValue(undefined) })
}
function reply(text = 'Hi there') { return new Response(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' })) }

describe('model reservation lifecycle', () => {
  it('charges five points only after a successful spoken model round', async () => {
    setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply())
    const onDelta = vi.fn()
    await streamReply({ ...request, onDelta, billingCost: 5 })
    expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith(5)
    expect(mocks.commit).toHaveBeenCalledTimes(1)
    expect(mocks.release).toHaveBeenCalledTimes(1)
    expect(mocks.commit.mock.invocationCallOrder[0]).toBeLessThan(onDelta.mock.invocationCallOrder[0])
    expect(mocks.commit.mock.invocationCallOrder[0]).toBeLessThan(mocks.release.mock.invocationCallOrder[0])
  })

  it('charges a text model round one point', async () => {
    setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply())
    await streamReply(request)
    expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith(1)
    expect(mocks.commit).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['HTTP error', () => new Response('failed', { status: 500 })],
    ['empty text', () => reply('  ')],
    ['invalid JSON', () => new Response('{invalid')],
    ['missing content', () => new Response(JSON.stringify({ content: [] }))],
  ])('releases without committing after %s', async (_name, response) => {
    setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response())
    const onDelta = vi.fn()
    await expect(streamReply({ ...request, onDelta })).rejects.toThrow()
    expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith(1)
    expect(mocks.commit).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledTimes(1)
    expect(onDelta).not.toHaveBeenCalled()
  })

  it('releases after a network failure', async () => {
    setup()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(streamReply(request)).rejects.toThrow()
    expect(mocks.commit).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })

  it('releases an in-flight aborted request without committing', async () => {
    setup()
    const controller = new AbortController()
    let started!: () => void
    const began = new Promise<void>(resolve => { started = resolve })
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => { started(); return new Promise<Response>(() => {}) })
    const result = streamReply({ ...request, signal: controller.signal })
    // Attach a rejection handler before aborting to avoid an unhandled rejection.
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await began
    controller.abort(new Error('cancelled'))
    await assertion
    expect(mocks.commit).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })

  it('does not reserve or contact a provider when already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('already cancelled'))
    const fetch = vi.spyOn(globalThis, 'fetch')
    await expect(streamReply({ ...request, signal: controller.signal })).rejects.toThrow('already cancelled')
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not call a model if shared points are insufficient', async () => {
    mocks.reserve.mockRejectedValue(new Error('积分不足'))
    const fetch = vi.spyOn(globalThis, 'fetch')
    await expect(streamReply(request)).rejects.toThrow('积分不足')
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
    expect(mocks.release).not.toHaveBeenCalled()
  })

  it('does not publish a successful response if reservation commit expires, and still releases it', async () => {
    setup()
    mocks.commit.mockRejectedValue(new Error('请求已过期，请重试'))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply())
    const onDelta = vi.fn()
    await expect(streamReply({ ...request, onDelta })).rejects.toThrow('请求已过期')
    expect(mocks.commit).toHaveBeenCalledTimes(1)
    expect(mocks.release).toHaveBeenCalledTimes(1)
    expect(onDelta).not.toHaveBeenCalled()
  })

  it('releases a nonempty incomplete SSE round when completion is required', async () => {
    setup()
    const partial = `data: ${JSON.stringify({ choices: [{ delta: { content: 'Incomplete reply' } }] })}\n\n`
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(partial))
    const onDelta = vi.fn()
    await expect(streamReply({ ...request, endpoint: 'https://api.deepseek.com/chat/completions', requireCompletion: true, onDelta })).rejects.toThrow('模型响应中断')
    expect(mocks.commit).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledTimes(1)
    expect(onDelta).not.toHaveBeenCalled()
  })

  it('does not charge API connection probes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply())
    await expect(testDeepSeekConnection({ apiKey: 'test', endpoint: request.endpoint, model: 'test' })).resolves.toBe(true)
    expect(mocks.reserve).not.toHaveBeenCalled()
  })

  it('keeps on-device crisis support outside billing and provider calls', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const onDelta = vi.fn(), onLocalSafety = vi.fn()
    await streamReply({ ...request, messages: [{ id: 1, from: 'user', text: 'I want to kill myself tonight', time: '' }], onDelta, onLocalSafety })
    expect(onLocalSafety).toHaveBeenCalledTimes(1)
    expect(onDelta).toHaveBeenCalledTimes(1)
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('divination shared point pool', () => {
  it('charges one point only after a nonempty result', async () => {
    setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply('Reflect on your next step.'))
    await expect(interpretDivination(divination)).resolves.toBe('Reflect on your next step.')
    expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith(1)
    expect(mocks.commit).toHaveBeenCalledTimes(1)
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['HTTP error', () => new Response('failed', { status: 500 })],
    ['empty interpretation', () => reply(' ')],
    ['invalid JSON', () => new Response('{invalid')],
  ])('releases without charge after %s', async (_name, response) => {
    setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response())
    await expect(interpretDivination(divination)).rejects.toThrow()
    expect(mocks.commit).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })

  it('does not contact the divination model after insufficient shared points', async () => {
    mocks.reserve.mockRejectedValue(new Error('积分不足'))
    const fetch = vi.spyOn(globalThis, 'fetch')
    await expect(interpretDivination(divination)).rejects.toThrow('积分不足')
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.release).not.toHaveBeenCalled()
  })
})
