import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildRequestContext, streamReply, type ChatMessage } from './chatService'
const image = (id: number): ChatMessage => ({ id, from: 'user', text: '这是什么？', time: '', kind: 'image', attachment: { dataUrl: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png', name: 'photo.png' } })
const base = { characterId: 'lu' as const, messages: [image(1), image(2)], memories: [] }
afterEach(() => vi.restoreAllMocks())
describe('explicit current-turn vision transport', () => {
  it('requires consent without changing existing text context', () => {
    expect(() => buildRequestContext(base)).toThrow('确认')
    expect(buildRequestContext({ ...base, messages: [{ id: 3, from: 'user', text: '你好', time: '' }] }).at(-1)?.content).toBe('你好')
  })
  it('includes only current photo, never historical photos or withdrawn content', () => {
    const old = { ...image(1), text: 'private-old', attachment: { ...image(1).attachment!, dataUrl: 'data:image/png;base64,b2xk' } }
    const context = buildRequestContext({ ...base, messages: [old, image(2)], imageConsent: true })
    expect(context.at(-1)?.content).toEqual([{ type: 'text', text: '这是什么？' }, { type: 'image_url', image_url: { url: image(2).attachment!.dataUrl } }])
    expect(JSON.stringify(context)).not.toContain('private-old')
    expect(JSON.stringify(context)).not.toContain('b2xk')
    expect(JSON.stringify(buildRequestContext({ ...base, messages: [{ ...image(1), withdrawn: true }], imageConsent: true }))).not.toContain('image_url')
  })
  it.each(['https://example.com/photo.png', 'data:image/svg+xml;base64,aGVsbG8=', 'data:image/png;base64,!invalid!', 'data:image/jpeg;base64,aGVsbG8='])('rejects invalid image %s before network', dataUrl => {
    expect(() => buildRequestContext({ ...base, messages: [{ ...image(1), attachment: { ...image(1).attachment!, dataUrl } }], imageConsent: true })).toThrow('图片格式')
  })
  it('bounds payload and refuses demo vision without network', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    await expect(streamReply({ ...base, onDelta: vi.fn(), imageConsent: true })).rejects.toThrow('有效 API Key')
    expect(fetch).not.toHaveBeenCalled()
    expect(() => buildRequestContext({ ...base, messages: [{ ...image(1), attachment: { ...image(1).attachment!, dataUrl: 'data:image/png;base64,' + 'A'.repeat(4 * 1024 * 1024 + 4) } }], imageConsent: true })).toThrow('3MB')
  })
  it('streams multimodal content using configured endpoint/model with same lifecycle', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"图片回复"}}]}\n\ndata: [DONE]\n\n'))
    const onDelta = vi.fn()
    await streamReply({ ...base, apiKey: 'mock-test-only', endpoint: 'https://example.com/chat/completions', model: 'vision-model', imageConsent: true, onDelta })
    const body = JSON.parse(fetch.mock.calls[0][1]!.body as string)
    expect(body.model).toBe('vision-model')
    expect(body.messages.at(-1).content[1].type).toBe('image_url')
    expect(onDelta).toHaveBeenCalledWith('图片回复')
  })
})
