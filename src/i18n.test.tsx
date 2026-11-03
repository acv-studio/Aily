import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import LanguageSettings from './LanguageSettings'
import { detectLanguage, english, getChatLocale, getLocale, resolveChatLocale, setChatLocale, setLocale, translate } from './i18n'
import { displaySummary, extractCandidates, summarizeConversation } from './longMemory'
import { buildContext, retrieveMemories, type ChatMessage, type ConfirmedMemory } from './chatService'
import { clearAllData, exportData, importData, saveMemory } from './db'

afterEach(() => { cleanup(); act(() => { setLocale('zh-CN'); setChatLocale('auto') }) })
const message = (text: string): ChatMessage => ({ id: 1, from: 'user', text, time: '12:00', createdAt: '2026-01-01T12:00:00Z', status: 'sent' })

describe('bilingual settings and source preservation', () => {
  it('keeps interpolation placeholders identical throughout every English resource', () => {
    const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
    for (const [key, value] of Object.entries(english)) expect(placeholders(value), key).toEqual(placeholders(key))
  })
  it('switches live, persists preferences independently and updates document language', () => {
    setLocale('zh-CN'); setChatLocale('auto')
    render(<LanguageSettings />)
    fireEvent.change(screen.getByRole('combobox', { name: '界面语言 / Interface language' }), { target: { value: 'en' } })
    expect(document.documentElement.lang).toBe('en')
    expect(document.title).toBe('Aily · Remembering every day with you')
    expect(localStorage.getItem('aily.locale')).toBe('en')
    expect(screen.getByText('Changing languages keeps your chats, memories and relationships intact.')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Chat language' }), { target: { value: 'zh-CN' } })
    expect(getLocale()).toBe('en'); expect(getChatLocale()).toBe('zh-CN')
    expect(localStorage.getItem('aily.chatLocale')).toBe('zh-CN')
  })
  it('follows incoming user language, including mixed input, unless explicitly overridden', () => {
    setLocale('en'); setChatLocale('auto')
    expect(resolveChatLocale('今天想去看海')).toBe('zh-CN')
    expect(resolveChatLocale('I would love to see the ocean')).toBe('en')
    expect(detectLanguage('我想去 the ocean')).toBe('mixed')
    expect(resolveChatLocale('今晚想去看海，okay')).toBe('zh-CN')
    expect(resolveChatLocale('I want to see the ocean 海')).toBe('en')
    setChatLocale('zh-CN'); expect(resolveChatLocale('I love the ocean')).toBe('zh-CN')
  })
  it('interpolates literally, with fallback and without translating arbitrary user strings', () => {
    expect(translate('找到 {count} 条消息', { count: 3 }, 'en')).toBe('Found 3 messages')
    expect(translate('找到 {count} 条消息', { count: 1 }, 'en')).toBe('Found 1 message')
    expect(translate('未翻译的用户原文', {}, 'en')).toBe('未翻译的用户原文')
    expect(translate('来源：{source}', { source: '$&{name}' }, 'en')).toBe('Source: $&{name}')
  })
  it.each([
    ['我喜欢看海', 'Can we go to the ocean?', 'zh-CN'],
    ['I like spicy food', '今晚吃辣椒好吗？', 'en'],
  ] as const)('recalls original %s using another language without rewriting facts', (fact, query, language) => {
    const candidate = extractCandidates('lu', [message(fact)], [])[0]
    expect(candidate.language).toBe(language)
    const memory: ConfirmedMemory = { ...candidate, state: 'confirmed', enabled: true }
    const recalled = retrieveMemories('lu', [message(query)], [memory])
    expect(recalled[0].text).toBe(fact)
    expect(recalled[0].originalText).toBe(fact)
    const context = buildContext('lu', [message(query)], [memory], undefined, undefined, 'en')
    expect(context[0].content).toContain(fact)
    expect(context[0].content).toContain('English')
    expect(context.at(-1)?.content).toBe(query)
  })
  it('translates only generated digest structure, keeping Chinese quotations unchanged', () => {
    const summary = summarizeConversation('lu', [message('我想去看海')])[0]
    const display = displaySummary(summary, 'en')
    expect(display).toContain('LOCAL topic summary')
    expect(display).toContain('1 message')
    expect(display).toContain('我想去看海')
    expect(summary.text).toContain('本地话题摘要')
  })
  it('round trips language tags without requiring tags on old backups', async () => {
    await clearAllData()
    const memory: ConfirmedMemory = { id: 'language-test', characterId: 'lu', text: '我喜欢 the ocean', language: 'mixed', confirmedAt: '2026-01-01T00:00:00Z' }
    await saveMemory(memory)
    const data = await importData(await exportData())
    expect(data.memories).toEqual([memory])
    await clearAllData()
  })
})
