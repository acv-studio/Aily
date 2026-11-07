export type ModelProvider = 'openai' | 'deepseek' | 'magpie'
export const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions'
export const DEEPSEEK_MODEL = 'deepseek-chat'
export const MAGPIE_ENDPOINT = '/api/magpie/v1/messages'
export const MAGPIE_MODEL = 'group/auto-mimo-v2-6-flash-free'
export function modelProvider(endpoint: string): ModelProvider {
  if (endpoint === MAGPIE_ENDPOINT) return 'magpie'
  try {
    const url = new URL(endpoint)
    if (['localhost', '127.0.0.1', '[::1]', '10.0.2.2'].includes(url.hostname) && url.port === '3425' && url.pathname.replace(/\/$/, '') === '/v1/messages') return 'magpie'
    if (url.hostname === 'api.deepseek.com') return 'deepseek'
  } catch { /* A blank/unconfigured custom URL is still a custom gateway selection. */ }
  return 'openai'
}
/** Accept root URLs and /v1 base URLs; other paths remain exact user endpoints. */
export function normalizeGatewayUrl(value: string): string {
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('网关 URL 必须是 HTTP(S) 地址，不能包含账号密码、查询参数或片段。')
  const path = url.pathname.replace(/\/+$/, '')
  if (!path) url.pathname = '/v1/chat/completions'
  else if (path.endsWith('/v1')) url.pathname = `${path}/chat/completions`
  return url.href
}
