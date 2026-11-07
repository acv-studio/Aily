import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appDataLocalReply } from './appDataLocalQuery'
import { initializeAppDataProviders } from './appDataProviders'
import { registerMiniApp, clearRegisteredMiniAppData } from './extensionRuntime'
import { setExtensionInstalled } from './extensionApps'
import type { AppDataIdentity, AppDataProvider, AppDataResult } from './appDataTypes'
const who: AppDataIdentity = { role: 'lu', primaryId: 'lu', temporary: false, endpoint: 'https://example.com/v1/messages', model: 'test-model' }
let unregister: (() => void) | undefined
beforeEach(() => { localStorage.clear(); initializeAppDataProviders() })
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); unregister?.(); unregister = undefined; await clearRegisteredMiniAppData() })
const reply = (text: string, identity = who, signal = new AbortController().signal) => appDataLocalReply(text, identity, 'zh-CN', signal)
function future() {
  const result: AppDataResult = { status: 'ok', summary: { count: 1 }, records: [{ id: 'one', fields: { title: '喝了一杯水', secret: 'NEVER-READ-SECRET-FIELD' } }], revision: 'PRIVATE-FULL-SOURCE', truncated: false }
  const read = vi.fn(async () => result)
  const provider: AppDataProvider = { manifest: { id: 'future-water-records', name: '水滴记录', english: 'Water Records', aliases: ['喝水本'], availability: 'installable', schemaVersion: 1, scopes: [{ id: 'entries', name: '饮水记录', english: 'Water entries', fields: ['title', 'count'], sensitive: true }] }, read }
  unregister = registerMiniApp({ app: { id: provider.manifest.id, name: provider.manifest.name, english: provider.manifest.english, description: 'D', englishDescription: 'D', icon: 'A', color: '#abc', category: 'life' }, provider, component: () => null, clearData: async () => {} })
  setExtensionInstalled(provider.manifest.id, true)
  return { read, result, provider }
}
describe('ordinary named-App reads stay local', () => {
  it('answers the screenshot anniversary question with saved records, not model guesses', async () => {
    setExtensionInstalled('anniversary', true)
    localStorage.setItem('aily.ext.anniversary', JSON.stringify([{ id: 'one', name: '生日', date: '2026-12-01', yearly: true }]))
    const answer = await reply('纪念日有哪些数据')
    expect(answer).toContain('生日'); expect(answer).toContain('2026-12-01')
    expect(answer).toContain('每年重复：是'); expect(answer).toContain('未发送给模型')
  })
  it('works without a configured model because explicit App reads stay on-device', async () => {
    setExtensionInstalled('anniversary', true)
    expect(await reply('纪念日有哪些数据', { ...who, endpoint: '', model: '' })).toContain('没有已保存记录')
  })
  it('explains empty records and available fields separately from a failed read', async () => {
    setExtensionInstalled('anniversary', true)
    const empty = await reply('纪念日有哪些数据')
    expect(empty).toContain('没有已保存记录'); expect(empty).toContain('名称、日期、每年重复')
    localStorage.setItem('aily.ext.anniversary', '{broken')
    expect(await reply('纪念日有哪些数据')).toContain('数据格式异常')
  })
  it('refuses uninstalled retained records without reading their source', async () => {
    localStorage.setItem('aily.ext.anniversary', JSON.stringify([{ id: 'one', name: 'PRIVATE-OLD-ANNIVERSARY', date: '2026-12-01', yearly: true }]))
    const read = vi.spyOn(Storage.prototype, 'getItem')
    const answer = await reply('纪念日有哪些数据')
    expect(answer).toContain('当前未安装')
    expect(read.mock.calls.map(([key]) => key)).not.toContain('aily.ext.anniversary')
    expect(answer).not.toContain('PRIVATE-OLD-ANNIVERSARY')
  })
  it.each([{ ...who, temporary: true }, { ...who, role: 'chen' as const }])('never reads installation or records in an ineligible session %j', async identity => {
    const read = vi.spyOn(Storage.prototype, 'getItem')
    expect(await reply('纪念日有哪些数据', identity)).toContain('主 Bot')
    expect(read).not.toHaveBeenCalled()
  })
  it('discovers future app names and publisher aliases without adding an app-specific branch', async () => {
    const { read } = future()
    const answer = await reply('喝水本有哪些数据')
    expect(answer).toContain('喝了一杯水')
    expect(answer).not.toContain('NEVER-READ-SECRET-FIELD')
    expect(answer).not.toContain('PRIVATE-FULL-SOURCE')
    expect(read).toHaveBeenCalledTimes(1)
    expect(read.mock.calls[0]).toEqual(['entries', { text: '喝水本有哪些数据', limit: 20 }, expect.any(AbortSignal)])
  })
  it('does not interpret the question as a search keyword and avoids overlapping App aliases', async () => {
    setExtensionInstalled('skincare-diary', true)
    localStorage.setItem('aily.ext.skincare', JSON.stringify([{ id: 'one', date: '2026-11-01', period: '晚', products: '面霜', condition: '稳定', notes: '' }]))
    localStorage.setItem('aily-desktop-diary', JSON.stringify([{ id: 'one', date: '2026-11-01', text: 'PRIVATE-ORDINARY-DIARY' }]))
    const answer = await reply('护肤日记有哪些数据')
    expect(answer).toContain('面霜')
    expect(answer).not.toContain('PRIVATE-ORDINARY-DIARY')
  })
  it('selects full text only when explicitly requested and applies a local calendar range', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T12:00:00'))
    localStorage.setItem('aily-desktop-diary', JSON.stringify([{ id: 'one', date: '2026-11-01', text: 'NOVEMBER-CONTENT', mood: 'good' }, { id: 'two', date: '2026-10-01', text: 'OCTOBER-CONTENT' }]))
    const index = await reply('日记有哪些数据')
    expect(index).not.toContain('NOVEMBER-CONTENT')
    const body = await reply('本月日记正文有哪些数据')
    expect(body).toContain('NOVEMBER-CONTENT'); expect(body).not.toContain('OCTOBER-CONTENT')
    expect(body).toContain('2026-11-01 至 2026-12-01')
  })
  it('does not invent data for an unsupported App, and handles provider failures locally', async () => {
    setExtensionInstalled('focus-timer', true)
    expect(await reply('专注时钟有哪些数据')).toContain('没有可读取的持久业务数据接口')
    const { read } = future()
    read.mockRejectedValueOnce(new Error('storage unavailable'))
    expect(await reply('水滴记录有哪些数据')).toContain('读取不可用')
  })
  it('preserves normal conversation, installation-list handling, mutation and safety routes', async () => {
    for (const text of ['今天吃什么', '你有哪些爱好', '我安装了哪些软件', '删除纪念日记录', '我要自杀，日记有哪些数据']) expect(await reply(text)).toBeNull()
  })
  it('cancels without producing a local answer when an adapter is pending', async () => {
    const { read } = future()
    read.mockImplementationOnce(() => new Promise(() => {}))
    const controller = new AbortController()
    const pending = reply('喝水本有哪些数据', who, controller.signal)
    await Promise.resolve(); controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
