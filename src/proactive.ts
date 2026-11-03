import type { CharacterId } from './data'

export const PROACTIVE_SETTINGS_KEY = 'aily.proactive.settings.v1'
export const PROACTIVE_LEDGER_PREFIX = 'aily.proactive.sent.v1:'
export const GENERIC_NOTIFICATION_BODY = '有一条本地提醒，请在应用内查看。'

export interface ProactiveConfig {
  enabled: boolean
  frequency: 'daily'
  schedule: string
  kind: 'greeting' | 'followup'
  dndEnabled: boolean
  dndStart: string
  dndEnd: string
  notifications: boolean
}

export const DEFAULT_PROACTIVE_CONFIG: Readonly<ProactiveConfig> = Object.freeze({
  enabled: false, frequency: 'daily', schedule: '09:00', kind: 'greeting',
  dndEnabled: true, dndStart: '22:00', dndEnd: '08:00', notifications: false,
})

export function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

/** Fail closed on malformed persisted settings; discard all unrecognized fields. */
export function validateProactiveConfig(value: unknown): ProactiveConfig {
  const defaults = { ...DEFAULT_PROACTIVE_CONFIG }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults
  const config = value as Record<string, unknown>
  if (typeof config.enabled !== 'boolean' || config.frequency !== 'daily'
    || !isClockTime(config.schedule) || (config.kind !== 'greeting' && config.kind !== 'followup')
    || typeof config.dndEnabled !== 'boolean' || !isClockTime(config.dndStart)
    || !isClockTime(config.dndEnd) || typeof config.notifications !== 'boolean') return defaults
  return {
    enabled: config.enabled, frequency: 'daily', schedule: config.schedule,
    kind: config.kind as ProactiveConfig['kind'], dndEnabled: config.dndEnabled,
    dndStart: config.dndStart, dndEnd: config.dndEnd, notifications: config.notifications,
  }
}

export function parseProactiveConfig(raw: string | null): ProactiveConfig {
  try { return validateProactiveConfig(raw ? JSON.parse(raw) : null) }
  catch { return { ...DEFAULT_PROACTIVE_CONFIG } }
}

export function localDateKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function localClockTime(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/** Start inclusive, end exclusive. Equal endpoints mean all-day DND. */
export function isWithinDnd(time: string, start: string, end: string): boolean {
  if (![time, start, end].every(isClockTime)) return true
  if (start === end) return true
  return start < end ? time >= start && time < end : time >= start || time < end
}

export function reminderLedgerKey(now: Date, characterId: CharacterId): string {
  return `${PROACTIVE_LEDGER_PREFIX}${localDateKey(now)}:${characterId}`
}

/** Only the exact local scheduled minute is eligible. No missed-reminder catch-up. */
export function isReminderDue(config: ProactiveConfig, now: Date, alreadySent: boolean, busy = false): boolean {
  if (!Number.isFinite(now.getTime()) || busy || alreadySent || !config.enabled) return false
  const time = localClockTime(now)
  return time === config.schedule && (!config.dndEnabled || !isWithinDnd(time, config.dndStart, config.dndEnd))
}

/** Fixed local templates: never quote, store, or send latestUserText to a service. */
export function createLocalReminder(kind: ProactiveConfig['kind'], latestUserText?: string): string {
  if (kind === 'followup') {
    return latestUserText?.trim()
      ? '【本地定时跟进 · 非 AI 生成】想继续之前的话题吗？也可以聊聊今天的新鲜事。'
      : '【本地定时跟进 · 非 AI 生成】今天有没有想聊的话题？随时开始，也可以忽略这条提醒。'
  }
  return '【本地定时问候 · 非 AI 生成】你好，愿你今天过得轻松。想聊天时，我在这里。'
}

export interface ReminderStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** Best-effort shared-tab ledger. Use Web Locks around this when supported.
 * Storage errors fail closed; a failed delivery still consumes today's slot to avoid bursts.
 */
export function claimReminder(storage: ReminderStorage, now: Date, characterId: CharacterId, token: string): boolean {
  const key = reminderLedgerKey(now, characterId)
  try {
    if (storage.getItem(key) !== null) return false
    storage.setItem(key, token)
    return storage.getItem(key) === token
  } catch { return false }
}
