import type { ChatMessage, ConfirmedMemory } from './chatService'
import { characters, type CharacterId } from './data'
import { isSensitive, type MemoryPolicy } from './longMemory'
import { journalPeriodKey, relationshipEvents } from './relationshipMemories'
import { translate, type Locale } from './i18n'

/** No source text, attachments, IDs, exact dates or user name leave the device by default. */
export function albumMonths(memories: ConfirmedMemory[], role: CharacterId, policy: MemoryPolicy, messages: ChatMessage[]) {
  if (!policy.extractionEnabled) return []
  const groups = new Map<string, ConfirmedMemory[]>()
  for (const event of relationshipEvents(memories, role, policy, messages)) {
    if (event.sensitive || isSensitive(event.text) || isSensitive(event.originalText || '')) continue
    const key = journalPeriodKey(event.confirmedAt, 'month')
    if (key) groups.set(key, [...(groups.get(key) || []), event])
  }
  return [...groups].sort(([a], [b]) => b.localeCompare(a)).map(([month, events]) => ({ month, events }))
}

/** Conservative convenience filter, not a guarantee of anonymity. Redact before truncating. */
export function redactAlbumText(text: string, privateTerms: string[] = []) {
  let result = text.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ')
  for (const term of [...new Set(privateTerms.map(value => value.normalize('NFKC').trim()).filter(Boolean))].sort((a, b) => b.length - a.length)) {
    result = result.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[…]')
  }
  return result
    .replace(/(?:https?:\/\/|www\.)[^\s，。；<>]+/gi, '[…]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[…]')
    .replace(/(?:sk-|Bearer\s+)[\w-]+/gi, '[…]')
    .replace(/(?:\+?\d[\d +().-]{6,}\d[Xx]?)/g, '[…]')
    .replace(/(?:\d{1,3}\.){3}\d{1,3}/g, '[…]')
    .replace(/(?:我叫|叫我|我的名字是|my name is|call me)\s*[^，。；,.!?！？\n]{1,40}/gi, '[…]')
    .replace(/\s+/g, ' ').trim().slice(0, 240)
}

export function albumText(month: string, role: CharacterId, events: ConfirmedMemory[], includeExcerpts: boolean, privateTerms: string[], locale: Locale) {
  const t = (key: string, params = {}) => translate(key, params, locale)
  const name = t(characters.find(character => character.id === role)!.name)
  return [
    t('Aily · 月度回忆册'), `${month} · ${name}`, t('本月珍藏了 {count} 件共同经历', { count: events.length }),
    '', ...events.map((event, index) => `${index + 1}. ${includeExcerpts ? redactAlbumText(event.text, privateTerms) : t('一起珍藏的一件小事')}`),
    '', t('本机共同经历摘录 · AI 角色陪伴，非真人关系'),
    t('仅包含你选定的分享内容，不含原聊天、照片、来源编号或个人档案。'),
  ].join('\n')
}

export function downloadAlbum(text: string, month: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = `aily-monthly-${month}.txt`
  document.body.append(link)
  try { link.click() } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
