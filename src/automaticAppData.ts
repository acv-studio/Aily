import type { AppDataIdentity, AppDataTicket } from './appDataTypes'
import { automaticAppDataPlan } from './appDataLocalQuery'
import { listAppDataManifests, listRegisteredAppDataManifests, readAutomaticAppData } from './appDataGateway'
import { initializeAppDataProviders } from './appDataProviders'
import { assessUserInput } from './safety'
import { extensionApps } from './extensionApps'

/** Main-Bot queries need no per-App permission UI. Never reads API keys, raw files
 * or arbitrary storage keys; only registered installed read-only adapter fields.
 */
export async function automaticAppDataTicket(text: string, identity: AppDataIdentity, signal: AbortSignal, previousQuestion = ''): Promise<AppDataTicket | undefined> {
  signal.throwIfAborted()
  if (identity.temporary || identity.role !== identity.primaryId || assessUserInput(text)) return undefined
  initializeAppDataProviders()
  const registered = listRegisteredAppDataManifests()
  const candidates = [...registered, ...extensionApps.filter(app => !registered.some(item => item.id === app.id)).map(app => ({ id: app.id, name: app.name, english: app.english, availability: 'installable' as const, schemaVersion: 1, scopes: [] }))]
  const plan = automaticAppDataPlan(text, candidates, previousQuestion)
  const available = new Set(listAppDataManifests().map(app => app.id))
  const selections = plan.selections.filter(selection => available.has(selection.appId))
  if (!selections.length) return undefined
  return readAutomaticAppData(selections, plan.query, identity, signal, text)
}
