import { mediaDb } from './mediaLibrary'
import { decisionKey, type OrganizerPhoto } from './photoOrganizer'

export const PHOTO_DELETE_BATCH_SIZE = 500
export type DeleteResult = { deletedIds: string[]; cleanupFailed: boolean }
type NativeDelete = (options: { ids: string[] }) => Promise<{ deletedIds: string[] }>

/** Recheck confirmed targets against current decisions, never a stale grid alone. */
export async function deletePendingBatch(photos: OrganizerPhoto[], nativeDelete: NativeDelete): Promise<DeleteResult> {
  if (!photos.length) return { deletedIds: [], cleanupFailed: false }
  const source = photos[0].source
  if (photos.length > PHOTO_DELETE_BATCH_SIZE || photos.some(photo => photo.source !== source) || new Set(photos.map(photo => photo.id)).size !== photos.length) {
    throw new Error('删除目标无效，请重新选择。Invalid deletion targets; select again.')
  }
  const keys = photos.map(decisionKey), ids = photos.map(photo => photo.id)
  const verifyMarks = async () => {
    const marks = await mediaDb.photoDecisions.bulkGet(keys)
    if (marks.some(mark => mark?.status !== 'pending')) throw new Error('待删除标记已更改，本次未删除；请重新确认。Review decisions changed. Confirm again before deleting.')
  }
  if (source === 'library') {
    await mediaDb.transaction('rw', mediaDb.items, mediaDb.photoDecisions, async () => {
      await verifyMarks()
      const items = await mediaDb.items.bulkGet(ids)
      if (items.some(item => item?.kind !== 'album')) throw new Error('部分照片已移除，本次未删除；请重新读取列表。Some photos were removed. Reload the list.')
      await mediaDb.items.bulkDelete(ids)
      await mediaDb.photoDecisions.bulkDelete(keys)
    })
    return { deletedIds: ids, cleanupFailed: false }
  }
  // Do not hold an IndexedDB transaction across a system consent dialog.
  await mediaDb.transaction('r', mediaDb.photoDecisions, verifyMarks)
  const result = await nativeDelete({ ids })
  const allowed = new Set(ids)
  if (!Array.isArray(result.deletedIds) || result.deletedIds.some(id => typeof id !== 'string' || !allowed.has(id))) {
    throw new Error('系统删除结果无法核验，请重新读取相册后检查。Cannot verify deletion results; reload Photos to check.')
  }
  const deletedIds = [...new Set(result.deletedIds)]
  try { await mediaDb.photoDecisions.bulkDelete(deletedIds.map(id => `native:${id}`)) }
  catch { return { deletedIds, cleanupFailed: true } }
  return { deletedIds, cleanupFailed: false }
}
