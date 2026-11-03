import type { ChatMessage, ConfirmedMemory } from './chatService'
import type { CharacterId } from './data'
import { canRecall, isSensitive, type MemoryPolicy } from './longMemory'

export type JournalPeriod = 'week' | 'month'
export const journalLabel = { week: '周记', month: '月记' }
// Journals are explicit, editable snapshots in the existing confirmed-memory store.
export const isJournal = (memory: ConfirmedMemory) => /^【(?:周记|月记) · [^\n]+】\n/.test(memory.text)
export function relationshipEvents(memories: ConfirmedMemory[], role: CharacterId, policy: MemoryPolicy, messages: ChatMessage[]) {
  return memories.filter(memory => memory.characterId === role && memory.category === 'relationship' && !isJournal(memory)
    && canRecall(memory, policy) && (memory.sourceMessageId === undefined || !messages.find(message => message.id === memory.sourceMessageId)?.withdrawn))
    .sort((a, b) => Date.parse(a.confirmedAt) - Date.parse(b.confirmedAt) || a.id.localeCompare(b.id))
}
export function journalPeriodKey(timestamp: string, period: JournalPeriod) {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return null
  if (period === 'month') return date.toISOString().slice(0, 7)
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7))
  const start = Date.UTC(thursday.getUTCFullYear(), 0, 1)
  return `${thursday.getUTCFullYear()}-W${String(Math.ceil(((thursday.getTime() - start) / 86400000 + 1) / 7)).padStart(2, '0')}`
}
export function journalDrafts(events: ConfirmedMemory[], period: JournalPeriod) {
  const groups = new Map<string, ConfirmedMemory[]>()
  for (const event of [...events].sort((a, b) => Date.parse(a.confirmedAt) - Date.parse(b.confirmedAt) || a.id.localeCompare(b.id))) {
    if (event.sensitive || isSensitive(event.text)) continue
    const key = journalPeriodKey(event.confirmedAt, period)
    if (key) groups.set(key, [...(groups.get(key) || []), event])
  }
  return [...groups].sort(([a], [b]) => b.localeCompare(a)).map(([key, sources]) => {
    const excerpts = sources.map(event => `· ${event.text.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n')
    return { key, sources, text: `【${journalLabel[period]} · ${key}】\n本机共同经历摘录 · ${sources.length} 件\n${excerpts.slice(0, 850)}${excerpts.length > 850 ? '\n（摘录已截短，请回看完整来源）' : ''}` }
  })
}
export function memoryImage(memory: ConfirmedMemory, messages: ChatMessage[]) {
  const source = messages.find(message => message.id === memory.sourceMessageId && !message.withdrawn && message.status !== 'failed' && message.status !== 'sending')
  const attachment = source?.attachment
  return attachment && /^image\/(?:png|jpeg|jpg|webp|gif)$/i.test(attachment.mimeType)
    && attachment.dataUrl.startsWith(`data:${attachment.mimeType};base64,`) ? attachment : null
}
export const memoryDate = (timestamp: string) => new Date(timestamp).toLocaleDateString('zh-CN', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' })
