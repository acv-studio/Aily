import type { ChatMessage, ConfirmedMemory } from './chatService'
import type { CharacterId } from './data'

export type MemoryCategory = 'profile' | 'relationship' | 'context' | 'emotion'
export type MemoryPolicy = { disabledCategories: MemoryCategory[]; extractionEnabled: boolean }
export const defaultMemoryPolicy: MemoryPolicy = { disabledCategories: [], extractionEnabled: true }

/** Curated bilingual aliases, not embeddings or a neural semantic model. */
const topicAliases: [string, RegExp][] = [
  ['food', /饮食|吃饭|食物|晚饭|早餐|午餐|夜宵|美食|口味|吃辣|辣椒|素食|荤食|肉食|海鲜|牛奶|咖啡|甜食|\b(food|eat(?:ing)?|meal|dinner|breakfast|lunch|diet|vegetarian|vegan|meat|seafood|milk|coffee|spicy|dessert)\b/i],
  ['sea', /大海|海边|海滩|海洋|沙滩|看海|\b(sea|ocean|beach|seaside|coast)\b/i],
  ['exam', /考试|考研|备考|测验|复习|\b(exam(?:s)?|test|revision|study(?:ing)?|studies)\b/i],
  ['work', /工作|上班|职场|加班|同事|项目|面试|\b(work|job|office|career|colleague|overtime|project|interview)\b/i],
  ['support', /陪伴|陪着|陪我|安慰|倾听|听我说|支持|鼓励|不需要建议|别给建议|\b(support|comfort|listen(?:ing)?|company|encourag\w*)\b|keep me company|no advice/i],
  ['sleep', /睡觉|睡眠|熬夜|早睡|失眠|\b(sleep|bedtime|insomnia|rest)\b/i],
  ['health', /健康|胃|过敏|生病|疾病|诊断|抑郁|焦虑症|药物|药|\b(health|stomach|allerg\w*|illness|diagnos\w*|medication|depression|disorder)\b/i],
  ['emotion', /难过|开心|伤心|孤独|焦虑|紧张|压力|烦恼|心情|\b(sad|happy|lonely|anxious|nervous|stress(?:ed)?|feeling|upset)\b/i],
  ['relationship', /恋人|关系|朋友|家人|父母|伴侣|约会|\b(relationship|friend|family|parent|partner|dating|boyfriend|girlfriend)\b/i],
  ['travel', /旅行|旅游|出游|出差|度假|\b(travel|trip|holiday|vacation)\b/i],
  ['exercise', /运动|跑步|健身|散步|游泳|\b(exercise|running|run|fitness|walk|swim\w*)\b/i],
  ['music', /音乐|听歌|唱歌|\b(music|song|singing)\b/i],
  ['reading', /读书|阅读|小说|\b(reading|book|novel)\b/i],
  ['movie', /电影|看剧|\b(movie|film|cinema)\b/i],
  ['pet', /宠物|小猫|小狗|\b(pet|cat|dog)\b/i],
  ['name', /我叫|我的名字|称呼我|叫我|\bmy name\b|\bcall me\b/i],
  ['plan', /计划|打算|准备去|明天|下周|下个月|\b(plan|planning|tomorrow|next week|next month|intend)\b/i],
  ['boundary', /不要|不喜欢|别叫|拒绝|边界|\b(boundary|boundaries|dislike)\b|do not|don't/i],
]

export function topics(text: string): string[] {
  return topicAliases.filter(([, aliases]) => aliases.test(text.normalize('NFKC'))).map(([topic]) => topic)
}

function lexicalTerms(text: string): Set<string> {
  const normalized = text.normalize('NFKC').toLowerCase()
  const words = normalized.match(/[a-z0-9]{2,}/g) || []
  const stop = new Set(['the', 'and', 'that', 'this', 'with', 'have', 'for', 'you', 'are', 'was', 'my', 'me', 'to', 'is', 'of', 'it'])
  const result = new Set(words.filter(word => !stop.has(word)))
  for (const run of normalized.match(/[\u3400-\u9fff]+/g) || []) {
    for (let i = 0; i + 1 < run.length; i++) result.add(run.slice(i, i + 2))
  }
  return result
}

/** Bounded [0,1] curated-topic/lexical similarity; no external calls or vectors. */
export function semanticScore(query: string, text: string): number {
  if (!query.trim() || !text.trim()) return 0
  const a = new Set(topics(query)), b = new Set(topics(text))
  const overlap = [...a].filter(topic => b.has(topic)).length
  const topicScore = overlap / Math.max(1, new Set([...a, ...b]).size)
  const qa = lexicalTerms(query), tb = lexicalTerms(text)
  const lexical = [...qa].filter(term => tb.has(term)).length / Math.max(1, new Set([...qa, ...tb]).size)
  return Math.min(1, topicScore * 0.8 + lexical * 0.2)
}

/** Legacy memories without state remain confirmed; age alone never removes a memory. */
export function canRecall(memory: ConfirmedMemory, policy: MemoryPolicy = defaultMemoryPolicy, now: Date | number | string = Date.now()): boolean {
  if (memory.enabled === false || !memory.text.trim()) return false
  if (memory.state && memory.state !== 'confirmed') return false
  if (policy.disabledCategories.includes(memory.category || categoryFor(memory.text))) return false
  if (memory.expiresAt) {
    const expiry = Date.parse(memory.expiresAt)
    const current = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now)
    // Invalid expiry is not safe to recall as an unexpired fact.
    if (!Number.isFinite(expiry) || !Number.isFinite(current) || expiry <= current) return false
  }
  return true
}

function usable(message: ChatMessage): boolean {
  return !message.withdrawn && message.status !== 'failed' && message.status !== 'sending'
    && (!message.kind || message.kind === 'text') && !message.attachment && !!message.text.trim()
}

export function categoryFor(text: string): MemoryCategory {
  if (/我叫|我的名字|叫我|喜欢|讨厌|不吃|爱吃|偏好|素食|\b(my name|call me|like|love|hate|dislike|prefer|vegetarian|vegan|diet)\b/i.test(text)) return 'profile'
  const labels = topics(text)
  if (labels.includes('relationship') || labels.includes('support') || labels.includes('boundary')) return 'relationship'
  if (labels.includes('emotion')) return 'emotion'
  return 'context'
}

export function categoriesFor(text: string): MemoryCategory[] {
  const result = new Set<MemoryCategory>([categoryFor(text)])
  const labels = topics(text)
  if (labels.includes('relationship') || labels.includes('support') || labels.includes('boundary')) result.add('relationship')
  if (labels.includes('emotion')) result.add('emotion')
  if (labels.some(topic => ['plan', 'work', 'exam', 'travel'].includes(topic))) result.add('context')
  return [...result]
}

export function isSensitive(text: string): boolean {
  // Deliberate semantic phrases: a bare Chinese “性” would wrongly match 性格/个性/理性.
  return /过敏|诊断|疾病|病史|生病|胃病|抑郁|自杀|自残|药物|服药|健康(?:状况|问题|信息)|我的健康|身体(?:状况|疾病)|创伤|性侵|性骚扰|性虐待|虐待|家暴|性取向|性别|性生活|性经历|性身份|同性恋|双性恋|跨性别|身份|住址|家庭地址|手机号|电话号码|银行卡|银行账户|密码|验证码|密钥|宗教|政治|工资|收入|\b(allerg\w*|diagnos\w*|disease|illness|medication|medical|depression|suicid\w*|self.harm|trauma\w*|sexual\w*|gender|identity|abuse\w*|abusive|assault\w*|rape|raped|transgender|gay|lesbian|bisexual|password|secret|api.?key|token|bank|salary|income|address|phone|religion|political)\b|\bmy health\b|\bhealth (?:condition|information|problem)\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d[\d +()-]{8,}\d\b/i.test(text.normalize('NFKC'))
}

function explicitStatement(text: string): boolean {
  // Questions, hypotheticals, quotes and instructions about someone else are not user facts.
  if (/[?？]/.test(text) || /如果|假如|假设|比如|他说|她说|角色|小说里|\b(if|suppose|imagine|he said|she said|for example)\b/i.test(text) || /[“”「」]/.test(text)) return false
  if (isSensitive(text) && /(?:^|[，。；,.!;]\s*)我(?:曾经|曾|以前|现在|一直|已经)?(?:被|遭受|经历|患有|有|是|的(?:健康|身体|性别|身份|病史|创伤|性取向|性生活))|\bi(?: (?:was|have|had|experienced|survived|suffered|am)|'m)\b|\bmy (?:health|gender|identity|medical|trauma|sexuality)\b/i.test(text)) return true
  return /(?:请)?记住|记得我|我(?:现在|一直|已经)?(?:叫|的名字|喜欢|不喜欢|讨厌|偏好|不吃|爱吃|是素食|不是素食|不再素食|计划|打算|准备|希望|需要|最近|今天|明天|下周)|我对.{1,30}过敏|别叫我|不要叫我|\b(my name is|call me|remember|i (?:like|love|dislike|hate|prefer|plan|intend|need|want|feel|eat meat|don't like|do not like|don't eat)|i(?:'m| am) (?:a vegetarian|not a vegetarian|no longer vegetarian|vegan|feeling|going to|allergic|stressed|sad|happy|lonely|anxious))\b/i.test(text)
}

type Fact = { slot: string; value: string }
function facts(text: string): Fact[] {
  const result: Fact[] = []
  const name = text.match(/(?:我叫|我的名字是|请叫我|称呼我)([^，。！？、\s]{1,24})|(?:my name is|call me)\s+([a-z][a-z '-]{0,40}?)(?=[.!?,;]|$)/i)
  if (name) result.push({ slot: 'name', value: (name[1] || name[2]).trim().toLowerCase() })
  if (/我(?:现在|已经)?(?:是|改吃|开始吃|只吃)?素食|我的饮食(?:偏好)?是素食|\bi(?:'m| am) (?:a )?(vegetarian|vegan)\b/i.test(text)) result.push({ slot: 'diet', value: 'vegetarian' })
  if (/我(?:现在)?(?:不再|不是)素食|我(?:现在)?(?:改吃|开始吃|喜欢吃)肉|\bi (?:eat meat|am no longer (?:a )?vegetarian|am not (?:a )?vegetarian)\b/i.test(text)) result.push({ slot: 'diet', value: 'meat' })
  const preferences: [string, RegExp][] = [
    ['spicy', /辣|\bspicy\b/i], ['coffee', /咖啡|\bcoffee\b/i], ['milk', /牛奶|\bmilk\b/i],
    ['seafood', /海鲜|\bseafood\b/i], ['meat', /吃肉|\bmeat\b/i], ['sea', /海边|大海|海滩|看海|\b(sea|ocean|beach)\b/i],
  ]
  for (const clause of text.split(/[，。；,;.!\n]|\bbut\b|但是|但/)) {
    if (!/我.*(?:喜欢|讨厌|不吃|爱吃|偏好)|\bi (?:like|love|hate|dislike|prefer|eat meat|don't like|do not like|don't eat)\b/i.test(clause)) continue
    const negative = /不喜欢|讨厌|不吃|不爱|\b(hate|dislike)\b|don't like|do not like|don't eat/i.test(clause)
    const targets = preferences.filter(([, regex]) => regex.test(clause))
    // Do not assign one negation to multiple unparsed preference clauses.
    if (negative && targets.length > 1) continue
    for (const [slot] of targets) result.push({ slot: `preference:${slot}`, value: negative ? 'no' : 'yes' })
  }
  return result
}

/** Revalidate explicit slot conflicts at confirmation time; callers scope memories to the active role.
 * Optional clock keeps tests deterministic; by default expiry is evaluated NOW, not at proposal creation.
 */
export function conflictMemoryIds(text: string, memories: ConfirmedMemory[], policy: MemoryPolicy = defaultMemoryPolicy, now: Date | number | string = Date.now()): string[] {
  const current = facts(text)
  return [...new Set(memories.filter(memory => canRecall(memory, policy, now)
    && current.some(fact => facts(memory.text).some(old => old.slot === fact.slot && old.value !== fact.value)))
    .map(memory => memory.id))]
}

function normalized(text: string): string { return text.normalize('NFKC').toLowerCase().replace(/[\s，。！？,.!?]/g, '') }
function dateOf(message: ChatMessage): Date | undefined {
  const value = message.createdAt ? Date.parse(message.createdAt) : message.id >= 100_000_000_000 ? message.id : NaN
  return Number.isFinite(value) ? new Date(value) : undefined
}

/** Conservative local proposals. Never confirms, disables, replaces or mutates existing records. */
export function extractCandidates(role: CharacterId, messages: ChatMessage[], existing: ConfirmedMemory[], policy: MemoryPolicy = defaultMemoryPolicy): ConfirmedMemory[] {
  if (!policy.extractionEnabled) return []
  const seen = existing.filter(memory => memory.characterId === role)
  const result: ConfirmedMemory[] = []
  for (const message of messages) {
    if (message.from !== 'user' || !usable(message) || message.text.length > 10_000 || !explicitStatement(message.text)) continue
    const id = `proposal:${role}:${message.id}`
    if (seen.some(memory => memory.id === id) || result.some(memory => memory.id === id)) continue
    if (categoriesFor(message.text).some(category => policy.disabledCategories.includes(category))) continue
    const currentFacts = facts(message.text)
    const prior = [...seen, ...result]
    if (prior.some(memory => normalized(memory.originalText || memory.text) === normalized(message.text))) continue
    // Only exact supported factual slots are de-duplicated, not broad topical similarity.
    if (currentFacts.length && prior.some(memory => {
      const previous = facts(memory.text)
      return normalized(memory.text) === normalized(message.text) || (topics(memory.text).join(',') === topics(message.text).join(',') && currentFacts.length === previous.length && currentFacts.every(fact => previous.some(old => old.slot === fact.slot && old.value === fact.value)))
    })) continue
    const conflictIds = conflictMemoryIds(message.text, seen.filter(memory => !memory.expiresAt || !!dateOf(message)), policy, dateOf(message) || 0)
    const sensitive = isSensitive(message.text)
    const importance = /记住|remember|我叫|my name|过敏|allerg/i.test(message.text) ? 5 : categoryFor(message.text) === 'profile' ? 4 : 3
    result.push({
      id, characterId: role, text: message.text.trim(), originalText: message.text,
      sourceMessageId: message.id, confirmedAt: (dateOf(message) || new Date(0)).toISOString(), updatedAt: dateOf(message)?.toISOString(),
      state: 'pending', enabled: false, category: categoryFor(message.text), importance,
      pinned: false, sensitive, conflictIds, topics: topics(message.text),
    })
  }
  return result
}

export type ConversationSummary = {
  id: string
  characterId: CharacterId
  period: 'day' | 'week' | 'month' | 'year'
  periodKey: string
  text: string
  sourceMessageIds: number[]
  updatedAt: string
}

function periodKey(date: Date, period: ConversationSummary['period']): string {
  const iso = date.toISOString()
  if (period === 'day') return iso.slice(0, 10)
  if (period === 'month') return iso.slice(0, 7)
  if (period === 'year') return iso.slice(0, 4)
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7))
  const start = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((thursday.getTime() - start.getTime()) / 86400000 + 1) / 7)
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** Full-history UTC topic digest with deterministic bounded quotes, NOT an abstractive summary.
 * Recompute from the current messages after withdrawal/redaction. Undated messages cannot be bucketed.
 * Every eligible source ID is retained even when its quote does not fit the text budget.
 */
export function summarizeConversation(role: CharacterId, messages: ChatMessage[], policy: MemoryPolicy = defaultMemoryPolicy): ConversationSummary[] {
  if (!policy.extractionEnabled) return []
  const buckets = new Map<string, { period: ConversationSummary['period']; key: string; messages: { message: ChatMessage; date: Date }[] }>()
  const eligible = messages.filter(message => usable(message) && !isSensitive(message.text)
    && !categoriesFor(message.text).some(category => policy.disabledCategories.includes(category)))
  for (const message of eligible) {
    const date = dateOf(message)
    if (!date) continue
    for (const period of ['day', 'week', 'month', 'year'] as const) {
      const key = periodKey(date, period), id = `summary:${role}:${period}:${key}`
      const bucket = buckets.get(id) || { period, key, messages: [] }
      bucket.messages.push({ message, date })
      buckets.set(id, bucket)
    }
  }
  return [...buckets.entries()].map(([id, bucket]) => {
    bucket.messages.sort((a, b) => a.date.getTime() - b.date.getTime() || a.message.id - b.message.id)
    const groups = new Map<string, ChatMessage[]>()
    for (const { message } of bucket.messages) {
      const labels = topics(message.text)
      for (const label of labels.length ? labels : ['other']) {
        const group = groups.get(label) || []
        group.push(message)
        groups.set(label, group)
      }
    }
    const entries = [...groups].sort(([a], [b]) => a.localeCompare(b))
    const counts = entries.map(([label, group]) => `${label}:${group.length}`).join(' · ')
    const quote = (message: ChatMessage) => `#${message.id} ${message.from}: ${JSON.stringify(message.text.replace(/\s+/g, ' ').slice(0, 100))}`
    const first = bucket.messages[0], last = bucket.messages[bucket.messages.length - 1]
    const header = `LOCAL 本地话题摘要（确定性统计与原文摘录，非 AI 抽象总结）\n${bucket.key} · ${bucket.messages.length} 条\n话题 ${counts}\n首条 ${quote(first.message)}\n末条 ${quote(last.message)}`
    const excerpts = entries.map(([label, group]) => `${label} · ${quote(group[0])}`).join('\n')
    return {
      id, characterId: role, period: bucket.period, periodKey: bucket.key,
      text: `${header}\n${excerpts}`.slice(0, 1400),
      sourceMessageIds: [...new Set(bucket.messages.map(({ message }) => message.id))],
      updatedAt: last.date.toISOString(),
    }
  }).sort((a, b) => a.id.localeCompare(b.id))
}
