import { t } from './i18n'
import { clearAllData } from './db'
import { demoDb } from './giftDemo'

export const consentKey = 'aily-safety-consent-v1'
const usageLock = 'aily-privacy-usage-v1'

/** Every app tab holds a shared lease. Deletion is exclusive and never waits on another tab. */
export async function acquireUsageLease(): Promise<() => Promise<void>> {
  if (!navigator.locks) return async () => {} // Viewing works; deletion requires lock support.
  let release!: () => void
  let acquired!: () => void
  const ready = new Promise<void>(resolve => { acquired = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  const task = navigator.locks.request(usageLock, { mode: 'shared' }, async () => { acquired(); await held })
  await Promise.race([ready, task.then(() => { throw new Error(t('无法保护本机数据，请重新打开页面')) })])
  return async () => { release(); await task }
}

/** Caller must unmount the chat and release its own lease after draining writes. */
export async function deleteLocalProfile(): Promise<void> {
  if (!navigator.locks) throw new Error(t('当前浏览器不支持安全删除锁。请在支持 Web Locks 的浏览器中操作，或使用浏览器的站点数据清除功能。'))
  await navigator.locks.request(usageLock, { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (!lock) throw new Error(t('请关闭其他 Aily 标签页或窗口，再重试删除。尚未删除数据。'))
    // Separate databases cannot share a transaction. A failure is surfaced and retryable,
    // never reported as success. Clear credentials first even when later storage fails.
    for (const key of ['aily-api-key']) sessionStorage.removeItem(key)
    for (const key of [consentKey, 'aily-api-endpoint', 'aily-api-model', 'aily-demo-state', 'aily.locale', 'aily.chatLocale', 'aily-desktop-ledger', 'aily-desktop-contacts', 'aily-desktop-diary', 'aily.ext.meal.v1']) localStorage.removeItem(key)
    await clearAllData()
    await demoDb.transaction('rw', demoDb.wallet, demoDb.transactions, demoDb.storyEvents, async () => {
      await demoDb.wallet.clear()
      await demoDb.transactions.clear()
      await demoDb.storyEvents.clear()
    })
  })
}

export function hasSafetyConsent() {
  try { return localStorage.getItem(consentKey) === 'adult-ai-privacy-accepted' } catch { return false }
}
export function acceptSafetyConsent() {
  localStorage.setItem(consentKey, 'adult-ai-privacy-accepted')
}
