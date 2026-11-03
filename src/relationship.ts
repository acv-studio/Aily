import type { ConfirmedMemory } from './chatService'
import type { CharacterId } from './data'
import { canRecall, isSensitive, type MemoryPolicy } from './longMemory'

/** Shared by the stage UI and nickname gate; proposals and paused facts never unlock intimacy. */
export function relationshipEvents(characterId: CharacterId, memories: ConfirmedMemory[], policy?: MemoryPolicy, now = Date.now()) {
  const latest = new Map<string, ConfirmedMemory>()
  for (const memory of memories) {
    if (memory.characterId !== characterId) continue
    const previous = latest.get(memory.id)
    if (!previous || (memory.updatedAt || memory.confirmedAt) >= (previous.updatedAt || previous.confirmedAt)) latest.set(memory.id, memory)
  }
  return [...latest.values()].filter(memory => canRecall(memory, policy, now) && memory.sensitive !== true && !isSensitive(memory.text)
    && Number.isFinite(Date.parse(memory.confirmedAt)) && Date.parse(memory.confirmedAt) <= now)
    .sort((a, b) => Date.parse(b.confirmedAt) - Date.parse(a.confirmedAt) || a.id.localeCompare(b.id))
}

export const stages = [
  { name: '初遇', threshold: 0, description: '开始认识彼此' },
  { name: '熟悉', threshold: 2, description: '记住彼此的小习惯' },
  { name: '信任', threshold: 5, description: '愿意分享更深的心事' },
  { name: '亲密', threshold: 9, description: '可由你确认专属称呼' },
  { name: '相伴', threshold: 15, description: '一起书写长期故事' },
]

export function getRelationship(characterId: CharacterId, memories: ConfirmedMemory[], policy?: MemoryPolicy, now = Date.now()) {
  const count = relationshipEvents(characterId, memories, policy, now).length
  const index = stages.reduce((found, stage, position) => count >= stage.threshold ? position : found, 0)
  const stage = stages[Math.max(0, index)]
  const next = stages[index + 1]
  return { stage, count, next, remaining: next ? Math.max(0, next.threshold - count) : 0, progress: next ? (count - stage.threshold) / (next.threshold - stage.threshold) : 1 }
}
