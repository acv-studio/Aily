import 'fake-indexeddb/auto'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DesktopTools from './DesktopTools'
import { getLocale, setLocale } from './i18n'
import { getThemePreference, setThemePreference } from './theme'
import { defaultSkinRoutines, SKIN_PLAN_KEY, SKIN_RECORD_KEY, type SkinRecord } from './skincareData'
import { skincarePhotoDb, type SkincarePhoto } from './skincarePhotos'
import { mediaDb } from './mediaLibrary'

// Every record/photo in this suite is synthetic. fake-indexeddb is installed by
// test-setup before either database module loads; no browser/native data is used.
const TODAY = '2026-11-07'
const saved = (id: string, date = TODAY, period: '早' | '晚' = '早', extra: Partial<SkinRecord> = {}): SkinRecord => ({ id, date, period, products: '测试保湿霜', condition: '稳定', notes: `测试日记-${id}`, ...extra })
const seed = (records: SkinRecord[]) => localStorage.setItem(SKIN_RECORD_KEY, JSON.stringify(records))
const records = (): SkinRecord[] => JSON.parse(localStorage.getItem(SKIN_RECORD_KEY) ?? '[]')
const tab = (name: 'plans' | 'calendar' | 'diary') => fireEvent.click(screen.getByTestId(`skincare-tab-${name}`))
const editor = () => within(screen.getByTestId('skincare-editor'))
const change = (label: string | RegExp, value: string) => fireEvent.change(editor().getByLabelText(label), { target: { value } })
const button = (name: string | RegExp) => fireEvent.click(editor().getByRole('button', { name }))
const mount = (onClose = vi.fn()) => render(<DesktopTools tool="skincare-diary" onClose={onClose} />)
const add = () => { tab('diary'); fireEvent.click(screen.getByRole('button', { name: '写日记' })) }
const recordNode = (id: string) => document.querySelector<HTMLElement>(`.sk-record[data-record-id="${id}"]`)!
const edit = (id: string) => fireEvent.click(within(recordNode(id)).getByRole('button', { name: /^编辑记录/ }))
const image = (name = 'synthetic.png', size = 4, type = 'image/png') => new File([new Uint8Array(size)], name, { type })
const upload = (files: File[]) => fireEvent.change(screen.getByTestId('skincare-editor').querySelector('input[type="file"]')!, { target: { files } })
const saveEntry = () => fireEvent.submit(screen.getByTestId('skincare-editor').querySelector('form')!)
const closeEditor = async () => { button('关闭编辑器'); if (editor().queryByRole('button', { name: '放弃修改' })) button('放弃修改'); await waitFor(() => expect(screen.queryByTestId('skincare-editor')).toBeNull()) }
const photo = (id: string): SkincarePhoto => ({ id, name: `${id}.png`, blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), createdAt: '2026-11-07T04:00:00Z' })

let previousStorage: [string, string][]
let previousPhotos: SkincarePhoto[]
let previousLocale: ReturnType<typeof getLocale>
let previousTheme: ReturnType<typeof getThemePreference>
let previousRoot: { theme: string | undefined; scheme: string; lang: string; title: string }
let previousURL: { create?: PropertyDescriptor; revoke?: PropertyDescriptor }
let sharedAdd: ReturnType<typeof vi.spyOn>, sharedBulkAdd: ReturnType<typeof vi.spyOn>, sharedPut: ReturnType<typeof vi.spyOn>
let network: ReturnType<typeof vi.fn>

beforeEach(async () => {
  previousStorage = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!).map(key => [key, localStorage.getItem(key)!])
  previousLocale = getLocale(); previousTheme = getThemePreference()
  previousRoot = { theme: document.documentElement.dataset.theme, scheme: document.documentElement.style.colorScheme, lang: document.documentElement.lang, title: document.title }
  previousURL = { create: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'), revoke: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL') }
  vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('File', NodeFile)
  network = vi.fn(async () => { throw new Error('Network/model calls are forbidden in this local-only suite') })
  vi.stubGlobal('fetch', network)
  // Snapshot/restore fake private DB rows, never delete a database.
  previousPhotos = await skincarePhotoDb.photos.toArray()
  await skincarePhotoDb.photos.clear()
  localStorage.clear(); setLocale('zh-CN'); setThemePreference('light')
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 7, 12, 0, 0))
  let nextURL = 0
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:synthetic-skincare-${++nextURL}`) })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  sharedAdd = vi.spyOn(mediaDb.items, 'add'); sharedBulkAdd = vi.spyOn(mediaDb.items, 'bulkAdd'); sharedPut = vi.spyOn(mediaDb.items, 'put')
})
afterEach(async () => {
  cleanup()
  // Drain asynchronous draft cleanup before restoring fixture snapshots.
  await act(async () => { await skincarePhotoDb.photos.count() })
  expect(sharedAdd).not.toHaveBeenCalled(); expect(sharedBulkAdd).not.toHaveBeenCalled(); expect(sharedPut).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled()
  vi.restoreAllMocks(); vi.useRealTimers()
  await skincarePhotoDb.photos.clear()
  if (previousPhotos.length) await skincarePhotoDb.photos.bulkPut(previousPhotos)
  setLocale(previousLocale); setThemePreference(previousTheme)
  localStorage.clear(); previousStorage.forEach(([key, value]) => localStorage.setItem(key, value))
  if (previousRoot.theme === undefined) delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = previousRoot.theme
  document.documentElement.style.colorScheme = previousRoot.scheme; document.documentElement.lang = previousRoot.lang; document.title = previousRoot.title
  for (const [key, descriptor] of [['createObjectURL', previousURL.create], ['revokeObjectURL', previousURL.revoke]] as const) {
    if (descriptor) Object.defineProperty(URL, key, descriptor); else Reflect.deleteProperty(URL, key)
  }
  vi.unstubAllGlobals()
})

// Fixtures are captured from the actual portalled DesktopTools body, not a
// hand-authored imitation. Serialize controlled form properties as attributes.
function capture(name: string, theme: 'light' | 'dark') {
  const clone = document.body.cloneNode(true) as HTMLBodyElement
  const live = document.body.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')
  clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((node, index) => {
    const source = live[index]
    if (node.tagName === 'TEXTAREA') node.textContent = source.value
    else if (node.tagName === 'SELECT') Array.from((node as HTMLSelectElement).options).forEach(option => { option.toggleAttribute('selected', option.value === source.value) })
    else if ((node as HTMLInputElement).type !== 'file') { node.setAttribute('value', source.value); node.toggleAttribute('checked', (source as HTMLInputElement).checked) }
  })
  // Blob URLs belong to the test runtime; embed the explicitly synthetic fixture
  // PNG for standalone review, while retaining the actual preview DOM/alt text.
  clone.querySelectorAll<HTMLImageElement>('img[src^="blob:synthetic-skincare-"]').forEach(img => { img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=' })
  const css = ['desktopTools.css', 'tools-theme.css', 'skincareReference.css'].map(file => readFileSync(resolve('src', file), 'utf8')).join('\n')
  const directory = resolve('.mobile-build/skincare-reference-fixtures')
  mkdirSync(directory, { recursive: true })
  const html = `<!doctype html><html lang="zh-CN" data-theme="${theme}" style="color-scheme:${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Skincare ${name} — ${theme} — ${TODAY}</title><style>html,body{margin:0;width:100%;height:100%;font-family:Arial,sans-serif}${css}</style></head>${clone.outerHTML}</html>`
  writeFileSync(resolve(directory, `${name}-${theme}.html`), html)
  if (theme === 'light') writeFileSync(resolve(directory, `${name}.html`), html)
  expect(clone.querySelector('.desktop-tools-dialog.skincare-shell')).not.toBeNull()
  expect(clone.querySelector('[data-testid="skincare-app"]')?.classList.contains('sk-night')).toBe(theme === 'dark')
}

describe('SkincareApp through the real DesktopTools shell', () => {
  it('mounts legacy records read-only without automatic record, plan or photo writes', async () => {
    const legacy = saved('legacy', '2026-11-06', '晚', { custom: { untouched: true } })
    const raw = JSON.stringify([legacy], null, 2); localStorage.setItem(SKIN_RECORD_KEY, raw)
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    mount(); tab('calendar'); tab('diary'); tab('plans')
    expect(localStorage.getItem(SKIN_RECORD_KEY)).toBe(raw); expect(localStorage.getItem(SKIN_PLAN_KEY)).toBeNull()
    expect(writes).not.toHaveBeenCalled(); expect(await skincarePhotoDb.photos.count()).toBe(0)
  })

  it('shows two unsaved templates with zero actual products and one own header/navigation', () => {
    mount()
    expect(screen.getByTestId('skincare-plan-morning')).toHaveTextContent('3 个步骤 · 0 款产品')
    expect(screen.getByTestId('skincare-plan-evening')).toHaveTextContent('2 个步骤 · 0 款产品')
    expect(document.querySelector('.desktop-tools-dialog')).toHaveClass('skincare-shell')
    expect(document.querySelector('.desktop-tools-header')).toHaveAttribute('hidden')
    expect(screen.getAllByRole('button', { name: '返回' })).toHaveLength(1)
    expect(screen.getByRole('navigation', { name: '护肤导航' })).toBeVisible()
    expect(localStorage.getItem(SKIN_RECORD_KEY)).toBeNull(); expect(localStorage.getItem(SKIN_PLAN_KEY)).toBeNull()
  })

  it('follows global theme until a local night override, without changing global preference', () => {
    mount(); expect(screen.getByTestId('skincare-app')).not.toHaveClass('sk-night')
    act(() => setThemePreference('dark')); expect(screen.getByTestId('skincare-app')).toHaveClass('sk-night')
    fireEvent.click(screen.getByRole('button', { name: '切换浅色主题' }))
    expect(screen.getByTestId('skincare-app')).not.toHaveClass('sk-night'); expect(getThemePreference()).toBe('dark')
    act(() => setThemePreference('light')); act(() => setThemePreference('dark'))
    expect(screen.getByTestId('skincare-app')).not.toHaveClass('sk-night')
  })

  it.each([['morning', '早'], ['evening', '晚']] as const)('uniquely completes %s for today, preserving other dates and periods', async (slot, period) => {
    seed([saved('yesterday', '2026-11-06', period), saved('other-period', TODAY, period === '早' ? '晚' : '早')]); mount()
    const done = screen.getByTestId(`skincare-complete-${slot}`)
    act(() => { fireEvent.click(done); fireEvent.click(done); fireEvent.click(done) })
    expect(records().filter(record => record.date === TODAY && record.period === period)).toHaveLength(1)
    expect(records()).toHaveLength(3)
    fireEvent.click(done)
    expect(screen.getByTestId('skincare-editor')).toBeInTheDocument()
    expect(editor().getByDisplayValue('计划完成')).toBeInTheDocument()
    await closeEditor(); fireEvent.click(done)
    expect(records()).toHaveLength(3)
  })

  it('edits templates, persists both slots and counts only nonblank product strings across reload', async () => {
    const view = mount(); fireEvent.click(screen.getByRole('button', { name: '编辑计划 晨间护肤' }))
    change('计划名称', '我的晨间计划')
    const products = editor().getAllByLabelText(/产品/)
    fireEvent.change(products[0], { target: { value: '测试洁面' } }); fireEvent.change(products[1], { target: { value: '   ' } }); fireEvent.change(products[2], { target: { value: '测试防晒' } })
    fireEvent.submit(screen.getByTestId('skincare-editor').querySelector('form')!)
    await waitFor(() => expect(screen.queryByTestId('skincare-editor')).toBeNull())
    const plans = JSON.parse(localStorage.getItem(SKIN_PLAN_KEY)!)
    expect(plans).toHaveLength(2); expect(plans[1]).toEqual(defaultSkinRoutines[1])
    expect(screen.getByTestId('skincare-plan-morning')).toHaveTextContent('3 个步骤 · 2 款产品')
    view.unmount(); mount(); expect(screen.getByTestId('skincare-plan-morning')).toHaveTextContent('我的晨间计划')
    expect(screen.getByTestId('skincare-plan-morning')).toHaveTextContent('2 款产品')
  })

  it('calendar counts unique date/periods, renders adjacent days and supports month controls', () => {
    seed([saved('am-1'), saved('am-duplicate'), saved('pm', TODAY, '晚'), saved('next-day', '2026-11-08'), saved('oct', '2026-10-31'), saved('dec', '2026-12-01')]); mount(); tab('calendar')
    const calendar = screen.getByTestId('skincare-calendar')
    expect(within(calendar).getByRole('button', { name: `${TODAY}, 早间 已记录, 晚间 已记录` })).toHaveClass('is-today')
    expect(within(calendar).getByRole('button', { name: /^2026-10-31,/ })).toHaveClass('is-adjacent')
    expect(within(calendar).getByRole('button', { name: /^2026-12-01,/ })).toHaveClass('is-adjacent')
    // Display order is morning periods, evening periods, then recorded days.
    expect(Array.from(calendar.querySelectorAll('.sk-stats strong')).map(node => node.textContent)).toEqual(['2', '1', '2'])
    fireEvent.click(screen.getByRole('button', { name: '上个月' })); expect(screen.getByRole('heading', { name: '2026年10月' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下个月' })); fireEvent.click(screen.getByRole('button', { name: '下个月' })); expect(screen.getByRole('heading', { name: '2026年12月' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '回到今天' })); expect(screen.getByRole('heading', { name: '2026年11月' })).toBeInTheDocument()
  })

  it('clicking an exact calendar day filters diary records and seeds new entry date', () => {
    seed([saved('one'), saved('two', TODAY, '晚'), saved('outside', '2026-11-08')]); mount(); tab('calendar')
    fireEvent.click(screen.getByRole('button', { name: `${TODAY}, 早间 已记录, 晚间 已记录` }))
    expect(screen.getByTestId('skincare-diary')).toBeInTheDocument(); expect(screen.getByLabelText('按日期查看')).toHaveValue(TODAY)
    expect(document.querySelectorAll('.sk-record')).toHaveLength(2); expect(recordNode('outside')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '写日记' })); expect(editor().getByDisplayValue(TODAY)).toBeInTheDocument()
  })

  it('legacy editing preserves extension fields, original photo references and unrelated records', async () => {
    await skincarePhotoDb.photos.put(photo('saved-photo'))
    const legacy = saved('legacy', TODAY, '晚', { photoIds: ['saved-photo'], unknownField: { source: 'old-format', number: 7 } })
    seed([legacy, saved('unrelated')]); mount(); tab('diary'); edit('legacy')
    change('备注', '新的测试备注'); saveEntry()
    await waitFor(() => expect(screen.queryByTestId('skincare-editor')).toBeNull())
    expect(records()[0]).toEqual({ ...legacy, notes: '新的测试备注' }); expect(records()[1]).toEqual(saved('unrelated'))
    expect(await skincarePhotoDb.photos.get('saved-photo')).toBeDefined()
  })

  it('failed record save keeps draft and previous records untouched', async () => {
    seed([saved('existing')]); mount(); add(); change('备注', '未保存的测试草稿')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('synthetic quota failure') })
    saveEntry()
    await waitFor(() => expect(editor().getByRole('alert')).toHaveTextContent('本次修改未保存'))
    expect(editor().getByLabelText('备注')).toHaveValue('未保存的测试草稿'); expect(records()).toEqual([saved('existing')])
  })

  it('stale record save retains draft, protects external raw data and refuses changed original after reload', async () => {
    seed([saved('existing')]); mount(); tab('diary'); edit('existing'); change('备注', '我的保留草稿')
    const external = saved('existing', TODAY, '早', { notes: '另一页面的新备注', extension: true }); seed([external]); saveEntry()
    await waitFor(() => expect(editor().getByRole('alert')).toHaveTextContent('本地数据已在其他页面'))
    expect(editor().getByLabelText('备注')).toHaveValue('我的保留草稿'); expect(records()).toEqual([external])
    button('重新读取'); saveEntry()
    await waitFor(() => expect(editor().getByRole('alert')).toHaveTextContent('此记录或计划已更改'))
    expect(records()).toEqual([external]); expect(editor().getByLabelText('备注')).toHaveValue('我的保留草稿')
  })

  it.each(['{corrupt', JSON.stringify([saved('duplicate'), saved('duplicate')]), JSON.stringify([{ ...saved('bad'), photoIds: ['https://invalid.test/private.png'] }])])('protects malformed record raw bytes %s with disabled write controls', raw => {
    localStorage.setItem(SKIN_RECORD_KEY, raw); const writes = vi.spyOn(Storage.prototype, 'setItem'); mount()
    expect(screen.getByRole('alert')).toHaveTextContent('本地数据读取失败')
    expect(screen.getByTestId('skincare-complete-morning')).toBeDisabled(); tab('diary')
    expect(screen.getByRole('button', { name: '写日记' })).toBeDisabled(); expect(localStorage.getItem(SKIN_RECORD_KEY)).toBe(raw); expect(writes).not.toHaveBeenCalled()
  })

  it('protects corrupt plans from replacement while retaining the editable draft', () => {
    localStorage.setItem(SKIN_PLAN_KEY, '{corrupt-plans'); mount(); fireEvent.click(screen.getByRole('button', { name: '编辑计划 晨间护肤' }))
    change('计划名称', '保留计划草稿'); fireEvent.submit(screen.getByTestId('skincare-editor').querySelector('form')!)
    expect(editor().getByRole('alert')).toHaveTextContent('本地数据读取失败'); expect(editor().getByLabelText('计划名称')).toHaveValue('保留计划草稿')
    expect(localStorage.getItem(SKIN_PLAN_KEY)).toBe('{corrupt-plans')
  })

  it('failed plan save retains editable template and does not write either slot', () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: '编辑计划 晨间护肤' })); change('计划名称', '未保存的计划草稿')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('synthetic plan quota') })
    fireEvent.submit(screen.getByTestId('skincare-editor').querySelector('form')!)
    expect(editor().getByRole('alert')).toHaveTextContent('本次修改未保存'); expect(editor().getByLabelText('计划名称')).toHaveValue('未保存的计划草稿')
    expect(localStorage.getItem(SKIN_PLAN_KEY)).toBeNull()
  })

  it('stale template save keeps draft and protects both externally updated slots', () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: '编辑计划 晨间护肤' })); change('计划名称', '我的计划草稿')
    const external = defaultSkinRoutines.map(plan => ({ ...plan, name: `${plan.name}-外部更新` })); localStorage.setItem(SKIN_PLAN_KEY, JSON.stringify(external))
    fireEvent.submit(screen.getByTestId('skincare-editor').querySelector('form')!)
    expect(editor().getByRole('alert')).toHaveTextContent('本地数据已在其他页面'); button('重新读取')
    fireEvent.submit(screen.getByTestId('skincare-editor').querySelector('form')!)
    expect(editor().getByRole('alert')).toHaveTextContent('此记录或计划已更改'); expect(editor().getByLabelText('计划名称')).toHaveValue('我的计划草稿')
    expect(JSON.parse(localStorage.getItem(SKIN_PLAN_KEY)!)).toEqual(external)
  })

  it('delete confirmation identifies and removes only one synthetic record, keeping shared photo references', async () => {
    await skincarePhotoDb.photos.bulkPut([photo('shared-photo'), photo('only-target-photo')])
    const target = saved('target', TODAY, '晚', { products: '仅删除这条测试产品', photoIds: ['shared-photo', 'only-target-photo'] })
    const keep = saved('keep', TODAY, '晚', { photoIds: ['shared-photo'] }); seed([target, keep]); mount(); tab('diary')
    fireEvent.click(within(recordNode('target')).getByRole('button', { name: /^删除/ }))
    expect(records()).toEqual([target, keep]); expect(editor().getByText('仅删除这条测试产品')).toBeInTheDocument()
    button('取消'); await waitFor(() => expect(screen.queryByTestId('skincare-editor')).toBeNull()); expect(records()).toEqual([target, keep])
    fireEvent.click(within(recordNode('target')).getByRole('button', { name: /^删除/ })); button('确认删除这条记录')
    await waitFor(async () => expect(await skincarePhotoDb.photos.get('only-target-photo')).toBeUndefined())
    expect(records()).toEqual([keep]); expect(await skincarePhotoDb.photos.get('shared-photo')).toBeDefined()
  })

  it('failed confirmed deletion retains exact record and private photos', async () => {
    await skincarePhotoDb.photos.put(photo('delete-retained'))
    const original = saved('delete-failure', TODAY, '晚', { photoIds: ['delete-retained'] }); seed([original]); mount(); tab('diary')
    fireEvent.click(within(recordNode('delete-failure')).getByRole('button', { name: /^删除/ }))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('synthetic deletion failure') })
    button('确认删除这条记录'); await waitFor(() => expect(editor().getByRole('alert')).toHaveTextContent('原数据保持不变'))
    expect(records()).toEqual([original]); expect(await skincarePhotoDb.photos.get('delete-retained')).toBeDefined()
  })

  it('invalid/empty date cannot produce a partial new record', () => {
    mount(); add(); change('备注', '日期无效的测试草稿')
    const date = screen.getByTestId('skincare-editor').querySelector('input[type="date"]')!
    fireEvent.change(date, { target: { value: '' } }); saveEntry()
    expect(editor().getByRole('alert')).toHaveTextContent('有效日期与时段'); expect(records()).toEqual([])
    expect(editor().getByLabelText('备注')).toHaveValue('日期无效的测试草稿')
  })

  it('requires products, notes or a photo before saving a new entry', async () => {
    mount(); add(); saveEntry()
    expect(editor().getByRole('alert')).toHaveTextContent('至少一项'); expect(records()).toEqual([])
    change('备注', '仅备注也可保存'); saveEntry(); await waitFor(() => expect(screen.queryByTestId('skincare-editor')).toBeNull())
    expect(records()[0]).toMatchObject({ date: TODAY, period: '早', notes: '仅备注也可保存', products: '' })
  })

  it.each([
    ['over-three', () => [image('1.png'), image('2.png'), image('3.png'), image('4.png')], '最多 3 张'],
    ['over-five-MB', () => [image('valid.png'), image('large.png', 5 * 1024 * 1024 + 1)], '不超过 5 MB'],
    ['SVG', () => [image('valid.png'), image('unsafe.svg', 4, 'image/svg+xml')], 'JPEG、PNG 或 WebP'],
    ['empty', () => [image('empty.png', 0)], '文件不能为空'],
  ] as const)('rejects %s picker selection before any partial photo/record writes', async (_name, files, message) => {
    mount(); add(); upload(files())
    await waitFor(() => expect(editor().getByRole('alert')).toHaveTextContent(message))
    expect(await skincarePhotoDb.photos.count()).toBe(0); expect(localStorage.getItem(SKIN_RECORD_KEY)).toBeNull(); expect(editor().queryByRole('img')).toBeNull()
  })

  it('accepts three photos at exact 5MB in the isolated private DB, never creating album rows', async () => {
    mount(); add(); upload([image('limit.png', 5 * 1024 * 1024), image('two.jpg', 4, 'image/jpeg'), image('three.webp', 4, 'image/webp')])
    await waitFor(() => expect(editor().getAllByRole('img')).toHaveLength(3))
    expect(await skincarePhotoDb.photos.count()).toBe(3); saveEntry()
    await waitFor(() => expect(screen.queryByTestId('skincare-editor')).toBeNull())
    expect(records()[0].photoIds).toHaveLength(3); expect(localStorage.getItem('aily-desktop-album')).toBeNull()
    expect(URL.createObjectURL).toHaveBeenCalled(); expect(screen.getByText(/独立本地图库/)).toBeInTheDocument()
  })

  it('counts existing references against the three-photo picker limit without partial new rows', async () => {
    await skincarePhotoDb.photos.put(photo('existing-limit'))
    const original = saved('existing-limit-record', TODAY, '早', { photoIds: ['existing-limit'] }); seed([original]); mount(); tab('diary'); edit('existing-limit-record')
    await waitFor(() => expect(editor().getByRole('img')).toBeInTheDocument())
    upload([image('one.png'), image('two.png'), image('three.png')])
    expect(editor().getByRole('alert')).toHaveTextContent('最多 3 张'); expect(await skincarePhotoDb.photos.count()).toBe(1)
    expect(records()).toEqual([original])
  })

  it('atomic photo import failure leaves neither successful partial rows nor new record data', async () => {
    await skincarePhotoDb.photos.put(photo('duplicate-key'))
    mount(); add(); change('备注', '导入失败也保留草稿')
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('00000000-0000-4000-8000-000000000001').mockReturnValueOnce('duplicate-key' as ReturnType<typeof crypto.randomUUID>)
    upload([image('would-write.png'), image('duplicate.png')])
    await waitFor(() => expect(editor().getByRole('alert')).toHaveTextContent('照片未能导入'))
    expect((await skincarePhotoDb.photos.toArray()).map(row => row.id)).toEqual(['duplicate-key'])
    expect(editor().getByLabelText('备注')).toHaveValue('导入失败也保留草稿'); expect(localStorage.getItem(SKIN_RECORD_KEY)).toBeNull()
  })

  it('cancelling an imported draft cleans only newly imported IDs, retaining saved and unrelated photos', async () => {
    await skincarePhotoDb.photos.bulkPut([photo('saved-photo'), photo('unrelated-photo')])
    const original = saved('original', TODAY, '早', { photoIds: ['saved-photo'] }); seed([original]); mount(); tab('diary'); edit('original')
    upload([image('new-only.png')]); await waitFor(() => expect(editor().getAllByRole('img')).toHaveLength(2))
    expect(await skincarePhotoDb.photos.count()).toBe(3); await closeEditor()
    expect(records()).toEqual([original]); expect((await skincarePhotoDb.photos.toArray()).map(row => row.id).sort()).toEqual(['saved-photo', 'unrelated-photo'])
  })

  it('draft cancellation rechecks externally saved references before cleaning new IDs', async () => {
    mount(); add(); upload([image('externally-referenced.png')]); await waitFor(() => expect(editor().getByRole('img')).toBeInTheDocument())
    const [row] = await skincarePhotoDb.photos.toArray()
    const external = saved('external-reference', TODAY, '晚', { photoIds: [row.id] }); seed([external]); await closeEditor()
    expect(records()).toEqual([external]); expect(await skincarePhotoDb.photos.get(row.id)).toBeDefined()
  })

  it('failed record persistence retains newly imported photos and draft for a successful retry', async () => {
    mount(); add(); upload([image('retained-draft.png')]); await waitFor(() => expect(editor().getByRole('img')).toBeInTheDocument())
    change('备注', '照片与草稿都保留')
    const fail = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('synthetic storage failure') })
    saveEntry(); await waitFor(() => expect(editor().getByRole('alert')).toHaveTextContent('草稿已保留'))
    expect(await skincarePhotoDb.photos.count()).toBe(1); expect(records()).toEqual([]); expect(editor().getByLabelText('备注')).toHaveValue('照片与草稿都保留')
    fail.mockRestore(); saveEntry(); await waitFor(() => expect(screen.queryByTestId('skincare-editor')).toBeNull())
    expect(records()[0].photoIds).toHaveLength(1); expect(await skincarePhotoDb.photos.count()).toBe(1)
  })

  it('missing private photo references visibly report an error without erasing the record', async () => {
    const original = saved('missing', TODAY, '早', { photoIds: ['missing-photo'] }); seed([original]); mount(); tab('diary')
    expect(await screen.findByRole('alert')).toHaveTextContent('照片读取失败或已不存在'); expect(records()).toEqual([original])
    edit('missing'); expect(await editor().findByRole('alert')).toHaveTextContent('照片读取失败或已不存在')
  })

  it('dirty Escape opens inner discard confirmation and never closes outer DesktopTools', async () => {
    const onClose = vi.fn(); mount(onClose); add(); change('备注', '未保存的测试修改')
    fireEvent.keyDown(editor().getByLabelText('备注'), { key: 'Escape' })
    expect(editor().getByRole('alert')).toHaveTextContent('放弃未保存的修改'); expect(onClose).not.toHaveBeenCalled()
    button('继续编辑'); expect(editor().getByLabelText('备注')).toHaveValue('未保存的测试修改')
    fireEvent.keyDown(document, { key: 'Escape' }); expect(onClose).not.toHaveBeenCalled(); button('放弃修改')
    await waitFor(() => expect(screen.queryByTestId('skincare-editor')).toBeNull()); expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' }); expect(onClose).toHaveBeenCalledTimes(1)
  })

  it.each(['light', 'dark'] as const)('captures all Chinese %s reference states from actual DesktopTools body', async theme => {
    setThemePreference(theme)
    seed([saved('fixture-am', TODAY, '早', { products: '测试洁面；测试防晒', notes: '今天的测试肤况稳定' }), saved('fixture-pm', '2026-11-06', '晚', { condition: '干燥', notes: '仅用于参考的晚间记录' })])
    mount(); capture('plans', theme); tab('calendar'); capture('calendar', theme); tab('diary'); capture('diary', theme)
    fireEvent.change(screen.getByLabelText('按日期查看'), { target: { value: '2026-11-05' } }); capture('diary-filtered', theme); fireEvent.click(screen.getByRole('button', { name: '全部记录' }))
    edit('fixture-am'); change('备注', '编辑中的测试草稿'); capture('editor', theme); await closeEditor()
    tab('plans'); fireEvent.click(screen.getByRole('button', { name: '编辑计划 晨间护肤' })); change('计划名称', '编辑中的晨间计划'); capture('plan-editor', theme); await closeEditor()
    add(); upload([image('测试肤况.png')]); await waitFor(() => expect(editor().getByRole('img')).toBeInTheDocument()); change('备注', '照片草稿，尚未保存'); capture('photo-draft', theme); await closeEditor()
    cleanup(); localStorage.setItem(SKIN_RECORD_KEY, '{synthetic-read-error'); mount(); capture('read-error', theme)
  })
})
