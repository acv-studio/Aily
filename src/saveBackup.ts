import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

export type BackupSaveResult = 'downloaded' | 'shared' | 'cancelled'

/** Receives only the encrypted envelope; encryption and backup filtering stay upstream. */
export async function saveEncryptedBackup(encryptedJson: string): Promise<BackupSaveResult> {
  const filename = `aily-backup-${new Date().toISOString().slice(0, 10)}.json`
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(new Blob([encryptedJson], { type: 'application/json' }))
    try {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
      return 'downloaded'
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  if (!(await Share.canShare()).value) throw new Error('此设备无法分享备份文件')
  // Cache is private app storage and is allowed by Android's default FileProvider.
  const path = `${crypto.randomUUID()}-${filename}`
  const { uri } = await Filesystem.writeFile({
    path, data: encryptedJson, directory: Directory.Cache, encoding: Encoding.UTF8,
  })
  try {
    await Share.share({ title: filename, files: [uri], dialogTitle: '导出加密备份' })
    // Fulfilled shares may have no activityType (e.g. iOS custom activities or
    // Android without a chosen-component callback). That is not cancellation.
    // Keep successful files in cache: Android recipients may read them after the
    // chooser closes. The OS can reclaim cache; never use persistent Documents.
    return 'shared'
  } catch (error) {
    await removeCachedBackup(path)
    if (typeof error === 'object' && error !== null && 'message' in error && error.message === 'Share canceled') return 'cancelled'
    throw error
  }
}

async function removeCachedBackup(path: string) {
  try { await Filesystem.deleteFile({ path, directory: Directory.Cache }) } catch { /* Preserve the share result/error. */ }
}
