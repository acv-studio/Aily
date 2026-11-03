import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, ConfirmedMemory } from './chatService'
import type { CharacterId } from './data'
import { db, exportData, importData, loadRoleConversation, persistChatChanges, saveMemoryPolicy, saveSetting } from './db'
import { defaultProactiveSettings, deliverProactive, loadProactiveSettings, saveProactiveSettings, type ProactiveSettings } from './proactiveMessages'

const at = (day: number, hours: number, minutes = 0) => new Date(2026, 0, day, hours, minutes)
const hour = 60 * 60 * 1000
function settings(patch: Partial<ProactiveSettings> = {}): ProactiveSettings {
  return { ...defaultProactiveSettings, quietHours: { ...defaultProactiveSettings.quietHours }, triggers: { ...defaultProactiveSettings.triggers }, enabled: true, ...patch }
}
async function enable(patch: Partial<ProactiveSettings> = {}, role: CharacterId = 'lu') {
  await saveSetting('onboarded', true)
  await saveProactiveSettings(role, settings(patch))
}
async function memories(count: number, patch: Partial<ConfirmedMemory> = {}) {
  await db.memories.bulkPut(Array.from({ length: count }, (_, index) => ({ id: `${patch.characterId ?? 'lu'}-${index}`, characterId: 'lu' as const, text: `我喜欢读书${index}`, confirmedAt: at(1, 0).toISOString(), state: 'confirmed' as const, enabled: true, ...patch })))
}
async function weather(now: Date, condition: 'rainy' | 'sunny' | 'cold' = 'rainy', role: CharacterId = 'lu') {
  await saveProactiveSettings(role, { ...await loadProactiveSettings(role), weather: { condition, observedAt: now.toISOString() } })
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at(2, 8))
  await db.delete()
  await db.open()
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('local proactive message scheduler', () => {
  it('defaults off, returns independent defaults, and requires actual onboarding true', async () => {
    expect(await loadProactiveSettings('lu')).toEqual(defaultProactiveSettings)
    const first = await loadProactiveSettings('lu')
    first.triggers.time = false
    expect((await loadProactiveSettings('lu')).triggers.time).toBe(true)
    expect(await deliverProactive('lu', at(2, 8))).toBeUndefined()
    await saveProactiveSettings('lu', settings())
    expect(await deliverProactive('lu', at(2, 8))).toBeUndefined()
    await saveSetting('onboarded', 'true')
    expect(await deliverProactive('lu', at(2, 8))).toBeUndefined()
    await saveSetting('onboarded', true)
    expect(await deliverProactive('lu', at(2, 8))).toMatchObject({ from: 'character', status: 'sent', createdAt: at(2, 8).toISOString() })
  })

  it('validates saves, stored settings/state, roles and dates without silent fallback', async () => {
    for (const value of [settings({ frequency: 'other' as never }), settings({ quietHours: { enabled: true, start: -1, end: 480 } }), settings({ quietHours: { enabled: true, start: 1320, end: 1440 } }), settings({ weather: { condition: 'rainy', observedAt: 'yesterday' } }), { ...settings(), extra: true }, settings({ triggers: { time: 'yes' as never, weather: true, relationship: true } })]) {
      await expect(saveProactiveSettings('lu', value)).rejects.toThrow()
    }
    expect(await db.settings.get('__proactive:lu')).toBeUndefined()
    await db.settings.put({ key: '__proactive:lu', value: null })
    await expect(loadProactiveSettings('lu')).rejects.toThrow()
    await expect(deliverProactive('lu', at(2, 8))).rejects.toThrow()
    await expect(saveProactiveSettings('unknown' as CharacterId, settings())).rejects.toThrow()
    await expect(deliverProactive('chen', new Date(NaN))).rejects.toThrow()
    await expect(deliverProactive('chen', new Date(-1))).rejects.toThrow()
  })

  it('atomically dedupes simultaneous calls, appends above all IDs and survives reopen', async () => {
    await enable()
    const old: ChatMessage = { id: Date.now() + 10000, from: 'character', text: 'existing', time: '08:00' }
    await persistChatChanges('lu', [old])
    const results = await Promise.all(Array.from({ length: 10 }, () => deliverProactive('lu', at(2, 8))))
    const delivered = results.filter(Boolean)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]!.id).toBeGreaterThan(old.id)
    expect(delivered[0]!.id).toBeGreaterThan(Date.now())
    expect(delivered[0]!.text).toContain('【本机主动消息演示】')
    expect(await loadRoleConversation('lu')).toEqual([old, delivered[0]])
    // The chat's stale snapshot upserts cannot remove an appended proactive turn.
    await persistChatChanges('lu', [{ ...old, text: 'edited' }])
    expect(await loadRoleConversation('lu')).toHaveLength(2)
    db.close(); await db.open()
    expect(await deliverProactive('lu', at(2, 9))).toBeUndefined()
  })

  it('retains caps and dedupe across disable/re-enable and settings changes', async () => {
    await enable({ frequency: 'high' })
    expect(await deliverProactive('lu', at(2, 8))).toBeDefined()
    await saveProactiveSettings('lu', settings({ enabled: false, frequency: 'high' }))
    expect(await deliverProactive('lu', at(2, 18))).toBeUndefined()
    await saveProactiveSettings('lu', settings({ frequency: 'high' }))
    expect(await deliverProactive('lu', at(2, 10))).toBeUndefined()
    expect(await deliverProactive('lu', at(2, 18))).toBeDefined()
    expect(await deliverProactive('lu', at(2, 21))).toBeUndefined() // evening event already used
  })

  it.each([
    ['low', 1, 24], ['normal', 2, 6], ['high', 3, 3],
  ] as const)('enforces %s cap %i and cooldown %ih at exact boundaries', async (frequency, cap, cooldown) => {
    await enable({ frequency, quietHours: { enabled: false, start: 0, end: 0 }, triggers: { time: false, relationship: false, weather: true } })
    const start = at(2, 0)
    await weather(start)
    expect(await deliverProactive('lu', start)).toBeDefined()
    const before = new Date(start.getTime() + cooldown * hour - 1)
    await weather(before, 'sunny')
    expect(await deliverProactive('lu', before)).toBeUndefined()
    const boundary = new Date(start.getTime() + cooldown * hour)
    await weather(boundary, 'cold')
    const second = await deliverProactive('lu', boundary)
    // Low's 24h boundary is a new local day; other rates remain on same day.
    expect(second).toBeDefined()
    if (cap === 1) return
    let count = 2
    if (cap === 3) {
      const third = new Date(boundary.getTime() + cooldown * hour)
      await weather(third)
      expect(await deliverProactive('lu', third)).toBeDefined()
      count++
    }
    const capped = new Date(start.getTime() + count * cooldown * hour)
    await weather(capped, 'sunny')
    expect(await deliverProactive('lu', capped)).toBeUndefined()
    expect(await loadRoleConversation('lu')).toHaveLength(cap)
  })

  it('keeps cooldown across midnight and handles local day/month/year without UTC day resets', async () => {
    await enable({ frequency: 'normal', quietHours: { enabled: false, start: 0, end: 0 }, triggers: { time: false, relationship: false, weather: true } })
    const previous = new Date(2026, 11, 31, 23, 30)
    await weather(previous)
    expect(await deliverProactive('lu', previous)).toBeDefined()
    const midnight = new Date(2027, 0, 1, 0, 30)
    await weather(midnight, 'cold')
    expect(await deliverProactive('lu', midnight)).toBeUndefined()
    const boundary = new Date(2027, 0, 1, 5, 30)
    await weather(boundary, 'cold')
    expect(await deliverProactive('lu', boundary)).toBeDefined()
    // Backwards clocks cannot reset counters or bypass cooldown.
    expect(await deliverProactive('lu', at(1, 8))).toBeUndefined()
    const value = (await db.settings.get('__proactive:lu'))!.value as { state: { dailyCounts: Record<string, number> } }
    expect(value.state.dailyCounts).toEqual({ '2026-12-31': 1, '2027-01-01': 1 })
  })

  it.each([7, 11, 17, 22, 23])('does not invent a time trigger at hour %i', async hours => {
    await enable({ quietHours: { enabled: false, start: 0, end: 0 } })
    expect(await deliverProactive('lu', at(2, hours))).toBeUndefined()
  })

  it.each([8, 10, 18, 21])('delivers in the inclusive/exclusive time window at hour %i', async hours => {
    await enable()
    expect(await deliverProactive('lu', at(2, hours))).toBeDefined()
  })

  it.each([
    [1320, 480, 7, 59, true], [1320, 480, 8, 0, false], [1320, 480, 22, 0, true],
    [480, 600, 8, 0, true], [480, 600, 10, 0, false], [480, 480, 12, 0, true],
  ])('supports quiet range %i–%i at %i:%i (blocked=%s)', async (start, end, hours, minutes, blocked) => {
    const now = at(2, hours as number, minutes as number)
    await enable({ quietHours: { enabled: true, start: start as number, end: end as number }, weather: { condition: 'rainy', observedAt: now.toISOString() } })
    expect(Boolean(await deliverProactive('lu', now))).toBe(!blocked)
  })

  it('can turn off equal/full-day quiet hours and respects every trigger toggle', async () => {
    await enable({ quietHours: { enabled: false, start: 0, end: 0 }, triggers: { time: false, weather: false, relationship: false }, weather: { condition: 'rainy', observedAt: at(2, 8).toISOString() } })
    await memories(2)
    expect(await deliverProactive('lu', at(2, 8))).toBeUndefined()
    await saveProactiveSettings('lu', { ...await loadProactiveSettings('lu'), triggers: { time: true, weather: false, relationship: false } })
    expect((await deliverProactive('lu', at(2, 8)))?.text).toContain('早上好')
  })

  it('isolates settings, events, counts and personas by role', async () => {
    await enable({ frequency: 'high' }, 'lu')
    await enable({ frequency: 'normal' }, 'chen')
    expect((await loadProactiveSettings('gu')).enabled).toBe(false)
    const [lu, chen, gu] = await Promise.all(['lu', 'chen', 'gu'].map(role => deliverProactive(role as CharacterId, at(2, 8))))
    expect(lu?.text).toContain('早上好')
    expect(chen?.text).toContain('早啊')
    expect(gu).toBeUndefined()
    expect(await loadRoleConversation('lu')).toEqual([lu])
    expect(await loadRoleConversation('chen')).toEqual([chen])
  })

  it('does not interrupt any sending status including another role', async () => {
    await enable()
    await persistChatChanges('chen', [{ id: 1, from: 'character', text: 'pending', time: 'now', status: 'sending' }])
    expect(await deliverProactive('lu', at(2, 8))).toBeUndefined()
    await persistChatChanges('chen', [{ id: 1, from: 'character', text: 'failed', time: 'now', status: 'failed' }])
    expect(await deliverProactive('lu', at(2, 8))).toBeDefined()
  })

  it('suppresses recent user activity until exactly 30 minutes, using createdAt or timestamp IDs', async () => {
    await enable({ frequency: 'high' })
    await persistChatChanges('chen', [{ id: 5, from: 'user', text: 'hello', time: '08:00', createdAt: at(2, 8).toISOString() }])
    expect(await deliverProactive('lu', at(2, 8, 29))).toBeUndefined()
    expect(await deliverProactive('lu', at(2, 8, 30))).toBeDefined()
    await persistChatChanges('lu', [{ id: at(3, 8).getTime(), from: 'user', text: 'legacy', time: '08:00' }])
    expect(await deliverProactive('lu', at(3, 8, 29))).toBeUndefined()
    expect(await deliverProactive('lu', at(3, 8, 30))).toBeDefined()
  })

  it.each([[-1, false], [0, true], [6 * hour, true], [6 * hour + 1, false]])('uses only manual weather age %i ms (valid=%s)', async (age, valid) => {
    const now = at(2, 12)
    await enable({ triggers: { time: false, weather: true, relationship: false }, weather: { condition: 'rainy', observedAt: new Date(now.getTime() - age).toISOString() } })
    expect(Boolean(await deliverProactive('lu', now))).toBe(valid)
  })

  it('dedupes a weather observation across days, but accepts a new manual observation', async () => {
    await enable({ frequency: 'high', quietHours: { enabled: false, start: 0, end: 0 }, triggers: { time: false, weather: true, relationship: false } })
    await weather(at(2, 23))
    expect(await deliverProactive('lu', at(2, 23))).toBeDefined()
    expect(await deliverProactive('lu', at(3, 2))).toBeUndefined()
    await weather(at(3, 2))
    expect(await deliverProactive('lu', at(3, 2))).toBeDefined()
  })

  it('baselines stage on first enable, prioritizes weather then stage then time', async () => {
    await memories(2)
    await enable({ frequency: 'high' })
    const initial = await deliverProactive('lu', at(2, 12))
    expect(initial).toBeUndefined() // 熟悉 is initial, not a transition
    await memories(5)
    await weather(at(2, 8))
    expect((await deliverProactive('lu', at(2, 8)))?.text).toContain('下雨')
    expect((await deliverProactive('lu', at(2, 12)))?.text).toContain('相处有了新的变化')
    expect((await deliverProactive('lu', at(2, 18)))?.text).toContain('一天辛苦了')
  })

  it.each([
    { state: 'pending' as const }, { state: 'archived' as const }, { state: 'rejected' as const },
    { enabled: false }, { sensitive: true }, { text: '我的密码是秘密' },
    { expiresAt: at(2, 12).toISOString() }, { expiresAt: 'invalid' },
    { characterId: 'chen' as const }, { confirmedAt: at(3, 0).toISOString() },
  ])('excludes ineligible relationship memories %j', async patch => {
    await enable({ triggers: { time: false, weather: false, relationship: true } })
    await memories(5, patch)
    expect(await deliverProactive('lu', at(2, 12))).toBeUndefined()
    await memories(2)
    expect((await deliverProactive('lu', at(2, 12)))?.text).toContain('相处有了新的变化')
  })

  it('silently tracks removed/restored stages without repeating milestones or leaving a stale baseline', async () => {
    await enable({ frequency: 'high', triggers: { time: false, weather: false, relationship: true } })
    await memories(2)
    expect(await deliverProactive('lu', at(2, 12))).toBeDefined()
    await db.memories.clear()
    expect(await deliverProactive('lu', at(2, 15))).toBeUndefined()
    await memories(2)
    expect(await deliverProactive('lu', at(2, 15))).toBeUndefined()
    const restored = (await db.settings.get('__proactive:lu'))!.value as { state: { lastStage: string } }
    expect(restored.state.lastStage).toBe('熟悉')
    await memories(5)
    expect(await deliverProactive('lu', at(2, 15))).toBeDefined()
  })

  it('accepts legacy confirmed active memories and excludes disabled categories', async () => {
    await enable({ triggers: { time: false, weather: false, relationship: true } })
    await memories(2, { state: undefined, enabled: undefined, category: 'profile' })
    await saveMemoryPolicy('lu', { extractionEnabled: true, disabledCategories: ['profile'] })
    expect(await deliverProactive('lu', at(2, 12))).toBeUndefined()
    await saveMemoryPolicy('lu', { extractionEnabled: true, disabledCategories: [] })
    expect(await deliverProactive('lu', at(2, 12))).toBeDefined()
  })

  it('rolls back message, event and counter together when persistence fails', async () => {
    await enable()
    vi.spyOn(db.messages, 'add').mockRejectedValueOnce(new Error('write failed'))
    await expect(deliverProactive('lu', at(2, 8))).rejects.toThrow('write failed')
    expect(await loadRoleConversation('lu')).toEqual([])
    expect(await deliverProactive('lu', at(2, 8))).toBeDefined()
    expect(await loadRoleConversation('lu')).toHaveLength(1)
  })

  it('rolls back an already-added message when durable scheduler state cannot be written', async () => {
    await enable()
    const put = db.settings.put.bind(db.settings)
    const failure = vi.spyOn(db.settings, 'put').mockImplementation((...args) => {
      if (args[0].key === '__proactive:lu') throw new Error('state write failed')
      return put(...args)
    })
    await expect(deliverProactive('lu', at(2, 8))).rejects.toThrow('state write failed')
    failure.mockRestore()
    expect(await loadRoleConversation('lu')).toEqual([])
    expect(await deliverProactive('lu', at(2, 8))).toBeDefined()
  })

  it('excludes all proactive settings/state from backups and restores default-off', async () => {
    await enable({ weather: { condition: 'rainy', observedAt: at(2, 8).toISOString() } })
    expect(await deliverProactive('lu', at(2, 8))).toBeDefined()
    const raw = await exportData()
    expect(Object.keys(JSON.parse(raw).settings).some(key => key.startsWith('__proactive:'))).toBe(false)
    await importData(raw)
    expect(await loadProactiveSettings('lu')).toEqual(defaultProactiveSettings)
    expect(await deliverProactive('lu', at(3, 8))).toBeUndefined()
    expect(await loadRoleConversation('lu')).toHaveLength(1) // delivered chat is backed up
  })
})
