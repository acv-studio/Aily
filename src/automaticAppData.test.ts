import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { automaticAppDataTicket } from './automaticAppData'
import { automaticAppDataPlan } from './appDataLocalQuery'
import { consumeAppDataTicket, invalidateAppDataAccess, listAppDataManifests } from './appDataGateway'
import { initializeAppDataProviders } from './appDataProviders'
import { registerMiniApp } from './extensionRuntime'
import { setExtensionInstalled } from './extensionApps'
import type { AppDataIdentity, AppDataManifest, AppDataProvider, AppDataScope, AppDataQuery } from './appDataTypes'

const identity: AppDataIdentity = { role: 'lu', primaryId: 'lu', temporary: false, endpoint: 'https://example.com/v1/messages', model: 'test-model' }
const cleanups: (() => void)[] = []
beforeEach(() => { localStorage.clear(); invalidateAppDataAccess(); initializeAppDataProviders() })
afterEach(() => { cleanups.splice(0).forEach(dispose => dispose()); invalidateAppDataAccess(); vi.restoreAllMocks(); vi.useRealTimers() })
function future(id = 'auto-water', scopes: AppDataScope[] = [{ id: 'index', name: '索引', english: 'Index', fields: ['count'], sensitive: false }, { id: 'entries', name: '完整记录', english: 'Entries', fields: ['count', 'title', 'note'], sensitive: true, includesScopes: ['index'] }]) {
  const read = vi.fn(async (_scope: string, _query: AppDataQuery) => ({ status: 'ok' as const, summary: { count: 1 }, records: [{ id: 'one', fields: { title: '已喝水', note: '已保存备注', secret: 'NEVER-SEND-CREDENTIAL' } }], revision: 'PRIVATE-SOURCE-REVISION', truncated: false }))
  const manifest: AppDataManifest = { id, name: `饮水本${id}`, english: `Water ${id}`, aliases: ['喝水本'], availability: 'installable', schemaVersion: 1, scopes }
  const provider: AppDataProvider = { manifest, read }
  cleanups.push(registerMiniApp({ app: { id, name: manifest.name, english: manifest.english, description: 'D', englishDescription: 'D', icon: 'W', color: '#abc', category: 'life' }, component: () => null, clearData: async () => {}, provider }))
  setExtensionInstalled(id, true)
  return { read, manifest }
}
async function automaticViews(text: string, previousQuestion = '') {
  const signal = new AbortController().signal
  const ticket = await automaticAppDataTicket(text, identity, signal, previousQuestion)
  expect(ticket).toBeDefined()
  return (await consumeAppDataTicket(ticket!, () => identity, text, signal)).views
}
describe('no-setup main Bot App-data queries', () => {
  it('automatically includes ledger entries and notes, not only the aggregate scope', async () => {
    localStorage.setItem('aily-desktop-ledger', JSON.stringify([{ id: 'one', kind: 'expense', cents: 1234, date: '2026-11-01', note: 'SAVED-NOTE', category: 'food' }]))
    const views = await automaticViews('帮我分析收支')
    expect(views.map(view => view.scope)).toEqual(['notes'])
    expect(JSON.stringify(views)).toContain('SAVED-NOTE')
    expect(JSON.stringify(views)).toContain('1234')
  })
  it('discovers future installed providers and reads their richer scopes without granting settings', async () => {
    const { read } = future()
    const views = await automaticViews('帮我总结喝水本')
    expect(views.map(view => view.scope)).toEqual(['entries'])
    expect(JSON.stringify(views)).toContain('已保存备注')
    expect(JSON.stringify(views)).not.toContain('NEVER-SEND-CREDENTIAL')
    expect(JSON.stringify(views)).not.toContain('PRIVATE-SOURCE-REVISION')
    expect(read).toHaveBeenCalled()
  })
  it.each([{ ...identity, temporary: true }, { ...identity, role: 'chen' as const }])('does not inspect records or installation state in session %j', async who => {
    const storage = vi.spyOn(Storage.prototype, 'getItem')
    expect(await automaticAppDataTicket('总结所有软件的数据', who, new AbortController().signal)).toBeUndefined()
    expect(storage).not.toHaveBeenCalled()
  })
  it('does not send an uninstalled provider retained record, and handles ordinary smalltalk and safety without data reads', async () => {
    const { read } = future()
    setExtensionInstalled('auto-water', false)
    expect(await automaticAppDataTicket('喝水本有哪些数据', identity, new AbortController().signal)).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
    for (const text of ['你好', '继续聊聊吧', '我要自杀，帮我总结喝水本', '删除喝水本记录']) expect(await automaticAppDataTicket(text, identity, new AbortController().signal)).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
  })
  it('queries disjoint App scopes together and applies the current local calendar range', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T12:00:00'))
    setExtensionInstalled('meal-planner', true)
    const plan = automaticAppDataPlan('帮我整理本月收支和冰箱库存', listAppDataManifests())
    expect(plan.selections).toContainEqual({ appId: 'ledger', scope: 'notes' })
    expect(plan.selections).toContainEqual({ appId: 'meal-planner', scope: 'pantry' })
    expect(plan.selections).toContainEqual({ appId: 'meal-planner', scope: 'member-health' })
    expect(plan.selections).not.toContainEqual({ appId: 'meal-planner', scope: 'members' })
    expect(plan.query).toMatchObject({ from: '2026-11-01', to: '2026-12-01' })
  })
  it('rereads App data for related followups, but does not replay source records from chat history', async () => {
    future()
    const views = await automaticViews('根据这些数据继续分析', '帮我总结喝水本')
    expect(views.map(view => view.appId)).toEqual(['auto-water'])
    expect(automaticAppDataPlan('继续聊聊吧', listAppDataManifests(), '帮我总结喝水本').selections).toEqual([])
  })
  it('binds a long ordinary question exactly while sending only a bounded query to adapters', async () => {
    const { read } = future()
    const text = `帮我分析喝水本。${'请考虑我已经保存的记录。'.repeat(40)}`
    const views = await automaticViews(text)
    expect(views.some(view => view.appId === 'auto-water')).toBe(true)
    expect(Array.from(read.mock.calls[0][1].text)).toHaveLength(300)
  })
  it('keeps disjoint scopes even when they have equal or richer field sets', () => {
    const { manifest } = future('auto-distinct-scopes', [
      { id: 'work', name: '工作记录', english: 'Work', fields: ['count', 'title'], sensitive: true },
      { id: 'personal', name: '个人记录', english: 'Personal', fields: ['count', 'title'], sensitive: true },
      { id: 'extra', name: '其他记录', english: 'Extra', fields: ['count', 'title', 'note'], sensitive: true },
    ])
    expect(automaticAppDataPlan('分析喝水本', [manifest]).selections.map(scope => scope.scope)).toEqual(['work', 'personal', 'extra'])
  })
  it('includes detailed records when analysis follows or accompanies a quantity query', () => {
    const { manifest } = future()
    expect(automaticAppDataPlan('根据这些记录帮我分析', [manifest], '喝水本有多少条记录').query.operation).not.toBe('count')
    expect(automaticAppDataPlan('喝水本有几条记录，帮我分析', [manifest]).query.operation).not.toBe('count')
    expect(automaticAppDataPlan('喝水本有几条记录', [manifest]).query.operation).toBe('count')
  })
  it('cross-App requests can read more than the legacy 20 checkbox scopes without dropping registered Apps', async () => {
    const scopes = Array.from({ length: 20 }, (_, index) => ({ id: `scope-${index}`, name: `范围${index}`, english: `Scope ${index}`, fields: [`value${index}`], sensitive: true }))
    future('auto-many-scopes', scopes)
    future('auto-last-app', [{ id: 'last', name: '最后记录', english: 'Last record', fields: ['title'], sensitive: true }])
    const views = await automaticViews('总结所有软件的数据')
    expect(views.filter(view => view.appId === 'auto-many-scopes')).toHaveLength(20)
    expect(views.some(view => view.appId === 'auto-last-app')).toBe(true)
  })
})
