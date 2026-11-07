import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DesktopTools from './DesktopTools'
import { mediaDb } from './mediaLibrary'
import { getLocale, setLocale } from './i18n'

// Render the production portal and export its real DOM for offline responsive visual checks.
// Fixtures use synthetic test photos and fake-indexeddb; no device photos or user records are read.
vi.mock('./nativePhotoOrganizer', () => ({ isPhotoOrganizerAvailable: () => false, getPhoto: vi.fn(), listPhotos: vi.fn(), deletePhotos: vi.fn() }))
const previousLocale = getLocale()
const imageURL = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700" viewBox="0 0 1000 700"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#d5ddd5"/><stop offset="1" stop-color="#e9e5db"/></linearGradient><linearGradient id="lake" x2="0" y2="1"><stop stop-color="#b6c8bb"/><stop offset="1" stop-color="#718f82"/></linearGradient></defs><rect width="1000" height="700" fill="url(#sky)"/><path d="M0 340 190 155 365 325 605 125 850 340 1000 220V460H0Z" fill="#a5b5a6"/><path d="M0 390 255 250 460 360 735 205 1000 395V500H0Z" fill="#7f9887"/><rect y="430" width="1000" height="270" fill="url(#lake)"/><path d="M80 486H640M310 526H930M130 573H720M490 627H950" stroke="#e7ece1" stroke-width="4" opacity=".45"/><path d="M0 615 145 568 293 634 432 660 565 700H0Z" fill="#536f5a"/><path d="M88 700 132 354 141 60" stroke="#4b6654" stroke-width="24" fill="none"/><path d="M130 352 280 209 451 148M128 422 52 282M137 148 246 77" stroke="#4b6654" stroke-width="12" fill="none"/><circle cx="452" cy="148" r="21" fill="#6e9273"/><circle cx="250" cy="78" r="18" fill="#7c9e7e"/></svg>')}`
beforeEach(async () => {
  setLocale('zh-CN'); await mediaDb.delete(); await mediaDb.open()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => imageURL) })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})
afterEach(async () => { cleanup(); vi.restoreAllMocks(); setLocale(previousLocale); await mediaDb.delete() })
function save(name: string) {
  const dir = resolve(process.cwd(), '.mobile-build/photo-organizer-design'); mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, `${name}.html`), `<!doctype html><html lang="zh-CN" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>相册整理 · ${name}</title></head><body>${document.body.innerHTML}</body></html>`, 'utf8')
}
describe('reference-inspired photo organizer screens', () => {
  it('exports overview, review, pending list and settings from the real portal', async () => {
    await mediaDb.items.bulkPut([
      { id: 'visual-1', kind: 'album', name: '春日湖边 · 测试照片', blob: new Blob(['test'], { type: 'image/png' }), mime: 'image/png', addedAt: '2026-02-20T10:00:00.000Z', favorite: false, collection: '春日散步' },
      { id: 'visual-2', kind: 'album', name: '山间倒影 · 测试照片', blob: new Blob(['test'], { type: 'image/png' }), mime: 'image/png', addedAt: '2026-02-19T10:00:00.000Z', favorite: false, collection: '春日散步' },
      { id: 'visual-3', kind: 'album', name: '远山与树 · 测试照片', blob: new Blob(['test'], { type: 'image/png' }), mime: 'image/png', addedAt: '2026-02-18T10:00:00.000Z', favorite: false, collection: '春日散步' },
    ])
    await mediaDb.photoDecisions.bulkPut([{ id: 'library:visual-2', status: 'pending', updatedAt: '' }, { id: 'library:visual-3', status: 'keep', updatedAt: '' }])
    const onClose = vi.fn(); render(<DesktopTools tool="photo-organizer" onClose={onClose}/>)
    await screen.findByText(/共 3 张照片/)
    expect(document.querySelector('.desktop-tools-header')).toHaveAttribute('hidden')
    save('overview')
    fireEvent.click(screen.getByRole('button', { name: '从最新开始' }))
    const image = await screen.findByRole('img', { name: '春日湖边 · 测试照片' }); fireEvent.load(image)
    expect(screen.getByRole('button', { name: '待删除' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '保留' })).toBeEnabled()
    expect(document.querySelectorAll('.organizer-round-action')).toHaveLength(3)
    save('review')
    fireEvent.click(screen.getByRole('button', { name: '查看大图' }))
    expect(screen.getByRole('dialog', { name: '查看大图' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '查看大图' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '待删除 1' }))
    await screen.findByRole('button', { name: '查看待删除照片：山间倒影 · 测试照片' })
    save('pending')
    fireEvent.click(screen.getByRole('button', { name: '一键删除全部（1）' }))
    save('confirmation')
    fireEvent.keyDown(screen.getByRole('button', { name: '取消' }), { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(await mediaDb.items.count()).toBe(3)
    fireEvent.click(screen.getByRole('button', { name: '我的' }))
    await waitFor(() => expect(screen.getByText('只在本机，安心整理')).toBeInTheDocument())
    save('profile')
  })
})
