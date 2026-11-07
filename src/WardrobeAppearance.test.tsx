import { mkdirSync, writeFileSync } from 'node:fs'
import { Blob as NodeBlob } from 'node:buffer'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import WardrobeApp from './WardrobeApp'
import { wardrobePhotoDb, WARDROBE_KEY } from './wardrobeData'
const folder = '.mobile-build/wardrobe-appearance'
const images: Record<string, string> = {
  '薄荷绿外套': `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="200" viewBox="0 0 180 200"><path fill="#b6d0c8" stroke="#76998d" stroke-width="2" d="M53 25 28 42 10 151 38 158 48 80 46 179 134 179 132 80 142 158 170 151 152 42 127 25 111 17H69Z"/><path fill="#dbe8e2" d="m69 17 21 67 21-67-21 14Z"/><path stroke="#76998d" fill="none" d="m69 17-16 39 25 10 12 28m21-77 16 39-25 10-12 28M90 87v90M51 130h28m22 0h28"/><circle cx="95" cy="112" r="2.5" fill="#698b7e"/><circle cx="95" cy="137" r="2.5" fill="#698b7e"/></svg>`,
  '浅紫长裤': `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="230" viewBox="0 0 180 230"><path fill="#cbc1da" stroke="#9c8eb5" stroke-width="2" d="M46 10h88l13 207h-51L90 78l-6 139H33Z"/><path stroke="#9c8eb5" fill="none" d="M46 23h88M90 11v60M47 27l17 13m69-13-17 13"/></svg>`,
  '日常平底鞋': `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="95" viewBox="0 0 180 95"><path fill="#a1ac73" stroke="#77824a" stroke-width="2" d="M18 32q15-15 33 2l12 22q15 4 18 16-35 17-65-2Z"/><path fill="#c0ca9c" d="M21 34q12-11 25 1l10 20-26 4Z"/><path fill="#a1ac73" stroke="#77824a" stroke-width="2" d="M100 28q15-15 33 2l12 22q15 4 18 16-35 17-65-2Z"/><path fill="#c0ca9c" d="M103 30q12-11 25 1l10 20-26 4Z"/></svg>`,
}
const save = (state: string) => {
  mkdirSync(folder, { recursive: true })
  const clone = document.body.cloneNode(true) as HTMLElement
  clone.querySelectorAll('img').forEach(image => { if (images[image.alt]) image.src = `data:image/svg+xml,${encodeURIComponent(images[image.alt])}` })
  writeFileSync(`${folder}/${state}.html`, `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>${clone.outerHTML}</html>`)
}
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('exports real empty/populated/category/profile/editor layouts with isolated illustration fixtures', async () => {
  localStorage.clear(); await wardrobePhotoDb.photos.clear(); vi.stubGlobal('Blob', NodeBlob)
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:wardrobe-fixture') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  const mount = () => render(<div className="desktop-tools-overlay"><section className="desktop-tools-dialog tools-surface wardrobe-shell"><div className="desktop-tools-content"><WardrobeApp locale="zh-CN" onClose={() => {}} /></div></section></div>)
  const empty = mount(); save('empty'); empty.unmount()
  const items = Object.keys(images).map((name, index) => ({ id: `test-${index}`, name, category: ['上装', '下装', '鞋子'][index], color: ['浅绿', '浅紫', '绿色'][index], season: '四季', photoId: `fixture-photo-${index}` }))
  localStorage.setItem(WARDROBE_KEY, JSON.stringify(items))
  localStorage.setItem('aily.ext.wardrobe.profile.v1', JSON.stringify([{ id: 'owner', name: '我的衣橱' }]))
  await wardrobePhotoDb.photos.bulkPut(items.map(item => ({ id: item.photoId, blob: new Blob(['illustration fixture'], { type: 'image/png' }) })))
  mount(); await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(3)); save('home')
  fireEvent.click(screen.getByRole('button', { name: '上衣 · 1' })); save('category')
  fireEvent.click(screen.getByRole('button', { name: '编辑衣物：薄荷绿外套' })); save('editor')
  fireEvent.click(screen.getByRole('button', { name: '关闭衣物编辑' }))
  fireEvent.click(within(screen.getByRole('navigation', { name: '衣橱导航' })).getByRole('button', { name: '分类' })); save('library')
  fireEvent.change(screen.getByLabelText('搜索衣物'), { target: { value: '浅紫' } }); save('search')
  fireEvent.click(screen.getByRole('button', { name: '衣橱设置' })); save('profile')
  expect(JSON.parse(localStorage.getItem(WARDROBE_KEY)!)).toEqual(items)
})
