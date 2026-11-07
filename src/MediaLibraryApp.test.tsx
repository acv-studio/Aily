import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MediaLibraryApp from './MediaLibraryApp'
import { addLibraryMedia, mediaDb } from './mediaLibrary'
const copy = (zh: string) => zh
beforeEach(async () => {
  await mediaDb.delete(); await mediaDb.open()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:media-preview') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await mediaDb.delete() })
describe('media library browsing and management', () => {
  it('loads persistent photos, searches, favorites, and returns from the viewer', async () => {
    await addLibraryMedia('album', [{ name: 'sea.png', blob: new Blob(['photo'], { type: 'image/png' }) }])
    render(<MediaLibraryApp kind="album" copy={copy} />)
    const open = await screen.findByRole('button', { name: '打开 sea.png' })
    fireEvent.click(screen.getByRole('button', { name: '收藏 sea.png' }))
    await waitFor(async () => expect((await mediaDb.items.toArray())[0].favorite).toBe(true))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'none' } })
    expect(screen.queryByRole('button', { name: '打开 sea.png' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '打开 sea.png' }))
    expect(screen.getByRole('dialog', { name: '查看照片' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '返回相册' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('assigns selected media to a retained collection', async () => {
    await addLibraryMedia('album', [{ name: 'sea.png', blob: new Blob(['photo'], { type: 'image/png' }) }])
    render(<MediaLibraryApp kind="album" copy={copy} />)
    await screen.findByRole('button', { name: '打开 sea.png' })
    fireEvent.click(screen.getByRole('button', { name: '多选' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 sea.png' }))
    fireEvent.change(screen.getByLabelText('相簿名称'), { target: { value: '旅行' } })
    fireEvent.click(screen.getByRole('button', { name: '归入列表' }))
    await waitFor(async () => expect((await mediaDb.items.toArray())[0].collection).toBe('旅行'))
    expect(await screen.findByRole('button', { name: '旅行' })).toBeInTheDocument()
  })
  it('renames an imported photo without losing its stored content', async () => {
    await addLibraryMedia('album', [{ name: 'sea.png', blob: new Blob(['photo'], { type: 'image/png' }) }])
    render(<MediaLibraryApp kind="album" copy={copy} />)
    fireEvent.click(await screen.findByRole('button', { name: '重命名 sea.png' }))
    fireEvent.change(screen.getByLabelText('媒体名称'), { target: { value: '海边' } })
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }))
    expect(await screen.findByRole('button', { name: '打开 海边' })).toBeInTheDocument()
    expect((await mediaDb.items.toArray())[0]).toMatchObject({ name: '海边', mime: 'image/png' })
  })
  it('does not remove media when confirmation is canceled', async () => {
    await addLibraryMedia('album', [{ name: 'sea.png', blob: new Blob(['photo'], { type: 'image/png' }) }])
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<MediaLibraryApp kind="album" copy={copy} />)
    fireEvent.click(await screen.findByRole('button', { name: '移除 sea.png' }))
    expect(await mediaDb.items.count()).toBe(1)
  })
})
