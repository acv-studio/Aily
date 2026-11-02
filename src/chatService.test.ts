import { describe, expect, it, vi } from 'vitest'
import { buildContext, streamReply, type ChatMessage, type ConfirmedMemory } from './chatService'

const messages: ChatMessage[] = [
  { id: 1, from: 'user', text: '今天有点累', time: '现在' },
  { id: 2, from: 'character', text: '过来，先歇会儿。', time: '现在' },
]
const memories: ConfirmedMemory[] = [
  { id: '1', characterId: 'lu', text: '胃不舒服时提醒吃饭', confirmedAt: '2026-01-01' },
  { id: '2', characterId: 'chen', text: '喜欢夜宵', confirmedAt: '2026-01-01' },
]

describe('chat orchestration', () => {
  it('includes only memories confirmed for the active character', () => {
    const context = buildContext('lu', messages, memories)
    expect(context[0].content).toContain('胃不舒服时提醒吃饭')
    expect(context[0].content).not.toContain('喜欢夜宵')
    expect(context.at(-1)?.content).toBe('过来，先歇会儿。')
  })

  it('streams a deterministic offline reply when no key exists', async () => {
    const onDelta = vi.fn()
    await streamReply({ characterId: 'lu', messages, memories, onDelta })
    expect(onDelta).toHaveBeenCalled()
    expect(onDelta.mock.calls.flat().join('')).toContain('胃不舒服时提醒吃饭')
  })
})
