import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  native: true, platform: 'ios', available: true,
  list: vi.fn(), get: vi.fn(), delete: vi.fn(), register: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mocks.native,
    getPlatform: () => mocks.platform,
    isPluginAvailable: () => mocks.available,
  },
  registerPlugin: mocks.register.mockReturnValue({ listPhotos: mocks.list, getPhoto: mocks.get, deletePhotos: mocks.delete }),
}))

beforeEach(() => {
  vi.resetModules()
  mocks.native = true
  mocks.platform = 'ios'
  mocks.available = true
  mocks.list.mockReset().mockResolvedValue({ photos: [], limited: false })
  mocks.get.mockReset().mockResolvedValue({ url: 'data:image/jpeg;base64,abc' })
  mocks.delete.mockReset().mockImplementation(async ({ ids }: { ids: string[] }) => ({ deletedIds: ids }))
  mocks.register.mockClear()
})

describe('native photo organizing facade', () => {
  it.each(['ios', 'android'])('deletes only explicit normalized batches on %s', async platform => {
    mocks.platform = platform
    const { PhotoOrganizer, deletePhotos } = await import('./nativePhotoOrganizer')
    expect(PhotoOrganizer.deletePhotos).toBe(deletePhotos)
    const input = { ids: [' 1 ', '2', '', '1', '   ', '2'] }
    expect(await deletePhotos(input)).toEqual({ deletedIds: ['1', '2'] })
    expect(mocks.delete).toHaveBeenCalledExactlyOnceWith({ ids: ['1', '2'] })
    expect(input.ids).toEqual([' 1 ', '2', '', '1', '   ', '2'])
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('treats an empty normalized batch as a no-op without native consent/access requests', async () => {
    const { deletePhotos } = await import('./nativePhotoOrganizer')
    expect(await deletePhotos({ ids: [] })).toEqual({ deletedIds: [] })
    expect(await deletePhotos({ ids: ['', '  '] })).toEqual({ deletedIds: [] })
    expect(mocks.delete).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('rejects malformed batches before calling native', async () => {
    const { deletePhotos } = await import('./nativePhotoOrganizer')
    for (const input of [undefined, null, {}, { ids: null }, { ids: '1' }, { ids: [1] }, { ids: ['1', null] }]) {
      await expect(deletePhotos(input as never)).rejects.toMatchObject({ code: 'INVALID_IDS' })
    }
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('bounds batches to 500 unique nonempty IDs consistently', async () => {
    const { deletePhotos, MAX_PHOTO_DELETE_BATCH } = await import('./nativePhotoOrganizer')
    expect(MAX_PHOTO_DELETE_BATCH).toBe(500)
    const ids = Array.from({ length: 500 }, (_, index) => String(index + 1))
    expect(await deletePhotos({ ids: [...ids, ...ids, ''] })).toEqual({ deletedIds: ids })
    mocks.delete.mockClear()
    await expect(deletePhotos({ ids: [...ids, '501'] })).rejects.toMatchObject({ code: 'BATCH_TOO_LARGE' })
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it.each(['CANCELLED', 'PERMISSION_DENIED', 'PHOTO_NOT_FOUND', 'UNSUPPORTED', 'DELETE_FAILED', 'DELETE_IN_PROGRESS'])(
    'preserves native %s without claiming deletion or requesting permission', async code => {
      const { deletePhotos } = await import('./nativePhotoOrganizer')
      const error = Object.assign(new Error(code), { code })
      mocks.delete.mockRejectedValue(error)
      await expect(deletePhotos({ ids: ['1'] })).rejects.toBe(error)
      expect(mocks.list).not.toHaveBeenCalled()
    },
  )

  it('only accepts confirmation of the exact complete batch', async () => {
    const { deletePhotos } = await import('./nativePhotoOrganizer')
    for (const result of [undefined, {}, { deletedIds: '1' }, { deletedIds: [] }, { deletedIds: ['1'] },
      { deletedIds: ['1', '1'] }, { deletedIds: ['1', '3'] }, { deletedIds: [1, 2] }]) {
      mocks.delete.mockResolvedValue(result)
      await expect(deletePhotos({ ids: ['1', '2'] })).rejects.toMatchObject({ code: 'DELETE_FAILED' })
    }
    mocks.delete.mockResolvedValue({ deletedIds: ['2', '1'] })
    expect(await deletePhotos({ ids: ['1', '2'] })).toEqual({ deletedIds: ['2', '1'] })
  })

  it('registers without requesting permission or loading any photos on import', async () => {
    await import('./nativePhotoOrganizer')
    expect(mocks.register).toHaveBeenCalledExactlyOnceWith('PhotoOrganizer')
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it.each(['ios', 'android'])('passes through metadata and lazy local images on %s', async platform => {
    mocks.platform = platform
    const result = { photos: [{ id: 'asset-1', name: 'IMG_1.JPG', createdAt: '2026-01-01T00:00:00Z' }], limited: true }
    mocks.list.mockResolvedValue(result)
    const { PhotoOrganizer, isPhotoOrganizerAvailable } = await import('./nativePhotoOrganizer')
    expect(isPhotoOrganizerAvailable()).toBe(true)
    expect(await PhotoOrganizer.listPhotos()).toEqual(result)
    expect(mocks.get).not.toHaveBeenCalled()
    expect(await PhotoOrganizer.getPhoto({ id: 'asset-1' })).toEqual({ url: 'data:image/jpeg;base64,abc' })
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith({ id: 'asset-1' })
    expect(Object.keys(PhotoOrganizer).sort()).toEqual(['deletePhotos', 'getPhoto', 'listPhotos'])
  })

  it.each(['web', 'missing-plugin', 'unsupported-platform'])('clearly rejects unavailable native access: %s', async scenario => {
    mocks.native = scenario !== 'web'
    mocks.available = scenario !== 'missing-plugin'
    mocks.platform = scenario === 'unsupported-platform' ? 'desktop' : 'ios'
    const { PhotoOrganizer, isPhotoOrganizerAvailable } = await import('./nativePhotoOrganizer')
    expect(isPhotoOrganizerAvailable()).toBe(false)
    await expect(PhotoOrganizer.listPhotos()).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    await expect(PhotoOrganizer.getPhoto({ id: '1' })).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    await expect(PhotoOrganizer.deletePhotos({ ids: ['1'] })).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('rejects invalid ids and preserves native denial/cancellation/load errors', async () => {
    const { PhotoOrganizer } = await import('./nativePhotoOrganizer')
    await expect(PhotoOrganizer.getPhoto({ id: '  ' })).rejects.toMatchObject({ code: 'INVALID_ID' })
    expect(mocks.get).not.toHaveBeenCalled()
    for (const code of ['PERMISSION_DENIED', 'CANCELLED', 'PHOTO_LOAD_FAILED']) {
      const error = Object.assign(new Error(code), { code })
      mocks.list.mockRejectedValue(error)
      mocks.get.mockRejectedValue(error)
      await expect(PhotoOrganizer.listPhotos()).rejects.toBe(error)
      await expect(PhotoOrganizer.getPhoto({ id: '1' })).rejects.toBe(error)
    }
  })
})
