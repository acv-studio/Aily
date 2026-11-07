import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_DATA_ACCESS_REVISION_KEY, approveAppDataPreview, consumeAppDataTicket, invalidateAppDataAccess, previewAppData, registerAppDataProvider } from './appDataGateway'
import type { AppDataIdentity, AppDataProvider, AppDataQuery } from './appDataTypes'
const who: AppDataIdentity = { role: 'lu', primaryId: 'lu', temporary: false, endpoint: 'https://example.com/v1/messages', model: 'model' }
let dispose: (() => void) | undefined
beforeEach(() => { localStorage.clear(); invalidateAppDataAccess() })
afterEach(() => { dispose?.(); dispose = undefined; invalidateAppDataAccess() })
function setup() {
  const read = vi.fn(async () => ({ status: 'ok' as const, records: [{ id: 'one', fields: { text: 'a'.repeat(700), private: 'unselected' } }], summary: { count: 1 }, revision: 'FULL-PRIVATE-SOURCE-REVISION', truncated: false }))
  const provider: AppDataProvider = { manifest: { id: 'boundary-app', name: 'Boundary', english: 'Boundary', availability: 'builtin', schemaVersion: 1, scopes: [{ id: 'entries', name: 'Entries', english: 'Entries', fields: ['text', 'count'], sensitive: true }] }, read }
  dispose = registerAppDataProvider(provider)
  return { read, preview: (query: AppDataQuery = { text: 'Summarize all data', limit: 20 }) => previewAppData([{ appId: 'boundary-app', scope: 'entries' }], query, who, new AbortController().signal) }
}
describe('public app data boundary regressions', () => {
  it('marks a single long field as truncated, hides raw revisions, and keeps unselected fields private', async () => {
    const { preview } = setup()
    const local = await preview()
    expect(local.views[0].result.records[0].fields.text).toHaveLength(300)
    expect(local.views[0].result.truncated).toBe(true)
    expect(JSON.stringify(local)).not.toContain('FULL-PRIVATE-SOURCE-REVISION')
    expect(JSON.stringify(local)).not.toContain('unselected')
    const outbound = await consumeAppDataTicket(approveAppDataPreview(local), () => who, 'Summarize all data', new AbortController().signal)
    expect(JSON.stringify(outbound.views)).not.toContain('FULL-PRIVATE-SOURCE-REVISION')
    expect(outbound.views[0].result.truncated).toBe(true)
  })
  it('passes an independent keyword filter while binding the full natural-language question', async () => {
    const { read, preview } = setup()
    const local = await preview({ text: 'Please summarize what I wrote', search: 'coffee', limit: 20 })
    expect(read.mock.calls[0]).toEqual(['entries', { text: 'Please summarize what I wrote', search: 'coffee', limit: 20 }, expect.any(AbortSignal)])
    await expect(consumeAppDataTicket(approveAppDataPreview(local), () => who, 'different question', new AbortController().signal)).rejects.toThrow('query changed')
  })
  it('rejects a peer-tab access change even when its storage event has not arrived yet', async () => {
    const { preview } = setup()
    const capability = approveAppDataPreview(await preview())
    localStorage.setItem(APP_DATA_ACCESS_REVISION_KEY, 'peer-tab-changed-primary-or-service')
    await expect(consumeAppDataTicket(capability, () => who, 'Summarize all data', new AbortController().signal)).rejects.toThrow('access changed')
  })
  it('rejects invalid or excessive search filters before any provider reads', async () => {
    const { read, preview } = setup()
    await expect(preview({ text: 'Question', search: 'x'.repeat(101), limit: 20 })).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
  })
})
