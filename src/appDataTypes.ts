import type { CharacterId } from './data'

/** Versioned, read-only contract for trusted Aily mini-app adapters. No raw Blob/URL fields. */
export type AppDataValue = string | number | boolean | null
export type AppDataScope = { id: string; name: string; english: string; fields: string[]; sensitive: boolean; calendar?: { dateField: string; yearlyField?: string }; countLabel?: { zh: string; en: string } }
export type AppDataManifest = { id: string; name: string; english: string; availability: 'builtin' | 'installable'; schemaVersion: number; aliases?: string[]; dataBoundary?: { zh: string; en: string }; scopes: AppDataScope[] }
export type AppDataQuery = { text: string; search?: string; from?: string; to?: string; limit: number; operation?: 'list' | 'count' | 'recent' | 'upcoming'; today?: string }
export type AppDataResult = {
  status: 'ok' | 'empty' | 'unsupported' | 'unavailable' | 'invalid-data'
  records: { id: string; fields: Record<string, AppDataValue> }[]
  summary: Record<string, AppDataValue>
  /** Changes whenever any persisted source data changes, including deletions. */
  revision: string
  truncated: boolean
}
export type AppDataProvider = {
  manifest: AppDataManifest
  read: (scope: string, query: AppDataQuery, signal: AbortSignal) => Promise<AppDataResult>
}
export type AppDataSelection = { appId: string; scope: string }
export type AppDataIdentity = { role: CharacterId; primaryId: CharacterId; temporary: boolean; endpoint: string; model: string }
export type AppDataView = { appId: string; scope: string; name: string; english: string; readAt: string; result: AppDataResult }
export type AppDataPreview = { query: AppDataQuery; views: AppDataView[]; identity: AppDataIdentity }
/** Opaque capability; gateways accept only tickets they issued after explicit confirmation. */
export type AppDataTicket = { readonly token: string }
