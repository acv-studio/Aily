import type { ConfirmedMemory } from './chatService'
import type { CharacterId } from './data'

// Chinese source strings are also persisted scheduler keys. Keep them stable;
// display consumers translate stage.name/description with t at render time.
export const stages = [
  { name: '初遇', threshold: 0, description: '开始认识彼此' },
  { name: '熟悉', threshold: 2, description: '记住彼此的小习惯' },
  { name: '信任', threshold: 5, description: '愿意分享更深的心事' },
  { name: '亲密', threshold: 9, description: '拥有专属称呼与纪念日' },
  { name: '相伴', threshold: 15, description: '一起书写长期故事' },
]

export function getRelationship(characterId: CharacterId, memories: ConfirmedMemory[]) {
  const count = memories.filter(memory => memory.characterId === characterId).length
  const index = stages.reduce((found, stage, position) => count >= stage.threshold ? position : found, 0)
  const stage = stages[Math.max(0, index)]
  const next = stages[index + 1]
  return { stage, count, next, remaining: next ? Math.max(0, next.threshold - count) : 0, progress: next ? (count - stage.threshold) / (next.threshold - stage.threshold) : 1 }
}
