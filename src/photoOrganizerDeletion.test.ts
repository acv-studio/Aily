import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mediaDb, addLibraryMedia } from './mediaLibrary'
import { deletePendingBatch } from './photoOrganizerDeletion'
import { decisionKey, type OrganizerPhoto } from './photoOrganizer'
const nativePhoto: OrganizerPhoto = { id: 'n1', name: 'Native photo', createdAt: '', source: 'native' }
beforeEach(async () => { await mediaDb.delete(); await mediaDb.open() })
afterEach(async () => { vi.restoreAllMocks(); await mediaDb.delete() })
async function pending(photo: OrganizerPhoto) { await mediaDb.photoDecisions.put({ id: decisionKey(photo), status: 'pending', updatedAt: '' }) }
async function libraryPhoto(): Promise<OrganizerPhoto> {
  await addLibraryMedia('album', [{ name: 'a.png', blob: new Blob(['test'], { type: 'image/png' }) }])
  const item = (await mediaDb.items.toArray())[0]
  return { id: item.id, name: item.name, createdAt: '', source: 'library' }
}
describe('confirmed pending-only deletion', () => {
  it('deletes an imported copy and its decision in one transaction', async () => {
    const photo = await libraryPhoto(); await pending(photo); const nativeDelete = vi.fn()
    expect(await deletePendingBatch([photo], nativeDelete)).toEqual({ deletedIds: [photo.id], cleanupFailed: false })
    expect(await mediaDb.items.count()).toBe(0); expect(await mediaDb.photoDecisions.count()).toBe(0)
    expect(nativeDelete).not.toHaveBeenCalled()
  })
  it('rolls back imported-copy deletion if decision cleanup fails', async () => {
    const photo = await libraryPhoto(); await pending(photo)
    vi.spyOn(mediaDb.photoDecisions, 'bulkDelete').mockRejectedValueOnce(new Error('disk failure'))
    await expect(deletePendingBatch([photo], vi.fn())).rejects.toThrow('disk failure')
    expect(await mediaDb.items.count()).toBe(1); expect(await mediaDb.photoDecisions.count()).toBe(1)
  })
  it('refuses retained or newly unflagged photos before calling the native delete API', async () => {
    await mediaDb.photoDecisions.put({ id: decisionKey(nativePhoto), status: 'keep', updatedAt: '' })
    const nativeDelete = vi.fn()
    await expect(deletePendingBatch([nativePhoto], nativeDelete)).rejects.toThrow('标记已更改')
    expect(nativeDelete).not.toHaveBeenCalled()
  })
  it('preserves pending decisions when the system confirmation is cancelled', async () => {
    await pending(nativePhoto)
    const failure = Object.assign(new Error('cancelled'), { code: 'CANCELLED' })
    await expect(deletePendingBatch([nativePhoto], vi.fn().mockRejectedValue(failure))).rejects.toBe(failure)
    expect(await mediaDb.photoDecisions.get(decisionKey(nativePhoto))).toMatchObject({ status: 'pending' })
  })
  it('cleans up only verified returned native ids, never unrelated decisions', async () => {
    await pending(nativePhoto); await pending({ ...nativePhoto, id: 'n2' })
    const nativeDelete = vi.fn().mockResolvedValue({ deletedIds: ['n1'] })
    expect(await deletePendingBatch([nativePhoto], nativeDelete)).toEqual({ deletedIds: ['n1'], cleanupFailed: false })
    expect(nativeDelete).toHaveBeenCalledExactlyOnceWith({ ids: ['n1'] })
    expect(await mediaDb.photoDecisions.get('native:n2')).toMatchObject({ status: 'pending' })
  })
  it('reports cleanup failure without concealing completed native deletion', async () => {
    await pending(nativePhoto)
    vi.spyOn(mediaDb.photoDecisions, 'bulkDelete').mockRejectedValueOnce(new Error('disk failure'))
    expect(await deletePendingBatch([nativePhoto], vi.fn().mockResolvedValue({ deletedIds: ['n1'] }))).toEqual({ deletedIds: ['n1'], cleanupFailed: true })
  })
  it('rejects malformed responses and mixed or duplicate targets', async () => {
    await pending(nativePhoto)
    await expect(deletePendingBatch([nativePhoto], vi.fn().mockResolvedValue({ deletedIds: ['other'] }))).rejects.toThrow('无法核验')
    await expect(deletePendingBatch([nativePhoto, nativePhoto], vi.fn())).rejects.toThrow('目标无效')
    const local = await libraryPhoto()
    await expect(deletePendingBatch([nativePhoto, local], vi.fn())).rejects.toThrow('目标无效')
    expect(await mediaDb.photoDecisions.count()).toBe(1)
  })
})
