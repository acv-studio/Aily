import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { appDataLocalReply } from './appDataLocalQuery'
import { initializeAppDataProviders } from './appDataProviders'
import { mediaDb } from './mediaLibrary'
import { setExtensionInstalled } from './extensionApps'
import { registerMiniApp, clearRegisteredMiniAppData } from './extensionRuntime'
import { applyCalendarQuery } from './appDataCalendar'
import type { AppDataIdentity, AppDataProvider } from './appDataTypes'
const identity: AppDataIdentity = { role: 'lu', primaryId: 'lu', temporary: false, endpoint: '', model: '' }
let unregister: (() => void) | undefined
beforeEach(async () => { vi.stubGlobal('Blob', NodeBlob); localStorage.clear(); initializeAppDataProviders(); await mediaDb.items.clear(); await mediaDb.photoDecisions.clear() })
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); unregister?.(); unregister = undefined; await clearRegisteredMiniAppData(); vi.unstubAllGlobals() })
const ask = (text: string, locale: 'zh-CN' | 'en' = 'zh-CN') => appDataLocalReply(text, identity, locale, new AbortController().signal)
async function photos(count: number) {
  await mediaDb.items.bulkAdd(Array.from({ length: count }, (_, index) => ({ id: `photo-${index}`, kind: 'album' as const, name: `PRIVATE-PHOTO-${index}.png`, blob: new Blob(['fake-image'], { type: 'image/png' }), mime: 'image/png', addedAt: '2026-11-01T12:00:00Z', favorite: false, collection: '' })))
}
describe('registry-driven natural quantity and temporal queries', () => {
  it.each(['我相册里面有几张照片', '相册有多少张照片', '相册多少张', '我的相册照片总数', '照片数量是多少'])('answers photo count across the complete source, not only the first page: %s', async text => {
    await photos(25)
    const answer = await ask(text)
    expect(answer).toContain('照片数量：25')
    expect(answer).toContain('不是系统相册总数')
    expect(answer).not.toContain('PRIVATE-PHOTO-')
    expect(answer).not.toContain('image/png')
  })
  it('handles an English photo count without requesting permissions or a model', async () => {
    await photos(3)
    const fetch = vi.spyOn(globalThis, 'fetch')
    const answer = await ask('How many photos are in my album?', 'en')
    expect(answer).toContain('Photo count (imported into Aily)：3')
    expect(answer).toContain('not the system photo library')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('reports a genuine empty photo library as zero, without confusing it with a read error', async () => {
    expect(await ask('我相册里面有几张照片')).toContain('照片数量：0')
  })
  it.each(['最近的纪念日', '最近纪念日', '下一个纪念日', '哪个纪念日快到了'])('computes the upcoming occurrence, rather than sorting original years: %s', async text => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T12:00:00'))
    setExtensionInstalled('anniversary', true)
    localStorage.setItem('aily.ext.anniversary', JSON.stringify([
      { id: 'old-year', name: '最近生日', date: '1999-11-08', yearly: true },
      { id: 'later', name: '明年活动', date: '2027-01-01', yearly: false },
      { id: 'past', name: '过去一次性活动', date: '2026-10-01', yearly: false },
    ]))
    const answer = await ask(text)
    expect(answer).toContain('下一次日期：2026-11-08')
    expect(answer).toContain('距今（天）：1')
    expect(answer).not.toContain('过去一次性活动')
    expect(answer!.indexOf('最近生日')).toBeLessThan(answer!.indexOf('明年活动'))
  })
  it('lists recent diary dates in descending order without silently reading the full text', async () => {
    localStorage.setItem('aily-desktop-diary', JSON.stringify(Array.from({ length: 7 }, (_, index) => ({ id: `entry-${index}`, date: `2026-11-0${index + 1}`, text: `PRIVATE-DIARY-${index}` }))))
    const answer = await ask('最近的日记')
    expect(answer).toContain('最近已保存的记录（最多 5 条）')
    expect(answer).toContain('2026-11-07')
    expect(answer).not.toContain('2026-11-01')
    expect(answer).not.toContain('PRIVATE-DIARY-')
  })
  it('supports upcoming queries for a future registered calendar App without a hardcoded app-id branch', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T12:00:00'))
    const calendar = { dateField: 'date', yearlyField: 'yearly' }
    const provider: AppDataProvider = {
      manifest: { id: 'future-celebrations', name: '节日簿', english: 'Celebrations', aliases: ['节庆'], availability: 'installable', schemaVersion: 1, scopes: [{ id: 'dates', name: '节庆日期', english: 'Dates', fields: ['name', 'date', 'yearly', 'nextDate', 'daysUntil', 'count'], sensitive: true, calendar, countLabel: { zh: '节庆数量', en: 'Celebration count' } }] },
      async read(_scope, query) {
        const rows = [{ id: 'one', fields: { name: '未来节庆', date: '2001-11-09', yearly: true } }]
        const selected = query.operation === 'upcoming' ? applyCalendarQuery(rows, calendar, query) : rows
        return { status: 'ok', records: query.operation === 'count' ? [] : selected.slice(0, query.limit), summary: { count: selected.length }, revision: 'stable', truncated: false }
      },
    }
    unregister = registerMiniApp({ app: { id: provider.manifest.id, name: provider.manifest.name, english: provider.manifest.english, description: 'D', englishDescription: 'D', icon: 'A', color: '#abc', category: 'life' }, provider, component: () => null, clearData: async () => {} })
    setExtensionInstalled('future-celebrations', true)
    expect(await ask('最近的节庆')).toContain('下一次日期：2026-11-09')
    expect(await ask('节庆有几条')).toContain('节庆数量：1')
  })
  it('does not misclassify a money-total request as a count of ledger entries', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T12:00:00'))
    localStorage.setItem('aily-desktop-ledger', JSON.stringify([{ id: 'one', date: '2026-11-01', kind: 'expense', cents: 1234, note: '' }]))
    expect(await ask('记账本月花了多少')).toContain('支出（分）：1234')
  })
})
