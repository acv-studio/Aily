import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DesktopTools from './DesktopTools'
import { mediaDb } from './mediaLibrary'
import { getLocale, setLocale } from './i18n'
const previousLocale = getLocale()
// Synthetic visual fixtures only; no actual device Photos or user library is read.
const image = (color: string, accent: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs><rect width="800" height="800" fill="url(#g)"/><circle cx="580" cy="190" r="96" fill="#fff" opacity=".32"/><path d="M0 580 260 270 440 520 610 360 800 600V800H0Z" fill="#194735" opacity=".7"/><path d="M0 660 260 560 510 690 800 600V800H0Z" fill="#142f29" opacity=".5"/><path d="M250 800V150M250 390 390 230M250 510 140 330" stroke="#e9e7ca" stroke-width="14" opacity=".55"/></svg>`)}`
beforeEach(async () => {
  setLocale('zh-CN'); await mediaDb.delete(); await mediaDb.open()
  let index = 0
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => index++ % 2 ? image('#a1bad1', '#487a91') : image('#d6dc92', '#78a960')) })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})
afterEach(async () => { cleanup(); vi.restoreAllMocks(); setLocale(previousLocale); await mediaDb.delete() })
function fixture(name: string) {
  const directory = resolve(process.cwd(), '.mobile-build/apple-album'); mkdirSync(directory, { recursive: true })
  const clone = document.body.cloneNode(true) as HTMLBodyElement
  const originals = document.body.querySelectorAll('input'), copies = clone.querySelectorAll('input')
  originals.forEach((input, index) => { copies[index].setAttribute('value', input.value); if (input.checked) copies[index].setAttribute('checked', '') })
  writeFileSync(resolve(directory, `${name}.html`), `<!doctype html><html lang="zh-CN" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Apple-like album · ${name}</title></head>${clone.outerHTML}</html>`, 'utf8')
}
describe('Apple-inspired album visual fixtures', () => {
  it('exports the real gallery, action sheet, rename form and viewer without modifying media', async () => {
    await mediaDb.items.bulkPut(['林间光影', '湖边倒影', '午后的风', '山间远眺', '慢慢走', '浅蓝天空'].map((name, index) => ({ id: `visual-${index}`, kind: 'album' as const, name, mime: 'image/png', blob: new Blob(['visual test only'], { type: 'image/png' }), addedAt: `2026-11-0${7 - index}T10:00:00.000Z`, favorite: index === 1, collection: '' })))
    render(<DesktopTools tool="album" onClose={vi.fn()}/>)
    await screen.findByRole('button', { name: '打开 林间光影' })
    expect(document.querySelector('.album-shell .apple-album-library')).not.toBeNull()
    expect(document.querySelector('.media-photo-grid .media-item-actions')).toBeNull()
    fixture('gallery')
    fireEvent.click(screen.getByRole('button', { name: '照片操作 林间光影' }))
    expect(screen.getByRole('dialog', { name: '照片操作' })).toBeInTheDocument(); fixture('actions')
    fireEvent.click(screen.getByRole('button', { name: '重命名 林间光影' }))
    expect(screen.getByRole('dialog', { name: '重命名照片' })).toBeInTheDocument(); fixture('rename')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '打开 林间光影' }))
    expect(screen.getByRole('dialog', { name: '查看照片' })).toBeInTheDocument(); fixture('viewer')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '查看照片' })).toBeNull())
    expect(await mediaDb.items.count()).toBe(6)
    expect((await mediaDb.items.get('visual-0'))?.name).toBe('林间光影')
  })
})
