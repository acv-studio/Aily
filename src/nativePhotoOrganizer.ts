import { Capacitor, registerPlugin } from '@capacitor/core'

export interface NativePhoto {
  /** Opaque platform asset identifier; never a path to upload. */
  id: string
  name: string
  createdAt: string
}

export interface PhotoOrganizerPlugin {
  /** Explicitly requests library access if needed, then lists accessible image metadata. */
  listPhotos(): Promise<{ photos: NativePhoto[]; limited: boolean }>
  /** Loads only this image as a bounded local JPEG data URL. Does not request permission. */
  getPhoto(options: { id: string }): Promise<{ url: string }>
  /** Deletes up to 500 images after native system confirmation. Never requests library access. */
  deletePhotos(options: { ids: string[] }): Promise<{ deletedIds: string[] }>
}

const nativePlugin = registerPlugin<PhotoOrganizerPlugin>('PhotoOrganizer')

export function isPhotoOrganizerAvailable(): boolean {
  return Capacitor.isNativePlatform() &&
    (Capacitor.getPlatform() === 'ios' || Capacitor.getPlatform() === 'android') &&
    Capacitor.isPluginAvailable('PhotoOrganizer')
}

function requireNativePlugin(): void {
  if (!isPhotoOrganizerAvailable()) {
    throw Object.assign(new Error('Photo organizing requires the native iOS or Android app with PhotoOrganizer installed.'), {
      code: 'UNAVAILABLE',
    })
  }
}

export async function listPhotos(): Promise<{ photos: NativePhoto[]; limited: boolean }> {
  requireNativePlugin()
  return nativePlugin.listPhotos()
}

export async function getPhoto(options: { id: string }): Promise<{ url: string }> {
  requireNativePlugin()
  if (!options || typeof options.id !== 'string' || !options.id.trim()) {
    throw Object.assign(new Error('A photo id is required.'), { code: 'INVALID_ID' })
  }
  return nativePlugin.getPhoto(options)
}

export const MAX_PHOTO_DELETE_BATCH = 500

export async function deletePhotos(options: { ids: string[] }): Promise<{ deletedIds: string[] }> {
  requireNativePlugin()
  if (!options || !Array.isArray(options.ids) || options.ids.some(id => typeof id !== 'string')) {
    throw Object.assign(new Error('Photo ids must be an array of strings.'), { code: 'INVALID_IDS' })
  }
  const ids = [...new Set(options.ids.map(id => id.trim()).filter(Boolean))]
  if (ids.length > MAX_PHOTO_DELETE_BATCH) {
    throw Object.assign(new Error(`Delete at most ${MAX_PHOTO_DELETE_BATCH} photos at once.`), { code: 'BATCH_TOO_LARGE' })
  }
  if (!ids.length) return { deletedIds: [] }
  const result = await nativePlugin.deletePhotos({ ids })
  // A partial/malformed reply must not cause callers to clear their pending batch.
  if (!result || !Array.isArray(result.deletedIds) || result.deletedIds.length !== ids.length ||
      new Set(result.deletedIds).size !== ids.length || result.deletedIds.some(id => !ids.includes(id))) {
    throw Object.assign(new Error('Native deletion did not confirm the entire requested batch.'), { code: 'DELETE_FAILED' })
  }
  return result
}

/** Guarded facade: no permission prompt or native work occurs on import. Deletion is explicit and system-confirmed. */
export const PhotoOrganizer: PhotoOrganizerPlugin = { listPhotos, getPhoto, deletePhotos }
