import Dexie, { type Table } from 'dexie'

export type LaughterRecording = { id: string; person: string; name: string; createdAt: string; duration: number; blob: Blob; sourceId?: string }
class LaughterDatabase extends Dexie {
  recordings!: Table<LaughterRecording, string>
  constructor() { super('aily-laughter-v1'); this.version(1).stores({ recordings: 'id,person,createdAt' }) }
}
export const laughterDb = new LaughterDatabase()
export const MAX_LAUGHTER_BYTES = 20 * 1024 * 1024
export async function saveLaughter(record: LaughterRecording) {
  if (!record.person.trim() || !record.blob.size || record.blob.size > MAX_LAUGHTER_BYTES || !Number.isFinite(record.duration) || record.duration <= 0) throw new Error('Invalid recording')
  await laughterDb.transaction('rw', laughterDb.recordings, async () => {
    const records = await laughterDb.recordings.toArray()
    if (records.reduce((total, item) => total + item.blob.size, 0) + record.blob.size > 200 * 1024 * 1024) throw new Error('Local library full')
    await laughterDb.recordings.add(record)
  })
}
export async function clearLaughterLibrary() { await laughterDb.recordings.clear() }
