import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PendingPhotoList from './PendingPhotoList'
import type { LibraryMedia } from './mediaLibrary'
import type { OrganizerPhoto } from './photoOrganizer'
vi.mock('./nativePhotoOrganizer', () => ({ getPhoto: vi.fn().mockResolvedValue({ url: 'data:image/jpeg;base64,AA==' }) }))
beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:thumb') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function mount(count = 14) {
  const photos: OrganizerPhoto[] = Array.from({ length: count }, (_, index) => ({ id: `${index}`, name: `Photo ${index}`, createdAt: '', source: 'library' }))
  const library: LibraryMedia[] = photos.map(photo => ({ ...photo, kind: 'album', blob: new Blob(['p'], { type: 'image/png' }), mime: 'image/png', addedAt: '', favorite: false, collection: '' }))
  const onDelete = vi.fn(), onKeep = vi.fn(), onOpen = vi.fn()
  render(<PendingPhotoList photos={photos} library={library} disabled={false} copy={zh => zh} onDelete={onDelete} onKeep={onKeep} onOpen={onOpen}/>)
  return { photos, onDelete, onKeep, onOpen }
}
describe('pending-photo contact sheet', () => {
  it('paginates thumbnails while Delete all targets the entire flagged list', () => {
    const { photos, onDelete } = mount()
    expect(screen.getAllByRole('button', { name: /^查看待删除照片/ })).toHaveLength(12)
    fireEvent.click(screen.getByRole('button', { name: '下一页待删除照片' }))
    expect(screen.getAllByRole('button', { name: /^查看待删除照片/ })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '一键删除全部（14）' }))
    expect(onDelete).toHaveBeenCalledExactlyOnceWith(photos)
  })
  it('passes only checked photos to selected deletion', () => {
    const { photos, onDelete } = mount(2)
    fireEvent.click(screen.getByRole('checkbox', { name: '选择待删除照片：Photo 1' }))
    fireEvent.click(screen.getByRole('button', { name: '删除所选（1）' }))
    expect(onDelete).toHaveBeenCalledExactlyOnceWith([photos[1]])
  })
  it('allows preview and keeping a photo without triggering deletion', () => {
    const { photos, onKeep, onOpen, onDelete } = mount(1)
    fireEvent.click(screen.getByRole('button', { name: '查看待删除照片：Photo 0' }))
    fireEvent.click(screen.getByRole('button', { name: '保留照片：Photo 0' }))
    expect(onOpen).toHaveBeenCalledWith(photos[0]); expect(onKeep).toHaveBeenCalledWith(photos[0])
    expect(onDelete).not.toHaveBeenCalled()
  })
})
