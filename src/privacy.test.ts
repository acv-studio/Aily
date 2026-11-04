import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { deleteLocalProfile, consentKey, acceptSafetyConsent, hasSafetyConsent } from './privacy'
import { db, initializeLocalData, saveConversation, saveSetting } from './db'
import { completeDemoStoryEvent, demoDb, rechargeDemo, sendDemoGift } from './giftDemo'

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear()
  await db.delete(); await db.open(); await demoDb.delete(); await demoDb.open()
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, work: (lock: object) => Promise<void>) => work({}) } })
})
afterEach(() => vi.unstubAllGlobals())
it('removes both databases and only Aily preferences, without resurrecting legacy data', async () => {
  await saveConversation('lu', [{ id: 1, from: 'user', text: 'private', time: 'now' }])
  await saveSetting('onboarded', true)
  await rechargeDemo('demo-100')
  await sendDemoGift('concert-ticket', 'lu', 1)
  await completeDemoStoryEvent('lu', 'concert', 'listen')
  expect(await demoDb.storyEvents.count()).toBe(1)
  acceptSafetyConsent(); expect(hasSafetyConsent()).toBe(true)
  localStorage.setItem('aily-demo-state', '{}'); localStorage.setItem('aily-api-model', 'custom')
  localStorage.setItem('unrelated', 'keep'); sessionStorage.setItem('aily-api-key', 'secret')
  localStorage.setItem('aily.locale', 'en'); localStorage.setItem('aily.chatLocale', 'zh-CN')
  const desktopKeys = ['aily-desktop-ledger', 'aily-desktop-contacts', 'aily-desktop-diary']
  desktopKeys.forEach(key => localStorage.setItem(key, '[{"private":"data"}]'))
  await deleteLocalProfile()
  desktopKeys.forEach(key => expect(localStorage.getItem(key)).toBeNull())
  expect(await db.messages.count()).toBe(0); expect(await db.memories.count()).toBe(0)
  expect(await db.summaries.count()).toBe(0); expect(await demoDb.wallet.count()).toBe(0)
  expect(await demoDb.transactions.count()).toBe(0)
  expect(await demoDb.storyEvents.count()).toBe(0)
  expect(localStorage.getItem(consentKey)).toBeNull(); expect(sessionStorage.getItem('aily-api-key')).toBeNull()
  expect(localStorage.getItem('unrelated')).toBe('keep')
  expect(localStorage.getItem('aily.locale')).toBeNull(); expect(localStorage.getItem('aily.chatLocale')).toBeNull()
  expect((await initializeLocalData()).settings.onboarded).toBeUndefined()
})
it('refuses deletion while another tab holds its lease, without touching data', async () => {
  await saveSetting('onboarded', true)
  vi.stubGlobal('navigator', { locks: { request: async (_n: string, _o: unknown, work: (lock: null) => Promise<void>) => work(null) } })
  await expect(deleteLocalProfile()).rejects.toThrow('关闭其他 Aily')
  expect((await db.settings.get('onboarded'))?.value).toBe(true)
})
it('does not report success if any database deletion fails', async () => {
  const failure = vi.spyOn(demoDb.wallet, 'clear').mockRejectedValueOnce(new Error('storage failure'))
  await expect(deleteLocalProfile()).rejects.toThrow('storage failure')
  failure.mockRestore()
  await expect(deleteLocalProfile()).resolves.toBeUndefined()
})
it('fails explicitly without safe deletion lock support', async () => {
  vi.stubGlobal('navigator', {})
  await expect(deleteLocalProfile()).rejects.toThrow('不支持安全删除锁')
})
