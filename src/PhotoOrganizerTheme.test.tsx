import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import PhotoOrganizerApp from './PhotoOrganizerApp'
import { addLibraryMedia, mediaDb } from './mediaLibrary'
import { setThemePreference } from './theme'
vi.mock('./nativePhotoOrganizer', () => ({ isPhotoOrganizerAvailable: () => false, listPhotos: vi.fn(), getPhoto: vi.fn(), deletePhotos: vi.fn() }))
const directory = resolve('.mobile-build/photo-appearance')
function fixture(state: string) {
  mkdirSync(directory, { recursive: true })
  const body = document.body.cloneNode(true) as HTMLElement
  body.querySelectorAll('img').forEach(image => { image.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=' })
  writeFileSync(resolve(directory, `${state}.html`), `<!doctype html><html data-theme="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>${body.outerHTML}</html>`)
}
afterEach(async () => { cleanup(); await mediaDb.delete(); vi.restoreAllMocks() })
it('captures real light-theme overview, review, profile, pending, confirmation and viewer states', async () => {
  await mediaDb.delete(); await mediaDb.open(); setThemePreference('light')
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:photo-theme') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  await addLibraryMedia('album', ['A.png', 'B.png', 'C.png'].map(name => ({ name, blob: new Blob(['photo'], { type: 'image/png' }) })))
  const rows = await mediaDb.items.toArray()
  await mediaDb.photoDecisions.put({ id: `library:${rows[0].id}`, status: 'pending', updatedAt: new Date().toISOString() })
  // Use the production shell classes without loading unrelated mini-app modules.
  render(<div className="desktop-tools-overlay"><section className="desktop-tools-dialog tools-surface photo-organizer-shell"><div className="desktop-tools-content"><PhotoOrganizerApp locale="zh-CN" /></div></section></div>)
  await waitFor(() => expect(screen.getByRole('button', { name: '从最新开始' })).toBeEnabled())
  fixture('overview')
  fireEvent.click(screen.getByRole('button', { name: '整理设置' })); fixture('profile')
  fireEvent.click(screen.getByRole('button', { name: '返回' }))
  fireEvent.click(screen.getByRole('button', { name: '从最新开始' }))
  const photo = await screen.findByRole('img'); fireEvent.load(photo)
  await waitFor(() => expect(screen.getByRole('button', { name: '保留' })).toBeEnabled())
  fixture('review')
  fireEvent.click(screen.getByRole('button', { name: '查看大图' })); fixture('expanded')
  fireEvent.click(screen.getByRole('button', { name: '收起大图' }))
  fireEvent.click(screen.getByRole('button', { name: '待删除 1' }))
  await screen.findByRole('button', { name: '一键删除全部（1）' }); fixture('pending')
  fireEvent.click(screen.getByRole('button', { name: '一键删除全部（1）' }))
  expect(screen.getByRole('alertdialog')).toBeInTheDocument(); fixture('confirm')
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  const marks = await mediaDb.photoDecisions.toArray()
  expect(marks).toHaveLength(1)
})
