import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Blob as NodeBlob } from 'node:buffer'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Capacitor } from '@capacitor/core'
import { Camera } from '@capacitor/camera'
import DesktopTools, { type DesktopTool } from './DesktopTools'
import { extensionApps } from './extensionApps'
import { defaultSettings } from './mealPlanner'
import { mediaDb, type LibraryMedia, type PhotoDecision, type MediaSetting } from './mediaLibrary'
import { DEFAULT_MUSIC_SETTING_KEY } from './defaultMusic'
import { laughterDb, type LaughterRecording } from './laughterStorage'
import { getLocale, setLocale } from './i18n'

// Dexie caches intrinsic constructors at module load. Node's structuredClone (used
// by fake-indexeddb) supports Node Blob, not jsdom Blob; install it before imports
// so both the real Dexie renderer and fake storage preserve valid Blob objects.
const originalBlobDescriptor = await vi.hoisted(async () => {
  const { Blob } = await import('node:buffer')
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Blob')
  Object.defineProperty(globalThis, 'Blob', { configurable: true, writable: true, value: Blob })
  return descriptor
})
afterAll(() => {
  if (originalBlobDescriptor) Object.defineProperty(globalThis, 'Blob', originalBlobDescriptor)
  else Reflect.deleteProperty(globalThis, 'Blob')
})

// Capacitor's Camera export is a lazy Proxy, not a spyable native object.
vi.mock('@capacitor/camera', async importOriginal => {
  const actual = await importOriginal<typeof import('@capacitor/camera')>()
  return { ...actual, Camera: { chooseFromGallery: vi.fn() } }
})

/** These fixtures contain the real portal DOM, not a mock tool or a hand-built app shell.
 * Run only this file: npx vitest run src/ToolSurfaceCoverage.test.tsx
 * No CSS is embedded: the browser audit must inject final production styles.
 * All writes to application storage are confined to this test's jsdom instance.
 */
const fixtureDirectory = resolve(process.cwd(), '.mobile-build/tool-surface')
const tools: DesktopTool[] = ['ledger', 'album', 'contacts', 'music', 'diary', 'divination', 'app-store', 'focus-timer', 'skincare-diary', 'wardrobe', 'anniversary', 'gomoku', 'game-2048', 'meal-planner', 'laughter-collector', 'photo-organizer']
const previousLocale = getLocale()
let storageSnapshot: [string, string][] = []
let mediaSnapshot: LibraryMedia[] = []
let photoDecisionSnapshot: PhotoDecision[] = []
let mediaSettingSnapshot: MediaSetting[] = []
let laughterSnapshot: LaughterRecording[] = []
let bodyStyle: string | null
let htmlTheme: string | null
let htmlLang: string | null
let documentTitle: string
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
const originalCreateURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
const imageURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='

beforeEach(async () => {
  // Freeze Date only (not interval/timeout APIs): stable month/countdown fixtures,
  // while the actual media liveQuery and React cleanup use real timers.
  vi.setSystemTime(new Date('2026-11-07T12:00:00.000Z'))
  // test-setup installs fake-indexeddb; this never opens a user's physical database.
  mediaSnapshot = await mediaDb.items.toArray()
  photoDecisionSnapshot = await mediaDb.photoDecisions.toArray()
  mediaSettingSnapshot = await mediaDb.settings.toArray()
  await mediaDb.settings.clear()
  // These fixtures test empty/seeded imports; first-open default seeding has separate dedicated tests.
  await mediaDb.settings.put({ key: DEFAULT_MUSIC_SETTING_KEY, value: { version: 1, initialized: true } })
  laughterSnapshot = await laughterDb.recordings.toArray()
  await mediaDb.items.clear()
  await mediaDb.photoDecisions.clear()
  await laughterDb.recordings.clear()
  storageSnapshot = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!).map(key => [key, localStorage.getItem(key)!])
  bodyStyle = document.body.getAttribute('style')
  htmlTheme = document.documentElement.getAttribute('data-theme')
  htmlLang = document.documentElement.getAttribute('lang')
  documentTitle = document.title
  localStorage.clear()
  setLocale('zh-CN')
  document.documentElement.setAttribute('data-theme', 'light')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((file: Blob) => file.type.startsWith('image/') ? imageURL : 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false)
  vi.mocked(Camera.chooseFromGallery).mockClear().mockRejectedValue(new Error('Physical photo picker forbidden in surface coverage'))
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in surface coverage') }))
})

afterEach(async () => {
  cleanup()
  const picker = Camera.chooseFromGallery
  const network = fetch
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  for (const [target, key, descriptor] of [
    [HTMLElement.prototype, 'scrollIntoView', originalScroll],
    [URL, 'createObjectURL', originalCreateURL],
    [URL, 'revokeObjectURL', originalRevokeURL],
  ] as const) {
    if (descriptor) Object.defineProperty(target, key, descriptor)
    else Reflect.deleteProperty(target, key)
  }
  setLocale(previousLocale)
  localStorage.clear()
  storageSnapshot.forEach(([key, value]) => localStorage.setItem(key, value))
  for (const [element, key, value] of [[document.body, 'style', bodyStyle], [document.documentElement, 'data-theme', htmlTheme], [document.documentElement, 'lang', htmlLang]] as const) {
    if (value === null) element.removeAttribute(key)
    else element.setAttribute(key, value)
  }
  document.title = documentTitle
  await mediaDb.items.clear()
  if (mediaSnapshot.length) await mediaDb.items.bulkPut(mediaSnapshot)
  await mediaDb.photoDecisions.clear()
  if (photoDecisionSnapshot.length) await mediaDb.photoDecisions.bulkPut(photoDecisionSnapshot)
  await mediaDb.settings.clear()
  if (mediaSettingSnapshot.length) await mediaDb.settings.bulkPut(mediaSettingSnapshot)
  await laughterDb.recordings.clear()
  if (laughterSnapshot.length) await laughterDb.recordings.bulkPut(laughterSnapshot)
  expect(picker).not.toHaveBeenCalled()
  expect(network).not.toHaveBeenCalled()
})

function mount(tool: DesktopTool) {
  const onClose = vi.fn()
  // The renderer portals to document.body; do not insert an invented #root/app wrapper.
  const view = render(<DesktopTools tool={tool} onClose={onClose} onOpenTool={vi.fn()} />, { container: document.createElement('div') })
  expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  expect(screen.getByRole('dialog')).toHaveClass('tools-surface')
  expect(document.querySelector('.desktop-tools-overlay > .desktop-tools-dialog > .desktop-tools-header h2')).toHaveTextContent(/\S/)
  if (tool === 'music') fireEvent.click(screen.getByRole('button', { name: '收起播放器' }))
  expect(screen.getByRole('button', { name: tool === 'ledger' || tool === 'wardrobe' || tool === 'music' ? '返回 Aily' : '返回' })).toBeEnabled()
  return { ...view, onClose }
}
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const put = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value))

async function seed(tool: DesktopTool, populated: boolean) {
  if (tool === 'game-2048') {
    put('aily.ext.2048.grid', populated ? [0, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 0, 0] : [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2])
    put('aily.ext.2048.score', 0)
  }
  if (!populated) return
  if (tool === 'album' || tool === 'music') {
    const image = tool === 'album'
    await mediaDb.items.put({ id: `fixture-${tool}`, kind: tool, name: image ? '测试旅行照片.png' : '测试轻音乐.wav', blob: new NodeBlob(['test fixture only'], { type: image ? 'image/png' : 'audio/wav' }) as unknown as Blob, mime: image ? 'image/png' : 'audio/wav', addedAt: '2026-11-04T12:00:00.000Z', favorite: true, collection: image ? '测试旅行' : '测试播放列表' })
  }
  if (tool === 'laughter-collector') await laughterDb.recordings.put({ id: 'fixture-laughter', person: '测试小林', name: '测试：晚饭时的哈哈大笑', createdAt: '2026-11-04T12:00:00.000Z', duration: 12.5, blob: new NodeBlob(['test laughter only'], { type: 'audio/wav' }) as unknown as Blob })
  if (tool === 'photo-organizer') {
    await mediaDb.items.bulkPut([1, 2].map(index => ({ id: `fixture-organizer-${index}`, kind: 'album' as const, name: `测试整理照片${index}.png`, blob: new NodeBlob(['test organizer only'], { type: 'image/png' }) as unknown as Blob, mime: 'image/png', addedAt: `2026-11-0${index}T12:00:00.000Z`, favorite: false, collection: '测试相册整理' })))
    await mediaDb.photoDecisions.bulkPut([{ id: 'library:fixture-organizer-1', status: 'pending', updatedAt: '2026-11-04T12:00:00.000Z' }, { id: 'library:fixture-organizer-2', status: 'keep', updatedAt: '2026-11-04T12:00:00.000Z' }])
  }
  if (tool === 'ledger') put('aily-desktop-ledger', [{ id: 'fixture-income', kind: 'income', cents: 125000, note: '测试工资收入', date: '2026-11-04' }, { id: 'fixture-expense', kind: 'expense', cents: 1230, note: '午餐和热饮', date: '2026-11-04' }])
  if (tool === 'contacts') put('aily-desktop-contacts', [{ id: 'fixture-contact', name: '测试小林', phone: '13800000000', email: 'fixture@example.invalid' }])
  if (tool === 'diary') put('aily-desktop-diary', [{ id: 'fixture-diary', date: '2026-11-04', text: '今天沿着河边散步，记下傍晚的云和温柔的风。\n这是仅用于测试的日记，不是真实用户数据。' }])
  if (tool === 'skincare-diary') put('aily.ext.skincare', [{ id: 'fixture-skin', date: '2026-11-04', period: '晚', products: '洁面 → 保湿精华 → 面霜', condition: '稳定', notes: '测试记录：今天注意保湿。' }])
  if (tool === 'wardrobe') put('aily.ext.wardrobe', [{ id: 'fixture-top', name: '柔软的白色衬衫', category: '上装', color: '奶白色', season: '四季' }, { id: 'fixture-bottom', name: '深蓝牛仔裤', category: '下装', color: '深蓝色', season: '春秋' }, { id: 'fixture-shoes', name: '轻便运动鞋', category: '鞋包', color: '灰色', season: '四季' }])
  if (tool === 'anniversary') put('aily.ext.anniversary', [{ id: 'fixture-anniversary', name: '测试：一起出发的日子', date: '2026-12-15', yearly: true }, { id: 'fixture-one-off', name: '测试：下一次旅行', date: '2027-03-20', yearly: false }])
  if (tool === 'app-store') put('aily.extension-apps.v1', extensionApps.map(app => app.id))
  if (tool === 'meal-planner') put('aily.ext.meal.v1', { settings: { ...defaultSettings, members: defaultSettings.members.map(member => ({ ...member })), pantry: [{ ingredientId: 'rice', quantity: 500 }, { ingredientId: 'egg', quantity: 6 }], prices: {} }, history: [] })
}

/** Mirrors the real DOM including controlled form values that HTML serialization omits. */
function serializeCloneDOM() {
  const body = document.body.cloneNode(true) as HTMLBodyElement
  const originals = document.body.querySelectorAll('input, textarea, select')
  const clones = body.querySelectorAll('input, textarea, select')
  originals.forEach((original, index) => {
    const clone = clones[index]
    if (original instanceof HTMLInputElement && clone instanceof HTMLInputElement) {
      if (original.type !== 'file') clone.setAttribute('value', original.value)
      if (original.checked) clone.setAttribute('checked', '')
      else clone.removeAttribute('checked')
    } else if (original instanceof HTMLTextAreaElement) clone.textContent = original.value
    else if (original instanceof HTMLSelectElement && clone instanceof HTMLSelectElement) {
      Array.from(clone.options).forEach((option, optionIndex) => {
        if (original.options[optionIndex].selected) option.setAttribute('selected', '')
        else option.removeAttribute('selected')
      })
    }
  })
  expect(body.querySelectorAll('.desktop-tools-overlay')).toHaveLength(1)
  expect(body.querySelector('.desktop-tools-header h2')).not.toBeNull()
  expect(body.querySelector('#root, #app, .app-root')).toBeNull()
  return body.outerHTML
}
function saveFixture(tool: DesktopTool, state: string) {
  mkdirSync(fixtureDirectory, { recursive: true })
  const markup = serializeCloneDOM()
  writeFileSync(resolve(fixtureDirectory, `${tool}-${state}.html`), `<!doctype html>\n<html lang="zh-CN" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${tool} · ${state}</title></head>${markup}</html>\n`, 'utf8')
}

function unnamedButtons() {
  return screen.getAllByRole('button').filter(button => {
    const references = button.getAttribute('aria-labelledby')?.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim()
    return !(button.textContent?.trim() || button.getAttribute('aria-label')?.trim() || references)
  })
}
function assertActionableButtonNames(tool: DesktopTool, populated: boolean) {
  const unnamed = unnamedButtons()
  expect(unnamed, `${tool} ${populated ? 'populated' : 'empty'}: unlabeled visible buttons`).toHaveLength(0)
  if (tool === 'gomoku') {
    expect(document.querySelectorAll('.gomoku-board button')).toHaveLength(225)
    document.querySelectorAll('.gomoku-board button').forEach((button, index) => expect(button).toHaveAttribute('aria-label', `棋位 ${index + 1}`))
  }
}
function populateTransient(tool: DesktopTool) {
  if (tool === 'album' || tool === 'music') {
    const image = tool === 'album'
    expect(screen.getByRole('button', { name: image ? '照片操作 测试旅行照片.png' : '移除 测试轻音乐.wav' })).toBeInTheDocument()
    if (image) expect(screen.queryByRole('button', { name: '移除 测试旅行照片.png' })).toBeNull()
    if (!image) {
      fireEvent.click(screen.getByRole('button', { name: '打开 测试轻音乐.wav' }))
      expect(screen.getByRole('heading', { name: '测试轻音乐.wav' })).toBeInTheDocument()
      expect(document.querySelectorAll('.music-vinyl-app audio')).toHaveLength(1)
    }
  }
  if (tool === 'divination') {
    change('想问的事情（可选）', '测试：如何安排平静的一天？')
    fireEvent.click(screen.getByRole('button', { name: '随机起卦' }))
    expect(screen.getByText('卦象解读')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('当前仅显示本机基础解读')
  }
  if (tool === 'focus-timer') {
    fireEvent.click(screen.getByRole('button', { name: '45 min' }))
    expect(screen.getByText('45:00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始' })).toBeEnabled()
  }
  if (tool === 'wardrobe') {
    fireEvent.click(screen.getByRole('button', { name: '随机生成穿搭' }))
    expect(screen.getByText('今日穿搭')).toBeInTheDocument()
  }
  if (tool === 'gomoku') {
    fireEvent.click(screen.getByRole('button', { name: '棋位 113' }))
    fireEvent.click(screen.getByRole('button', { name: '棋位 114' }))
    expect(screen.getByRole('button', { name: '悔棋' })).toBeEnabled()
  }
  if (tool === 'meal-planner') {
    fireEvent.click(screen.getByRole('button', { name: '生成这餐' }))
    expect(screen.getByRole('heading', { name: '这餐，安排好了' })).toBeInTheDocument()
    expect(document.querySelectorAll('.meal-card h3').length).toBe(defaultSettings.dishCount + 1)
  }
}

describe('real DesktopTools surface coverage and static fixtures', () => {
  for (const tool of tools) {
    for (const populated of [false, true]) {
      it(`${tool}: ${populated ? 'populated' : 'empty/default'} real portal, header, actions and fixture`, async () => {
        await seed(tool, populated)
        const view = mount(tool)
        if (tool === 'album' || tool === 'music') await waitFor(() => expect(screen.queryByText('正在读取媒体库…')).toBeNull())
        if (tool === 'laughter-collector') {
          expect(document.querySelector('.laughter-app')).not.toBeNull()
          await waitFor(() => expect(screen.queryByText('正在读取…')).toBeNull())
          expect(screen.getByRole('button', { name: '开始录制' })).toBeDisabled()
          if (populated) {
            expect(screen.getByText('测试：晚饭时的哈哈大笑')).toBeInTheDocument()
            expect(document.querySelector('.laughter-library audio')).toHaveAttribute('controls')
          }
        }
        if (tool === 'photo-organizer') {
          expect(document.querySelector('.photo-organizer')).not.toBeNull()
          expect(document.querySelector('.game2048')).toBeNull()
          await waitFor(() => expect(screen.queryByText('正在读取本机记录…')).toBeNull())
          if (populated) {
            expect(screen.getByRole('button', { name: '待删除 1' })).toBeEnabled()
            expect(screen.getByRole('button', { name: '已保留 1' })).toBeEnabled()
            expect(screen.getByText(/共 2 张照片/)).toBeInTheDocument()
            // The current renderer starts on its overview, not the review page.
            // Enter review through the real start button; no picker/mark/delete.
            fireEvent.click(screen.getByRole('button', { name: '从最新开始' }))
            const image = await screen.findByRole('img', { name: /^测试整理照片[12]\.png$/ })
            fireEvent.load(image)
            await waitFor(() => expect(screen.getByRole('button', { name: '保留' })).toBeEnabled())
            assertActionableButtonNames(tool, true)
            saveFixture(tool, 'review')
            fireEvent.click(screen.getByRole('button', { name: '返回整理首页' }))
            expect(document.querySelector('.organizer-page-overview')).not.toBeNull()
          } else expect(screen.getByText('选择相册，开始轻松整理')).toBeInTheDocument()
        }
        if (populated) populateTransient(tool)
        assertActionableButtonNames(tool, populated)
        if (tool === 'focus-timer') {
          expect(screen.queryByRole('button', { name: '暂停' })).toBeNull()
          expect(screen.getByRole('button', { name: '重置' })).toBeEnabled()
          expect(screen.getByRole('button', { name: '开始' })).toBeEnabled()
        }
        if (tool === 'game-2048') {
          expect(screen.getByText('分数 0')).toBeInTheDocument()
          expect(document.querySelectorAll('.grid2048 > div')).toHaveLength(16)
          if (populated) [2, 4, 8, 16].forEach(value => expect(document.querySelector(`.grid2048 [data-value="${value}"]`)).toHaveTextContent(String(value)))
        }
        if (tool === 'app-store' && populated) {
          expect(screen.getByRole('button', { name: `已安装 (${extensionApps.length})` })).toBeInTheDocument()
          expect(screen.getByRole('button', { name: '打开 吃什么' })).toBeInTheDocument()
        }
        saveFixture(tool, populated ? 'populated' : 'empty')
        if (tool === 'music' && document.querySelector('.music-page-player')) fireEvent.click(screen.getByRole('button', { name: '收起播放器' }))
        fireEvent.click(screen.getByRole('button', { name: tool === 'ledger' || tool === 'wardrobe' || tool === 'music' ? '返回 Aily' : '返回' }))
        expect(view.onClose).toHaveBeenCalledOnce()
        view.unmount()
        expect(document.querySelector('.desktop-tools-overlay')).toBeNull()
      })
    }
  }
})

describe('meaningful create/add workflows preserve existing test-only records', () => {
  it('ledger adds income and expense and remounts with correct totals', async () => {
    await seed('ledger', true)
    let view = mount('ledger')
    fireEvent.click(screen.getByRole('button', { name: '记下一笔' }))
    change('金额（元）', '25.50'); change('备注', '测试晚餐')
    fireEvent.click(screen.getByRole('button', { name: '添加记录' }))
    fireEvent.click(screen.getByRole('button', { name: '记下一笔' }))
    change('收支类型', 'income'); change('金额（元）', '100'); change('备注', '测试报销')
    fireEvent.click(screen.getByRole('button', { name: '添加记录' }))
    expect(screen.getByText('结余 ¥1312.20')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('aily-desktop-ledger')!)).toHaveLength(4)
    saveFixture('ledger', 'created')
    view.unmount(); view = mount('ledger')
    expect(screen.getByText('测试晚餐')).toBeInTheDocument()
    expect(screen.getByText('测试工资收入')).toBeInTheDocument()
  })
  it('contacts adds a manually entered contact and reloads without system access', async () => {
    await seed('contacts', true)
    const view = mount('contacts')
    change('姓名', '测试阿青'); change('电话', '13900000000'); change('邮箱', 'qing@example.invalid')
    fireEvent.click(screen.getByRole('button', { name: '添加联系人' }))
    expect(JSON.parse(localStorage.getItem('aily-desktop-contacts')!)).toHaveLength(2)
    expect(screen.getByLabelText('姓名')).toHaveValue('')
    saveFixture('contacts', 'created')
    view.unmount(); mount('contacts')
    expect(screen.getByText('测试小林')).toBeInTheDocument()
    expect(screen.getByText('qing@example.invalid')).toBeInTheDocument()
  })
  it('diary saves a dated entry while retaining previously seeded entries', async () => {
    await seed('diary', true)
    const view = mount('diary')
    change('日记日期', '2026-11-05'); change('日记内容', '测试日记：完成了期待的小事。')
    fireEvent.click(screen.getByRole('button', { name: '保存日记' }))
    expect(JSON.parse(localStorage.getItem('aily-desktop-diary')!)).toHaveLength(2)
    expect(screen.getByLabelText('日记内容')).toHaveValue('')
    saveFixture('diary', 'created')
    view.unmount(); mount('diary')
    expect(screen.getByText('测试日记：完成了期待的小事。')).toBeInTheDocument()
    expect(screen.getByText(/这是仅用于测试的日记/)).toBeInTheDocument()
  })
  it('skincare saves product/routine/condition/notes and preserves the prior entry', async () => {
    await seed('skincare-diary', true)
    const view = mount('skincare-diary')
    change('日期', '2026-11-05'); change('时段', '早'); change('产品与步骤', '  温和洁面 → 防晒  '); change('肌肤状态', '干燥'); change('备注', '测试：及时补涂')
    fireEvent.click(screen.getByRole('button', { name: '保存记录' }))
    expect(JSON.parse(localStorage.getItem('aily.ext.skincare')!)).toMatchObject([{ date: '2026-11-05', period: '早', products: '温和洁面 → 防晒', condition: '干燥', notes: '测试：及时补涂' }, { id: 'fixture-skin' }])
    expect(screen.getByLabelText('产品与步骤')).toHaveValue('')
    saveFixture('skincare-diary', 'created')
    view.unmount(); mount('skincare-diary')
    expect(screen.getByText('测试：及时补涂')).toBeInTheDocument()
  })
  it('wardrobe adds real clothes and generates one item from each available outfit category', async () => {
    const view = mount('wardrobe')
    expect(screen.getByRole('button', { name: '随机生成穿搭' })).toBeDisabled()
    fireEvent.click(screen.getAllByRole('button', { name: '添加衣物' })[0])
    change('衣物名称', '测试衬衫'); change('颜色', '白色')
    fireEvent.click(screen.getByRole('button', { name: '加入衣橱' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '添加衣物' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '添加衣物' }))
    change('衣物名称', '测试长裤'); change('分类', '下装'); change('颜色', '深蓝')
    fireEvent.click(screen.getByRole('button', { name: '加入衣橱' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '添加衣物' })).toBeNull())
    fireEvent.click(within(screen.getByRole('navigation', { name: '衣橱导航' })).getByRole('button', { name: '穿搭' }))
    fireEvent.click(screen.getByRole('button', { name: '随机生成穿搭' }))
    const outfit = screen.getByRole('region', { name: '当前搭配预览' })
    expect(within(outfit).getByRole('button', { name: '更换 测试衬衫' })).toBeInTheDocument()
    expect(within(outfit).getByRole('button', { name: '更换 测试长裤' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('aily.ext.wardrobe')!)).toHaveLength(2)
    saveFixture('wardrobe', 'created')
    view.unmount(); mount('wardrobe')
    expect(screen.getByText('测试衬衫')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '随机生成穿搭' })).toBeEnabled()
  })
  it('anniversary creates a one-off date, clears its name and persists alongside yearly dates', async () => {
    await seed('anniversary', true)
    const view = mount('anniversary')
    change('纪念日名称', '测试：书店见面')
    change('纪念日日期', '2027-06-01')
    fireEvent.click(screen.getByLabelText('每年重复'))
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    expect(JSON.parse(localStorage.getItem('aily.ext.anniversary')!)).toHaveLength(3)
    expect(JSON.parse(localStorage.getItem('aily.ext.anniversary')!)[2]).toMatchObject({ name: '测试：书店见面', date: '2027-06-01', yearly: false })
    expect(screen.getByPlaceholderText('纪念日名称')).toHaveValue('')
    saveFixture('anniversary', 'created')
    view.unmount(); mount('anniversary')
    expect(screen.getByText('测试：书店见面')).toBeInTheDocument()
  })
  it('meal uses the actual offline engine and shares its generated plan across all five steps', async () => {
    await seed('meal-planner', true)
    mount('meal-planner')
    const previousStorage = localStorage.getItem('aily.ext.meal.v1')
    fireEvent.click(screen.getByRole('button', { name: '家庭 / 偏好' }))
    saveFixture('meal-planner', 'family-settings')
    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '冰箱 / 参考价' }))
    saveFixture('meal-planner', 'pantry-settings')
    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }))
    populateTransient('meal-planner')
    const recipeNames = Array.from(document.querySelectorAll('.meal-card h3')).map(node => node.textContent!)
    saveFixture('meal-planner', 'generated')
    for (const [index, name] of ['买菜', '备菜', '炒菜', '谁洗碗'].entries()) {
      fireEvent.click(within(screen.getByRole('navigation', { name: '用餐步骤' })).getByRole('button', { name: `${index + 2}${name}` }))
      expect(screen.queryByText('先安排这一餐')).toBeNull()
      assertActionableButtonNames('meal-planner', true)
      saveFixture('meal-planner', ['shop', 'prep', 'cook', 'dishes'][index])
      if (name === '备菜' || name === '炒菜') recipeNames.forEach(title => expect(screen.getByText(name === '备菜' ? `${title} · 备菜细节` : title)).toBeInTheDocument())
    }
    // No purchase, consumption or wash-complete action is executed.
    expect(localStorage.getItem('aily.ext.meal.v1')).toBe(previousStorage)
  })
})

describe('real error, confirmation, viewer, player and timer state fixtures', () => {
  it.each([
    ['ledger', 'aily-desktop-ledger', '添加记录'],
    ['diary', 'aily-desktop-diary', '保存日记'],
    ['contacts', 'aily-desktop-contacts', '添加联系人'],
  ] as const)('%s: malformed test-only data displays read-error and blocks writes without overwriting', (tool, key, submitName) => {
    const malformed = '{invalid-test-fixture'
    localStorage.setItem(key, malformed)
    mount(tool)
    expect(screen.getByRole('alert')).toHaveTextContent('本地数据读取失败')
    if (tool === 'ledger') {
      fireEvent.click(within(screen.getByRole('navigation', { name: '手账导航' })).getByRole('button', { name: '我的' }))
      expect(screen.getByRole('button', { name: '导出 JSON' })).toBeDisabled()
      fireEvent.click(screen.getByRole('button', { name: '记下一笔' }))
    }
    const activeSurface = tool === 'ledger' ? within(screen.getByRole('dialog', { name: '记下一笔' })) : screen
    expect(activeSurface.getByRole('button', { name: submitName })).toBeDisabled()
    const fieldset = document.querySelector('form fieldset')
    expect(fieldset).toBeDisabled()
    expect(activeSurface.getByRole('button', { name: '重试读取' })).toBeEnabled()
    if (tool !== 'contacts') expect(screen.getByRole('button', { name: '导出 JSON' })).toBeDisabled()
    assertActionableButtonNames(tool, false)
    saveFixture(tool, 'read-error')
    expect(localStorage.getItem(key)).toBe(malformed)
  })

  it('app-store: opens wardrobe detail and pending uninstall, then cancels without removal', async () => {
    await seed('app-store', true)
    await seed('wardrobe', true)
    const installed = localStorage.getItem('aily.extension-apps.v1')
    const wardrobe = localStorage.getItem('aily.ext.wardrobe')
    mount('app-store')
    fireEvent.click(screen.getByRole('button', { name: '查看详情: 穿搭衣橱' }))
    expect(screen.getByRole('heading', { name: '穿搭衣橱', level: 3 })).toHaveFocus()
    expect(screen.getByRole('heading', { name: '关于此应用' })).toBeInTheDocument()
    assertActionableButtonNames('app-store', true)
    saveFixture('app-store', 'wardrobe-detail')
    fireEvent.click(screen.getByRole('button', { name: '卸载 穿搭衣橱' }))
    const confirmation = screen.getByRole('alertdialog', { name: '卸载 穿搭衣橱？' })
    expect(within(confirmation).getByRole('button', { name: '取消' })).toHaveFocus()
    expect(within(confirmation).getByRole('button', { name: '确认卸载' })).toBeEnabled()
    assertActionableButtonNames('app-store', true)
    saveFixture('app-store', 'pending-uninstall')
    expect(localStorage.getItem('aily.extension-apps.v1')).toBe(installed)
    expect(localStorage.getItem('aily.ext.wardrobe')).toBe(wardrobe)
    // Never click Confirm uninstall. The UI is safely reversible without a write.
    fireEvent.click(within(confirmation).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(localStorage.getItem('aily.extension-apps.v1')).toBe(installed)
    expect(localStorage.getItem('aily.ext.wardrobe')).toBe(wardrobe)
  })

  it('album: opens the actual photo viewer with labeled navigation and retains seeded media', async () => {
    await seed('album', true)
    const first = (await mediaDb.items.toArray())[0]
    await mediaDb.items.add({ ...first, id: 'fixture-album-second', name: '测试第二照片.png' })
    const before = await mediaDb.items.toArray()
    mount('album')
    await waitFor(() => expect(screen.queryByText('正在读取媒体库…')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '打开 测试旅行照片.png' }))
    const viewer = screen.getByRole('dialog', { name: '查看照片' })
    expect(within(viewer).getByRole('img', { name: '测试旅行照片.png' })).toHaveAttribute('src', imageURL)
    expect(within(viewer).getByRole('button', { name: '返回相册' })).toHaveFocus()
    expect(within(viewer).getByRole('button', { name: '上一张' })).toBeEnabled()
    expect(within(viewer).getByRole('button', { name: '下一张' })).toBeEnabled()
    assertActionableButtonNames('album', true)
    saveFixture('album', 'photo-viewer')
    fireEvent.click(within(viewer).getByRole('button', { name: '返回相册' }))
    expect(screen.queryByRole('dialog', { name: '查看照片' })).toBeNull()
    expect((await mediaDb.items.toArray()).map(item => ({ id: item.id, name: item.name, favorite: item.favorite }))).toEqual(before.map(item => ({ id: item.id, name: item.name, favorite: item.favorite })))
  })

  it('music: opens the real player with stubbed playback, repeats and closes without deleting media', async () => {
    await seed('music', true)
    const firstTrack = (await mediaDb.items.toArray())[0]
    await mediaDb.items.add({ ...firstTrack, id: 'fixture-music-second', name: '测试第二首.wav', favorite: false })
    mount('music')
    await waitFor(() => expect(screen.queryByText('正在读取媒体库…')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '打开 测试轻音乐.wav' }))
    const player = screen.getByRole('region', { name: '黑胶音乐播放器' })
    expect(player.querySelectorAll('audio')).toHaveLength(1)
    expect(within(player).getByRole('heading', { name: '测试轻音乐.wav' })).toBeInTheDocument()
    // Production runs its playback effect, but no physical media playback occurs.
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce()
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled()
    expect(within(player).getByRole('button', { name: '上一首' })).toBeEnabled()
    expect(within(player).getByRole('button', { name: '下一首' })).toBeEnabled()
    assertActionableButtonNames('music', true)
    saveFixture('music', 'music-player')
    fireEvent.click(within(player).getByRole('button', { name: '切换播放方式' }))
    expect(within(player).getByText('列表循环')).toBeInTheDocument()
    saveFixture('music', 'player-repeat')
    fireEvent.click(within(player).getByRole('button', { name: '收起播放器' }))
    expect(document.querySelector('.music-page-player')).toBeNull()
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    expect(await mediaDb.items.count()).toBe(2)
    expect(await mediaDb.items.get('fixture-music')).toMatchObject({ name: '测试轻音乐.wav', favorite: true })
  })

  it('laughter-collector: decodes locally into the real timeline, splits active clips and opens fine adjustment without playback or writes', async () => {
    await seed('laughter-collector', true)
    const original = await laughterDb.recordings.get('fixture-laughter')
    const samples = Float32Array.from({ length: 12500 }, (_, index) => Math.sin(index / 15) * (index % 300 < 200 ? .65 : .08))
    const buffer = { sampleRate: 1000, numberOfChannels: 1, length: samples.length, duration: 12.5, getChannelData: () => samples } as unknown as AudioBuffer
    const decodeAudioData = vi.fn(async (_bytes: ArrayBuffer) => buffer)
    const close = vi.fn(async () => {})
    // Only the browser decoding boundary is mocked. DesktopTools, collector,
    // decodeAudio validation/cleanup and LaughterTimelineEditor are all real.
    vi.stubGlobal('AudioContext', class {
      decodeAudioData = decodeAudioData
      close = close
    })
    mount('laughter-collector')
    await waitFor(() => expect(screen.queryByText('正在读取…')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '剪辑 测试：晚饭时的哈哈大笑' }))
    const editor = await screen.findByRole('region', { name: '笑声剪辑' })
    await waitFor(() => expect(within(editor).getByRole('button', { name: '关闭剪辑' })).toBeEnabled())
    expect(decodeAudioData).toHaveBeenCalledOnce()
    expect(decodeAudioData.mock.calls[0][0].byteLength).toBeGreaterThan(0)
    expect(close).toHaveBeenCalledOnce()
    expect(editor.querySelector('.laughter-timeline-editor')).not.toBeNull()
    expect(editor.querySelectorAll('.laughter-timeline-track svg line')).toHaveLength(160)
    expect(within(editor).getByRole('slider', { name: '左边裁剪手柄' })).toHaveAttribute('aria-valuenow', '0')
    expect(within(editor).getByRole('slider', { name: '右边裁剪手柄' })).toHaveAttribute('aria-valuenow', '12.5')
    expect(within(editor).getByRole('button', { name: /^片段 1/ })).toHaveAttribute('aria-pressed', 'true')
    assertActionableButtonNames('laughter-collector', true)
    saveFixture('laughter-collector', 'editor')

    // Use the production playhead and split controls; never play/delete/export.
    fireEvent.change(within(editor).getByLabelText('播放位置'), { target: { value: '6.25' } })
    expect(within(editor).getByRole('button', { name: '在这里切分' })).toBeEnabled()
    fireEvent.click(within(editor).getByRole('button', { name: '在这里切分' }))
    expect(editor.querySelectorAll('.laughter-timeline-clips button')).toHaveLength(2)
    fireEvent.click(within(editor).getByRole('button', { name: /^片段 2/ }))
    expect(within(editor).getByRole('button', { name: /^片段 2/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(editor).getByRole('slider', { name: '左边裁剪手柄' })).toHaveAttribute('aria-valuenow', '6.25')
    expect(editor.querySelector('.laughter-timeline-active')).toHaveAttribute('x', '320')
    expect(within(editor).getByRole('button', { name: '撤销' })).toBeEnabled()
    assertActionableButtonNames('laughter-collector', true)
    saveFixture('laughter-collector', 'editor-clips')

    fireEvent.click(within(editor).getByText('精细调整（可选）'))
    expect(editor.querySelector('.laughter-fine-adjust')).toHaveAttribute('open')
    expect(within(editor).getByLabelText('开始（秒）')).toBeEnabled()
    expect(within(editor).getByLabelText('结束（秒）')).toHaveValue(12.5)
    expect(editor.querySelectorAll('.laughter-segments li')).toHaveLength(2)
    assertActionableButtonNames('laughter-collector', true)
    saveFixture('laughter-collector', 'editor-fine-adjust')
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    expect(await laughterDb.recordings.count()).toBe(1)
    expect(await laughterDb.recordings.get('fixture-laughter')).toMatchObject({ id: original!.id, name: original!.name, duration: original!.duration })
    expect(Array.from(new Uint8Array(await (await laughterDb.recordings.get('fixture-laughter'))!.blob.arrayBuffer()))).toEqual(Array.from(new Uint8Array(await original!.blob.arrayBuffer())))
    fireEvent.click(within(editor).getByRole('button', { name: '关闭剪辑' }))
    expect(screen.queryByRole('region', { name: '笑声剪辑' })).toBeNull()
  })

  it('focus-timer: captures running and paused states and clears every interval on pause/unmount', () => {
    // Only this timer-specific scenario fakes timers; media scenarios use real timers.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-11-07T12:00:00.000Z'))
    const view = mount('focus-timer')
    expect(vi.getTimerCount()).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: '开始' }))
    expect(screen.getByRole('button', { name: '暂停' })).toBeEnabled()
    expect(vi.getTimerCount()).toBe(1)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByText('24:59')).toBeInTheDocument()
    assertActionableButtonNames('focus-timer', true)
    saveFixture('focus-timer', 'running')
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    expect(screen.getByRole('button', { name: '开始' })).toBeEnabled()
    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.getByText('24:59')).toBeInTheDocument()
    saveFixture('focus-timer', 'paused')
    fireEvent.click(screen.getByRole('button', { name: '开始' }))
    expect(vi.getTimerCount()).toBe(1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('targeted accessible icon/input label regressions', () => {
  it.each(['skincare-diary', 'wardrobe', 'anniversary'] as const)('%s: populated icon-only delete buttons have record-specific labels', async tool => {
    await seed(tool, true)
    mount(tool)
    if (tool === 'wardrobe') fireEvent.click(screen.getByRole('button', { name: '上衣 · 1' }))
    expect(unnamedButtons()).toHaveLength(0)
    const buttons = Array.from(document.querySelectorAll('.extension-item-list button, .wardrobe-item-actions button[aria-label^="移除衣物"], .anniversary-list button'))
    expect(buttons.length).toBeGreaterThan(0)
    buttons.forEach(button => expect(button.getAttribute('aria-label')).toMatch(/(删除护肤记录：|移除衣物：|删除纪念日：).+/))
    if (tool === 'anniversary') {
      expect(screen.getByLabelText('纪念日名称')).toBeInTheDocument()
      expect(screen.getByLabelText('纪念日日期')).toBeInTheDocument()
    }
  })
  it('2048 directional controls expose meaningful accessible names', async () => {
    await seed('game-2048', true)
    mount('game-2048')
    for (const direction of ['上', '左', '下', '右']) expect(screen.getByRole('button', { name: `向${direction}移动` })).toBeEnabled()
  })
})
