import { describe, expect, it } from 'vitest'
import type { ChatMessage, ConfirmedMemory } from './chatService'
import { canRecall, categoryFor, conflictMemoryIds, defaultMemoryPolicy, extractCandidates, isSensitive, semanticScore, summarizeConversation, topics } from './longMemory'

const message = (id: number, text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, from: 'user', text, time: '现在', createdAt: '2026-01-05T12:00:00.000Z', ...extra,
})
const memory = (id: string, text: string, extra: Partial<ConfirmedMemory> = {}): ConfirmedMemory => ({
  id, characterId: 'lu', text, confirmedAt: '2020-01-01T00:00:00.000Z', state: 'confirmed', ...extra,
})

describe('curated bilingual semantic topics', () => {
  it.each([
    ['我喜欢在海边散步', 'I love walking beside the ocean', 'sea'],
    ['我的饮食偏好是素食', 'I prefer a vegetarian diet', 'food'],
    ['最近备考，复习压力很大', 'I am stressed about my exam revision', 'exam'],
    ['最近加班很累', 'Working overtime at the office is tiring', 'work'],
    ['难过时希望你陪着我，听我说', 'When sad I need comfort and someone to listen', 'support'],
  ])('matches meaning-equivalent Chinese and English: %s', (a, b, topic) => {
    expect(topics(a)).toContain(topic)
    expect(topics(b)).toContain(topic)
    expect(semanticScore(a, b)).toBeGreaterThan(0.2)
    expect(semanticScore(a, b)).toBeGreaterThan(semanticScore(a, 'The cat is sleeping'))
  })

  it('returns interpretable curated labels, not meaningless hash vectors', () => {
    expect(topics('海鲜')).toEqual(['food'])
    expect(topics('a research result')).toEqual([])
    expect(topics('zzzz')).toEqual([])
    expect(semanticScore('', 'sea')).toBe(0)
    expect(semanticScore('exam', 'exam')).toBeLessThanOrEqual(1)
    expect(semanticScore('zxq', 'zxq')).toBeGreaterThan(0)
  })
})

describe('recall eligibility policy', () => {
  it('keeps old high-importance and pinned facts eligible without artificial recency expiry', () => {
    const old = memory('important', '我喜欢看海', { importance: 5, pinned: true, category: 'profile' })
    expect(canRecall(old, defaultMemoryPolicy, '2030-01-01')).toBe(true)
    expect(semanticScore('I want to go to the ocean', old.text)).toBeGreaterThan(0)
    expect(canRecall({ ...old, state: undefined }, defaultMemoryPolicy, '2030-01-01')).toBe(true)
    expect(canRecall(old, { disabledCategories: ['profile'], extractionEnabled: true }, '2030-01-01')).toBe(false)
    expect(canRecall(old, { disabledCategories: [], extractionEnabled: false }, '2030-01-01')).toBe(true)
  })

  it.each(['pending', 'archived', 'rejected'] as const)('excludes %s even when pinned and important', state => {
    expect(canRecall(memory(state, '喜欢海边', { state, importance: 5, pinned: true }))).toBe(false)
  })

  it('enforces enabled and explicit expiry including boundary, and fails closed on invalid expiry', () => {
    const expiring = memory('expire', '喜欢海边', { expiresAt: '2026-01-06T00:00:00.000Z' })
    expect(canRecall(expiring, undefined, new Date('2026-01-05T23:59:59Z'))).toBe(true)
    expect(canRecall(expiring, undefined, Date.parse('2026-01-06T00:00:00Z'))).toBe(false)
    expect(canRecall({ ...expiring, expiresAt: 'not-a-date' })).toBe(false)
    expect(canRecall({ ...expiring, enabled: false }, undefined, '2026-01-01')).toBe(false)
    expect(canRecall(memory('blank', '  '))).toBe(false)
  })
})

describe('conservative local proposals', () => {
  it('only proposes explicit user statements, never confirms and preserves original/source without mutation', () => {
    const history = [message(1, '  请记住，我喜欢海边散步。  '), message(2, '我计划下周去旅行'), message(3, 'I need comfort when I feel sad')]
    const before = JSON.stringify(history)
    const result = extractCandidates('lu', history, [])
    expect(result.map(item => item.id)).toEqual(['proposal:lu:1', 'proposal:lu:2', 'proposal:lu:3'])
    expect(result[0]).toMatchObject({ originalText: history[0].text, sourceMessageId: 1, importance: 5, category: 'profile', topics: ['sea', 'exercise'], state: 'pending', enabled: false, pinned: false })
    expect(result.every(item => Number.isFinite(Date.parse(item.confirmedAt)) && !canRecall(item))).toBe(true)
    expect(JSON.stringify(history)).toBe(before)
    expect(extractCandidates('lu', [message(40, '我喜欢咖啡', { createdAt: undefined })], [])[0].confirmedAt).toBe('1970-01-01T00:00:00.000Z')
  })

  it('marks sensitive information locally without presenting it as confirmed memory', () => {
    const result = extractCandidates('lu', [message(1, '我对花生过敏'), message(2, 'Remember my password is hunter2'), message(3, '我喜欢咖啡')], [])
    expect(result).toHaveLength(3)
    expect(result.map(item => item.sensitive)).toEqual([true, true, false])
    expect(isSensitive('My email is person@example.com')).toBe(true)
    expect(isSensitive('我的家庭地址是上海某路')).toBe(true)
    expect(isSensitive('我喜欢海边')).toBe(false)
  })

  it.each([
    '我曾被性侵', '我曾遭受家庭虐待', '我的健康状况不好', '我的性别身份是非二元', '我有心理创伤',
    'I was sexually abused', 'I experienced trauma', 'My gender identity is nonbinary', "I'm transgender", 'I have a medical condition',
  ])('proposes clear first-person sensitive disclosures only as pending and never summarizes: %s', text => {
    expect(isSensitive(text)).toBe(true)
    const result = extractCandidates('lu', [message(1, text)], [])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ sensitive: true, state: 'pending', enabled: false, originalText: text, sourceMessageId: 1 })
    expect(canRecall(result[0])).toBe(false)
    expect(summarizeConversation('lu', [message(1, text)])).toEqual([])
  })

  it.each(['我喜欢有个性的音乐', '我喜欢健康饮食', '这道题需要理性分析', 'My personality is cheerful', 'I prefer healthy food'])('does not mark ordinary personality or healthy-food language sensitive: %s', text => {
    expect(isSensitive(text)).toBe(false)
    expect(summarizeConversation('lu', [message(1, text)])).toHaveLength(4)
  })

  it('does not propose third-person, hypothetical or quoted sensitive disclosures as the user’s own facts', () => {
    const texts = ['她曾被性侵', '我的朋友有心理创伤', '如果我曾被性侵会怎样', '“我曾被性侵”', 'She experienced trauma', 'If I was abused, what would happen?', 'He said I experienced trauma']
    expect(extractCandidates('lu', texts.map((text, i) => message(i + 1, text)), [])).toEqual([])
    expect(summarizeConversation('lu', texts.map((text, i) => message(i + 1, text)))).toEqual([])
  })

  it('revalidates newly confirmed and edited proposal conflicts at acceptance time', () => {
    const prior = memory('coffee', '我喜欢咖啡', { state: 'pending', enabled: false })
    expect(conflictMemoryIds('我不喜欢咖啡', [prior])).toEqual([])
    const accepted = { ...prior, state: 'confirmed' as const, enabled: true }
    expect(conflictMemoryIds('我不喜欢咖啡', [accepted])).toEqual(['coffee'])
    expect(conflictMemoryIds('我喜欢牛奶', [accepted])).toEqual([])
    expect(conflictMemoryIds('我不喜欢咖啡', [accepted, accepted])).toEqual(['coffee'])
    expect(conflictMemoryIds('我不喜欢咖啡', [{ ...accepted, expiresAt: '2000-01-01T00:00:00Z' }])).toEqual([])
    expect(conflictMemoryIds('我不喜欢咖啡', [accepted], { disabledCategories: ['profile'], extractionEnabled: true })).toEqual([])
    const expiry = { ...accepted, expiresAt: '2026-01-01T00:00:00Z' }
    expect(conflictMemoryIds('我不喜欢咖啡', [expiry], undefined, '2025-12-31')).toEqual(['coffee'])
    expect(conflictMemoryIds('我不喜欢咖啡', [expiry], undefined, '2026-01-01')).toEqual([])
  })

  it('detects explicit same-slot changes and negation, does not disable the old human-confirmed facts', () => {
    const existing = [memory('name', '我叫小雨'), memory('coffee', 'I like coffee'), memory('diet', 'I am a vegetarian'), memory('milk', '我喜欢牛奶')]
    const before = JSON.stringify(existing)
    const result = extractCandidates('lu', [message(1, '我叫小晴'), message(2, '我不喜欢咖啡'), message(3, 'I eat meat'), message(4, '我喜欢海边')], existing)
    expect(result.map(item => item.conflictIds)).toEqual([['name'], ['coffee'], ['diet'], []])
    expect(result.every(item => item.state === 'pending')).toBe(true)
    expect(JSON.stringify(existing)).toBe(before)
    expect(existing.every(item => canRecall(item))).toBe(true)
  })

  it('does not fabricate cross-topic conflicts or spread negation across unrelated preferences', () => {
    const existing = [memory('coffee', '我喜欢咖啡'), memory('milk', '我喜欢牛奶'), memory('meat', "I don't eat meat")]
    const result = extractCandidates('lu', [message(1, '我现在不喜欢咖啡，但是我喜欢牛奶'), message(2, 'I eat meat'), message(3, '我喜欢海边，下周计划旅行')], existing)
    expect(result[0].conflictIds).toEqual(['coffee'])
    expect(result[1].conflictIds).toEqual(['meat'])
    expect(result[2].conflictIds).toEqual([])
    expect(extractCandidates('lu', [message(4, '我喜欢咖啡，下周计划去海边')], existing)).toHaveLength(1)
    expect(extractCandidates('lu', [message(5, '我不喜欢咖啡喜欢牛奶')], existing)[0].conflictIds).toEqual([])
  })

  it('deduplicates source IDs and verbatim/meaning-equivalent facts including rejected proposals', () => {
    const rejected = memory('proposal:lu:1', '我喜欢海边', { state: 'rejected' })
    const existing = [rejected, memory('coffee', '我喜欢咖啡')]
    expect(extractCandidates('lu', [message(1, '我现在计划去考试'), message(2, '我喜欢海边'), message(3, 'I like coffee')], existing)).toEqual([])
    const batch = extractCandidates('lu', [message(4, '我计划下周旅行'), message(4, '我计划下周旅行'), message(5, '我计划下周旅行')], [])
    expect(batch).toHaveLength(1)
    expect(extractCandidates('chen', [message(1, '我喜欢海边')], existing)).toHaveLength(1)
  })

  it('respects extraction/category policy and skips questions, hypotheticals, assistants, media and withdrawn', () => {
    const history = [
      message(1, '我喜欢咖啡吗？'), message(2, '如果我喜欢海边，你会怎么办'), message(3, '她说我喜欢咖啡'),
      message(4, '我喜欢咖啡', { from: 'character' }), message(5, '我喜欢咖啡', { withdrawn: true }),
      message(6, '我喜欢咖啡', { kind: 'image' }), message(7, '我喜欢咖啡', { status: 'failed' }),
      message(8, '你好'), message(9, '我喜欢咖啡'), message(10, '我今天工作压力很大'),
    ]
    expect(extractCandidates('lu', history, []).map(item => item.sourceMessageId)).toEqual([9, 10])
    expect(extractCandidates('lu', history, [], { disabledCategories: [], extractionEnabled: false })).toEqual([])
    expect(extractCandidates('lu', history, [], { disabledCategories: ['profile', 'emotion'], extractionEnabled: true })).toEqual([])
    expect(categoryFor('我喜欢咖啡')).toBe('profile')
  })
})

describe('full-history deterministic local topic digests', () => {
  it('honors extraction opt-out even for a fully eligible history', () => {
    const history = [message(1, '我喜欢海边'), message(2, '我今天工作很忙')]
    expect(summarizeConversation('lu', history)).not.toEqual([])
    expect(summarizeConversation('lu', history, { disabledCategories: [], extractionEnabled: false })).toEqual([])
  })

  it('covers first through last of long history in all periods with bounded text and exact complete references', () => {
    const history = Array.from({ length: 800 }, (_, i) => message(i + 1, `我今天工作项目进展 ${i} ` + '详细进展'.repeat(60), {
      createdAt: new Date(Date.UTC(2026, 0, 1 + Math.floor(i / 100), Math.floor((i % 100) / 5), (i % 5) * 10)).toISOString(),
    }))
    const summaries = summarizeConversation('lu', history)
    const year = summaries.find(item => item.period === 'year')!
    expect(year.sourceMessageIds).toHaveLength(800)
    expect(year.sourceMessageIds).toContain(1)
    expect(year.sourceMessageIds).toContain(800)
    expect(year.text).toContain('#1 user:')
    expect(year.text).toContain('#800 user:')
    expect(year.text).toContain('work:800')
    expect(year.text).toContain('非 AI 抽象总结')
    for (const summary of summaries) expect(summary.text.length).toBeLessThanOrEqual(1400)
    for (const period of ['day', 'week', 'month', 'year']) {
      const references = new Set(summaries.filter(item => item.period === period).flatMap(item => item.sourceMessageIds))
      expect(references.size).toBe(800)
    }
    expect(summarizeConversation('lu', [...history].reverse())).toEqual(summaries)
    const changed = history.map(item => item.id === 1 ? { ...item, withdrawn: true } : item.id === 800 ? { ...item, text: 'Remember my password is secret-last' } : item)
    const revised = summarizeConversation('lu', changed).find(item => item.period === 'year')!
    expect(revised.sourceMessageIds).toHaveLength(798)
    expect(revised.sourceMessageIds).not.toContain(1)
    expect(revised.sourceMessageIds).not.toContain(800)
    expect(revised.text).not.toContain('secret-last')
  })

  it('excludes sensitive, disabled, withdrawn, failed/sending and media without leaked refs', () => {
    const history = [message(1, '我今天去海边'), message(2, '我喜欢咖啡'), message(3, '我最近感到孤独'),
      message(4, 'Remember my bank account is 12345678901'), message(5, '隐秘撤回', { withdrawn: true }),
      message(6, '失败内容', { from: 'character', status: 'failed' }), message(7, '发送中', { from: 'character', status: 'sending' }),
      message(8, '图片内容', { kind: 'image' }), message(9, '音频内容', { kind: 'audio' }),
      message(10, '附件内容', { attachment: { dataUrl: 'data:image/png;base64,x', mimeType: 'image/png', name: 'x' } }),
      message(11, '我们一起去看海吧', { from: 'character', status: 'sent' }),
      message(12, 'undated', { createdAt: undefined }), message(13, 'invalid date', { createdAt: 'bad-date' }),
    ]
    const summaries = summarizeConversation('lu', history, { disabledCategories: ['profile', 'emotion'], extractionEnabled: true })
    expect(summaries).toHaveLength(4)
    for (const summary of summaries) expect(summary.sourceMessageIds).toEqual([1, 11])
    expect(JSON.stringify(summaries)).not.toContain('12345678901')
    expect(summarizeConversation('lu', [message(1, '记住我的密码是abc')])).toEqual([])
  })

  it('uses truthful UTC periods and ISO week-year at the year boundary, recomputes redaction', () => {
    const history = [message(1, '我计划去海边', { createdAt: '2021-01-01T01:00:00+08:00' }), message(2, '我计划考试', { createdAt: '2021-01-01T01:00:00Z' })]
    const result = summarizeConversation('lu', history)
    expect(result.filter(item => item.period === 'day').map(item => item.periodKey)).toEqual(['2020-12-31', '2021-01-01'])
    expect(result.find(item => item.period === 'week')).toMatchObject({ periodKey: '2020-W53', sourceMessageIds: [1, 2] })
    const revised = summarizeConversation('lu', history.map(item => item.id === 1 ? { ...item, text: '' } : item))
    expect(revised.every(item => !item.sourceMessageIds.includes(1))).toBe(true)
    expect(result.find(item => item.period === 'week')?.id).toBe(revised.find(item => item.period === 'week')?.id)
    expect(summarizeConversation('chen', history).every(item => item.characterId === 'chen' && item.id.includes(':chen:'))).toBe(true)
  })
})
