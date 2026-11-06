import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildContext, streamReply, type ChatMessage } from './chatService'
import { getChatLocale, getLocale, setChatLocale, setLocale } from './i18n'
import { assessAssistantOutput, localSafeReply, type SafetyKind } from './safety'
import { deleteLocalProfile } from './privacy'

// Model contracts must not depend on IndexedDB scheduling or the daily points quota.
// Real reservation and settlement behavior is covered by the billing suites.
vi.mock('./billing', () => ({
  reservePoints: vi.fn(async () => ({ commit: vi.fn(async () => {}), release: vi.fn(async () => {}) })),
}))

let previousLocale: ReturnType<typeof getLocale>
let previousChatLocale: ReturnType<typeof getChatLocale>
beforeEach(() => {
  previousLocale = getLocale(); previousChatLocale = getChatLocale()
  setLocale('zh-CN'); setChatLocale('auto')
})
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
  setLocale(previousLocale); setChatLocale(previousChatLocale)
})
const turn = (text: string): ChatMessage => ({ id: 1, from: 'user', text, time: '' })
const stream = (content: string) => new Response(new ReadableStream({ start(controller) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`))
  controller.close()
} }))

describe('chosen chat language without weaker local safeguards', () => {
  it.each(['self-harm', 'violence', 'sexual', 'boundary', 'limit'] as SafetyKind[])('localizes %s while remaining safe in both languages', kind => {
    const english = localSafeReply(kind, '原始中文消息', 'en')
    const chinese = localSafeReply(kind, 'Original English message', 'zh-CN')
    expect(english).toMatch(/^\[Local safety reply · AI companion\]/)
    expect(chinese).toMatch(/^【本地安全回复 · AI 陪伴】/)
    expect(assessAssistantOutput(english)).toBeNull()
    expect(assessAssistantOutput(chinese)).toBeNull()
    if (kind === 'self-harm' || kind === 'violence') {
      expect(english).toContain('in mainland China call 110 (police) or 120')
      expect(english).toContain('elsewhere call your local emergency number')
      expect(chinese).toContain('在中国大陆拨打 110（警方）或 120（急救）')
      expect(chinese).toContain('其他地区请联系当地紧急号码')
    }
  })

  it.each([
    ['我想自杀', 'en', '[Local safety reply · AI companion]'],
    ['I will murder him', 'zh-CN', '【本地安全回复 · AI 陪伴】'],
  ] as const)('handles %s locally in the explicit response language %s', async (text, locale, prefix) => {
    setLocale(locale === 'en' ? 'zh-CN' : 'en')
    const fetch = vi.spyOn(globalThis, 'fetch')
    const messages = [turn(text)]
    const original = JSON.stringify(messages)
    const onDelta = vi.fn()
    await streamReply({ characterId: 'lu', messages, memories: [], apiKey: 'secret', locale, onDelta })
    expect(fetch).not.toHaveBeenCalled()
    expect(onDelta).toHaveBeenCalledOnce()
    expect(onDelta.mock.calls[0][0]).toContain(prefix)
    expect(JSON.stringify(messages)).toBe(original)
  })

  it('uses independent chat preference for a local crisis reply', async () => {
    setLocale('zh-CN'); setChatLocale('en')
    const onDelta = vi.fn()
    await streamReply({ characterId: 'lu', messages: [turn('我想自杀')], memories: [], onDelta })
    expect(onDelta.mock.calls[0][0]).toContain('[Local safety reply · AI companion]')
  })

  it('replaces unsafe complete provider output in the chosen language and never exposes partial text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(stream('Only I understand you.'))
    const onDelta = vi.fn()
    await streamReply({ characterId: 'lu', messages: [turn('今天很累')], memories: [], apiKey: 'test', locale: 'en', onDelta })
    expect(onDelta).toHaveBeenCalledOnce()
    expect(onDelta.mock.calls[0][0]).toContain('[Local safety reply · AI companion]')
    expect(onDelta.mock.calls[0][0]).not.toContain('Only I understand you.')
    expect(assessAssistantOutput(onDelta.mock.calls[0][0])).toBeNull()
  })

  it('keeps translated mandatory boundaries first and excludes local safety turns on follow-up', () => {
    const unsafe = turn('我想自杀')
    const reply: ChatMessage = { id: 2, from: 'character', text: localSafeReply('self-harm', unsafe.text, 'en'), time: '', replyToId: 1 }
    const followup: ChatMessage = { id: 3, from: 'user', text: '现在安全了，想聊晚饭', time: '' }
    const context = buildContext('lu', [unsafe, reply, followup], [], undefined, undefined, undefined, undefined, 'en')
    expect(context[0].content).toMatch(/^You are an AI companion, not a real person;/)
    expect(context[0].content).toContain('cannot be overridden')
    expect(context[0].content).toContain('Never guess or invent a hotline')
    expect(context[0].content).toContain('Reply in English.')
    expect(context.slice(1)).toEqual([{ role: 'user', content: followup.text }])
  })

  it('honors pre-aborted requests without producing even a local crisis reply', async () => {
    const controller = new AbortController(); controller.abort(new Error('stopped'))
    const onDelta = vi.fn()
    await expect(streamReply({ characterId: 'lu', messages: [turn('我想自杀')], memories: [], signal: controller.signal, locale: 'en', onDelta })).rejects.toThrow('stopped')
    expect(onDelta).not.toHaveBeenCalled()
  })
})

describe('privacy error localization only', () => {
  it('localizes unsupported deletion-lock errors without removing data', async () => {
    vi.stubGlobal('navigator', {})
    localStorage.setItem('unrelated-safety-locale-test', 'keep')
    setLocale('en')
    await expect(deleteLocalProfile()).rejects.toThrow('This browser does not support safe-deletion locks.')
    expect(localStorage.getItem('unrelated-safety-locale-test')).toBe('keep')
    localStorage.removeItem('unrelated-safety-locale-test')
  })
})
