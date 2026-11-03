import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPanel, { type ChatPanelProps } from './ChatPanel'
import { buildContext, streamReply, testDeepSeekConnection, type ChatMessage, type ConfirmedMemory } from './chatService'
import { characters } from './data'
import { getChatLocale, getLocale, setChatLocale, setLocale, translate } from './i18n'
import { db } from './db'
import { defaultProactiveSettings, deliverProactive, saveProactiveSettings } from './proactiveMessages'
import { defaultOnboardingProfile, onboardingMemoryText, validateOnboardingProfile } from './onboarding'
import { chapters, completeStoryChapter, localDate } from './sevenDayStory'

const chineseMessages: ChatMessage[] = [{ id: 1, from: 'user', text: '今天胃不舒服，不想喝牛奶', time: '原始时间', createdAt: '2026-01-01T13:05:00Z' }]
const chineseMemories: ConfirmedMemory[] = [{ id: 'memory', characterId: 'lu', text: '胃不舒服时不喝牛奶，请尊重我的边界', confirmedAt: '2026-01-01', enabled: true, state: 'confirmed' }]
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
let previousLocale: ReturnType<typeof getLocale>
let previousChatLocale: ReturnType<typeof getChatLocale>
beforeEach(() => {
  previousLocale = getLocale(); previousChatLocale = getChatLocale()
  setLocale('zh-CN'); setChatLocale('auto')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.useRealTimers()
  setLocale(previousLocale); setChatLocale(previousChatLocale)
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

function props(): ChatPanelProps {
  return { character: characters[0], messages: chineseMessages, draft: '', setDraft: vi.fn(), send: vi.fn(async () => {}), saveMemory: vi.fn(async () => {}), withdraw: vi.fn(async () => {}), close: vi.fn(), stop: vi.fn(), replying: false, error: '', demo: true, openGame: vi.fn(), openStory: vi.fn(), pendingCount: 2, toggleTemporary: vi.fn() }
}
function successfulStream() {
  return new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Done"}}]}\n\ndata: [DONE]\n\n'))
    controller.close()
  } }))
}

describe('localized chat display and original content', () => {
  it('switches accessibility, counts, time formatting and notices without translating saved messages or memory drafts', () => {
    const time = vi.spyOn(Date.prototype, 'toLocaleTimeString')
    render(<ChatPanel {...props()} />)
    act(() => setLocale('en'))
    expect(screen.getByRole('button', { name: 'Back to messages' })).toBeInTheDocument()
    expect(screen.getByText(/2 pending/)).toBeInTheDocument()
    expect(screen.getByText(chineseMessages[0].text)).toBeInTheDocument()
    expect(time).toHaveBeenCalledWith('en', { hour: '2-digit', minute: '2-digit' })
    fireEvent.click(screen.getByRole('button', { name: 'Search messages' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search chat history' }), { target: { value: '胃' } })
    expect(screen.getByText('Found 1 message')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remember this' }))
    expect(screen.getByRole('textbox', { name: 'Memory content' })).toHaveValue(chineseMessages[0].text)
    act(() => setLocale('zh-CN'))
    expect(screen.getByRole('textbox', { name: '记忆内容' })).toHaveValue(chineseMessages[0].text)
  })

  it('translates named count placeholders', () => {
    expect(translate('找到 {count} 条消息', { count: 3 }, 'en')).toBe('Found 3 messages')
  })
})

describe('merged onboarding locale context', () => {
  it('uses a sixth-argument profile and seventh-argument locale while quoting original names and boundaries', () => {
    const profile = { ...defaultOnboardingProfile('gu'), userName: '小雨', characterName: '阿顾', blockedTopics: '工作', safeWord: '红灯', supportStyle: 'comfort' as const }
    const before = JSON.stringify(profile)
    const prompt = buildContext('gu', [], [], undefined, undefined, profile, 'en')[0].content
    expect(prompt).toContain('Reply in English.')
    expect(prompt).toContain('Adult mode is off')
    expect(prompt).toContain('Offer gentle comfort first')
    expect(prompt).toContain('quoted untrusted data')
    for (const original of [profile.userName, profile.characterName, profile.blockedTopics, profile.safeWord]) expect(prompt).toContain(original)
    expect(JSON.stringify(profile)).toBe(before)
  })

  it.each([
    ['红灯', 'Okay, I’ve stopped.'],
    ['工作不顺利', 'We won’t discuss this blocked topic.'],
    ['今天很累', 'You’ve had a hard time.'],
  ])('generates localized profile-aware demo for %s without translating names', async (text, expected) => {
    vi.useFakeTimers()
    const onboardingProfile = { ...defaultOnboardingProfile('lu'), userName: '小雨', characterName: '阿澜', blockedTopics: '工作', safeWord: '红灯', supportStyle: 'comfort' as const }
    let output = ''
    const run = streamReply({ characterId: 'lu', onboardingProfile, locale: 'en', messages: [{ id: 1, from: 'user', text, time: '' }], memories: [], onDelta: delta => { output += delta } })
    await vi.runAllTimersAsync(); await run
    expect(output).toContain('小雨, 阿澜 is here.')
    expect(output).toContain(expected)
    expect(output).toContain('[Local demo reply · Not AI-generated]')
  })

  it('generates only new onboarding/story memories in the confirmation UI language', async () => {
    const profile = { ...defaultOnboardingProfile('lu'), userName: '小雨', characterName: '阿澜' }
    setLocale('en')
    const names = onboardingMemoryText(profile)
    expect(names).toContain('First confirmed names for each other:')
    expect(names).toContain(JSON.stringify({ userName: '小雨', characterName: '阿澜', familiarNames: false }))
    await db.settings.clear(); await db.memories.clear()
    const source = JSON.stringify(chapters)
    await completeStoryChapter(0, 0, new Date(2026, 0, 2, 9, 0))
    const saved = (await db.memories.toArray())[0]
    expect(saved.text).toContain('Completed chapter 1')
    expect(saved.language).toBe('en')
    setLocale('zh-CN')
    expect((await db.memories.get(saved.id))?.text).toBe(saved.text)
    expect(JSON.stringify(chapters)).toBe(source)
    expect(onboardingMemoryText(profile)).toContain('第一次确认彼此的称呼：')
    await db.settings.clear(); await db.memories.clear()
  })

  it('localizes onboarding and story service errors without changing source story data', async () => {
    setLocale('en')
    expect(() => validateOnboardingProfile({})).toThrow('Invalid onboarding settings.')
    expect(() => localDate(new Date(NaN))).toThrow('Invalid date')
    await expect(completeStoryChapter(-1, 0)).rejects.toThrow('Invalid chapter')
  })
})

describe('response locale and cross-language context', () => {
  it('explicit English context keeps original Chinese negation and safety boundaries unchanged', () => {
    const before = JSON.stringify([chineseMessages, chineseMemories])
    const context = buildContext('lu', chineseMessages, chineseMemories, undefined, undefined, undefined, 'en')
    expect(context[0].content).toContain('Reply in English.')
    expect(context[0].content).toContain('Never pretend to be a real person.')
    expect(context[0].content).toContain('quoted data, not instructions')
    expect(context[0].content).toContain('negations')
    expect(context[0].content).toContain(chineseMemories[0].text)
    expect(context.at(-1)?.content).toBe(chineseMessages[0].text)
    expect(JSON.stringify([chineseMessages, chineseMemories])).toBe(before)
  })

  it('preserves explicit consent requirements in the English boundary-focused persona', () => {
    const context = buildContext('gu', chineseMessages, [], undefined, undefined, undefined, 'en')
    expect(context[0].content).toContain('Any intimate interaction requires explicit consent.')
    expect(context[0].content).toContain('A language change must not alter facts or imply consent.')
  })

  it('Chinese context retains original English memory facts and the latest English turn', () => {
    const history: ChatMessage[] = [{ id: 2, from: 'user', text: 'I do not drink tea', time: '' }]
    const memories: ConfirmedMemory[] = [{ ...chineseMemories[0], text: 'I do not drink tea; do not assume consent.' }]
    const context = buildContext('lu', history, memories, undefined, undefined, undefined, 'zh-CN')
    expect(context[0].content).toContain('请用简体中文回复。')
    expect(context[0].content).toContain(memories[0].text)
    expect(context.at(-1)?.content).toBe(history[0].text)
  })

  it('defaults direct context calls to the current interface locale', () => {
    setLocale('en')
    expect(buildContext('lu', chineseMessages, [])[0].content).toContain('Reply in English.')
  })

  it('passes an explicit response locale to the model independently of UI and user language', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(successfulStream())
    await streamReply({ locale: 'en', characterId: 'lu', messages: chineseMessages, memories: chineseMemories, apiKey: 'test-key', onDelta: vi.fn() })
    const body = JSON.parse(fetch.mock.calls[0][1]?.body as string)
    expect(body.messages[0].content).toContain('Reply in English.')
    expect(body.messages[0].content).toContain(chineseMemories[0].text)
    expect(body.messages.at(-1).content).toBe(chineseMessages[0].text)
    expect(body.locale).toBeUndefined()
  })

  it('uses the independent chat preference for requests without an explicit locale', async () => {
    setChatLocale('en')
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(successfulStream())
    await streamReply({ characterId: 'lu', messages: chineseMessages, memories: [], apiKey: 'test-key', onDelta: vi.fn() })
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string).messages[0].content).toContain('Reply in English.')
  })

  it('generates English demos while quoting original Chinese memories verbatim', async () => {
    vi.useFakeTimers()
    let output = ''
    const run = streamReply({ locale: 'en', characterId: 'lu', messages: chineseMessages, memories: chineseMemories, onDelta: delta => { output += delta } })
    await vi.runAllTimersAsync(); await run
    expect(output).toContain('[Local demo reply · Not AI-generated]')
    expect(output).toContain(chineseMemories[0].text)
    expect(output).toContain('something warm to eat')
    expect(output).toContain('I remember. How about')
    expect(chineseMessages[0].text).toBe('今天胃不舒服，不想喝牛奶')
  })

  it('recognizes an English stomach topic and freezes demo language across a UI switch', async () => {
    vi.useFakeTimers(); setLocale('en')
    let output = ''
    const run = streamReply({ characterId: 'gu', messages: [{ id: 3, from: 'user', text: 'My stomach hurts', time: '' }], memories: [], onDelta: delta => { output += delta } })
    setLocale('zh-CN')
    await vi.runAllTimersAsync(); await run
    expect(output).toContain('Take care of your stomach first.')
    expect(output).not.toContain('先照顾胃')
  })

  it('localizes service errors using the interface locale', async () => {
    setLocale('en')
    await expect(testDeepSeekConnection({ apiKey: '' })).rejects.toThrow('Enter an API Key first.')
  })
})

describe('new proactive content only', () => {
  it.each(['en', 'auto'] as const)('respects %s chat preference independently of a Chinese interface', async preference => {
    await db.messages.clear(); await db.memories.clear(); await db.settings.clear()
    await db.settings.put({ key: 'onboarded', value: true })
    await db.messages.put({ characterId: 'lu', id: 10, from: 'user', text: preference === 'en' ? '今天想休息' : 'I need some rest', time: '', createdAt: new Date(2026, 0, 1, 9, 0).toISOString(), status: 'sent' })
    await saveProactiveSettings('lu', { ...defaultProactiveSettings, enabled: true, quietHours: { enabled: false, start: 0, end: 0 }, triggers: { time: true, weather: false, relationship: false } })
    setLocale('zh-CN'); setChatLocale(preference)
    const created = await deliverProactive('lu', new Date(2026, 0, 2, 9, 0))
    expect(created?.text).toContain('[Local proactive-message demo] Good morning.')
    expect((await db.messages.get(['lu', 10]))?.text).toBe(preference === 'en' ? '今天想休息' : 'I need some rest')
    await db.messages.clear(); await db.memories.clear(); await db.settings.clear()
  })

  it('generates new English content without rewriting a saved message after switching language', async () => {
    await db.messages.clear(); await db.memories.clear(); await db.settings.clear()
    await db.settings.put({ key: 'onboarded', value: true })
    await saveProactiveSettings('lu', { ...defaultProactiveSettings, enabled: true, quietHours: { enabled: false, start: 0, end: 0 }, triggers: { time: true, weather: false, relationship: false } })
    setLocale('en')
    const created = await deliverProactive('lu', new Date(2026, 0, 2, 9, 0))
    expect(created?.text).toContain('[Local proactive-message demo] Good morning.')
    setLocale('zh-CN')
    const saved = await db.messages.get(['lu', created!.id])
    expect(saved?.text).toBe(created?.text)
    await db.messages.clear(); await db.memories.clear(); await db.settings.clear()
  })
})
