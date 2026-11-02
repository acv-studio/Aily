import type { CharacterId } from './data'

export type ChatMessage = {
  id: number
  from: 'user' | 'character'
  text: string
  time: string
  memory?: boolean
  status?: 'sending' | 'sent' | 'failed'
}

export type ConfirmedMemory = { id: string; characterId: CharacterId; text: string; confirmedAt: string }

type StreamRequest = {
  characterId: CharacterId
  messages: ChatMessage[]
  memories: ConfirmedMemory[]
  apiKey?: string
  endpoint?: string
  model?: string
  signal?: AbortSignal
  onDelta: (text: string) => void
}

const personas: Record<CharacterId, string> = {
  lu: '你是陆听澜，25岁，温柔可靠、寡言的行动派。回复保持一到两句、自然口语化；关心饮食作息但尊重拒绝；不伪装真人。',
  chen: '你是陈奕恒，幽默嘴硬的年下恋人。回复简短自然，爱斗嘴但不攻击用户；不伪装真人。',
  gu: '你是顾辰泽，表达直接、克制且边界清晰。任何亲密互动都以明确同意为前提；不伪装真人。',
}

export function buildContext(characterId: CharacterId, messages: ChatMessage[], memories: ConfirmedMemory[]) {
  const confirmed = memories.filter(memory => memory.characterId === characterId)
  const memoryText = confirmed.length ? confirmed.map(memory => `- ${memory.text}`).join('\n') : '- 暂无已确认记忆'
  return [
    { role: 'system', content: `${personas[characterId]}\n\n仅可自然引用以下由用户确认的记忆：\n${memoryText}` },
    ...messages.slice(-12).map(message => ({ role: message.from === 'user' ? 'user' : 'assistant', content: message.text })),
  ]
}

export async function streamReply(request: StreamRequest) {
  if (!request.apiKey) return demoReply(request)
  const response = await fetch(request.endpoint || 'https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${request.apiKey}` },
    body: JSON.stringify({ model: request.model || 'deepseek-chat', stream: true, messages: buildContext(request.characterId, request.messages, request.memories) }),
    signal: request.signal,
  })
  if (!response.ok || !response.body) throw new Error(`DeepSeek 请求失败（${response.status}）`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n'); buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
      try {
        const delta = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content
        if (delta) request.onDelta(delta)
      } catch { /* ignore incomplete provider events */ }
    }
  }
}

async function demoReply(request: StreamRequest) {
  const latest = [...request.messages].reverse().find(message => message.from === 'user')?.text || ''
  const memory = request.memories.find(item => item.characterId === request.characterId)
  const text = latest.includes('胃')
    ? '先去吃点热的，好不好？这件事要我替你记住吗？'
    : memory ? `我记得${memory.text}。今天也会照顾好自己，对吧？` : '我在。慢慢说，今天的时间都留给你。'
  for (const part of text.match(/.{1,4}/g) || []) {
    if (request.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await new Promise(resolve => setTimeout(resolve, 45))
    request.onDelta(part)
  }
}
