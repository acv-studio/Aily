import { beforeEach, describe, expect, it } from 'vitest'
import { db, clearAllData, exportData, importData, saveSetting } from './db'
import { defaultSplashSettings, getCharacterActivity, loadSplashSettings, saveSplashSettings } from './characterPresence'
import { characters } from './data'

beforeEach(async () => { localStorage.clear(); await db.delete(); await db.open() })
describe('safe local character presence', () => {
  it('uses device-local time with distinct, bounded schedules for all characters', () => {
    for (const character of characters) {
      const scenes = [[6, 'morning'], [10, 'morning'], [11, 'day'], [16, 'day'], [17, 'evening'], [21, 'evening'], [22, 'night'], [0, 'night'], [5, 'night']] as const
      for (const [hour, scene] of scenes) expect(getCharacterActivity(character.id, new Date(2026, 10, 3, hour)).scene).toBe(scene)
      expect(new Set([8, 12, 19, 23].map(hour => getCharacterActivity(character.id, new Date(2026, 10, 3, hour)).status)).size).toBe(4)
    }
  })
  it('does not use time when personalization is off; invalid time falls back safely', () => {
    expect(getCharacterActivity('gu', new Date(2026, 10, 3, 8), false)).toEqual(getCharacterActivity('lu', new Date(2026, 10, 3, 23), false))
    expect(getCharacterActivity('chen', new Date(NaN)).status).toBe('在这里等你')
  })
  it('falls back to the existing selected role and rejects corrupt preferences', async () => {
    expect(await loadSplashSettings('chen')).toEqual(defaultSplashSettings('chen'))
    await saveSetting('__characterSplash', { primary: 'invalid', enabled: true })
    expect(await loadSplashSettings('gu')).toEqual(defaultSplashSettings('gu'))
    await expect(saveSplashSettings({ primary: 'invalid' } as never)).rejects.toThrow()
  })
  it('initializes primary once for upgraded users, independent from later selected conversations', async () => {
    expect((await loadSplashSettings('lu')).primary).toBe('lu')
    await saveSetting('selected', 'chen')
    expect((await loadSplashSettings('chen')).primary).toBe('lu')
  })
  it('persists primary independently from current conversation and does not delete data', async () => {
    await saveSetting('selected', 'lu')
    await db.messages.put({ characterId: 'lu', id: 1, from: 'user', text: '私密聊天', time: '12:00' })
    const settings = { ...defaultSplashSettings('gu'), enabled: false, staticScene: true, personalized: false }
    await saveSplashSettings(settings)
    expect(await loadSplashSettings('lu')).toEqual(settings)
    expect((await db.settings.get('selected'))?.value).toBe('lu')
    expect(await db.messages.count()).toBe(1)
  })
  it('keeps device preferences out of existing backups and resets on import or clear', async () => {
    await saveSplashSettings(defaultSplashSettings('gu'))
    const backup = await exportData()
    expect(backup).not.toContain('__characterSplash')
    await importData(backup)
    expect(await loadSplashSettings('chen')).toEqual(defaultSplashSettings('chen'))
    await saveSplashSettings(defaultSplashSettings('gu'))
    await clearAllData()
    expect(await loadSplashSettings('lu')).toEqual(defaultSplashSettings('lu'))
  })
})
