import { describe, expect, it } from 'vitest'
import { modelProvider, normalizeGatewayUrl } from './modelGateway'
describe('OpenAI-compatible gateway configuration', () => {
  it.each([
    ['https://gateway.example', 'https://gateway.example/v1/chat/completions'],
    ['https://gateway.example/v1/', 'https://gateway.example/v1/chat/completions'],
    ['https://gateway.example/proxy/v1', 'https://gateway.example/proxy/v1/chat/completions'],
    ['http://10.0.2.2:8000/v1', 'http://10.0.2.2:8000/v1/chat/completions'],
    ['https://gateway.example/custom/completions', 'https://gateway.example/custom/completions'],
  ])('normalizes %s without guessing another provider', (input, expected) => expect(normalizeGatewayUrl(input)).toBe(expected))
  it.each(['javascript:alert(1)', 'file:///secret', 'https://user:secret@gateway.example/v1', 'https://gateway.example/v1?api_key=secret', 'https://gateway.example/v1#token'])('rejects credentials or unsupported URL form %s', value => expect(() => normalizeGatewayUrl(value)).toThrow())
  it('recognizes actual saved providers without matching arbitrary host-name substrings', () => {
    expect(modelProvider('/api/magpie/v1/messages')).toBe('magpie')
    expect(modelProvider('http://127.0.0.1:3425/v1/messages')).toBe('magpie')
    expect(modelProvider('https://api.deepseek.com/chat/completions')).toBe('deepseek')
    expect(modelProvider('https://magpie.compat.example/v1/chat/completions')).toBe('openai')
  })
})
