import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllData, db, exportData, importData, loadLocalData } from './db'
import { setLocale } from './i18n'
import { addReminder, evaluateReminders, loadReminderState, proposeNextSteps, saveReminderContext, saveReminderQuietHours, updateReminder } from './smartReminders'
import type { ReminderContext, ReminderKind, ReminderState } from './smartReminders'

const key = '__smartReminders:v1'
const minute = 60_000
const now = new Date('2025-02-01T12:00:00.000Z')
const at = (minutes: number) => new Date(now.getTime() + minutes * minute)
const context: ReminderContext = { temperature: 5, weatherObservedAt: now.toISOString(), mood: 'low', moodObservedAt: now.toISOString() }
function input(kind: ReminderKind = 'water', patch: Partial<Parameters<typeof addReminder>[0]> = {}): Parameters<typeof addReminder>[0] {
  return { title: `提醒 ${kind}`, kind, enabled: true, scheduledAt: ['weather', 'mood'].includes(kind) ? null : at(10).toISOString(), repeatMinutes: null, temperatureBelow: kind === 'weather' ? 10 : null, station: kind === 'metro' ? '用户指定车站' : '', exit: kind === 'metro' ? '用户指定出口' : '', leadMinutes: kind === 'metro' ? 5 : 0, ...patch }
}
async function unquiet() { await saveReminderQuietHours({ enabled: false, start: 1320, end: 480 }) }
async function inject(change: (state: ReminderState) => void) {
  const state = await loadReminderState(); change(state)
  await db.settings.put({ key, value: state })
}
beforeEach(async () => {
  vi.restoreAllMocks(); setLocale('zh-CN')
  await db.delete(); await db.open()
})
afterEach(() => { vi.restoreAllMocks(); setLocale('zh-CN') })

describe('local smart reminder state and transactions', () => {
  it('starts empty without seeding or writing on load/evaluation', async () => {
    expect(await loadReminderState()).toEqual({ reminders: [], context: { temperature: null, weatherObservedAt: null, mood: 'unknown', moodObservedAt: null }, quietHours: { enabled: true, start: 1320, end: 480 } })
    expect(await evaluateReminders(now)).toEqual([])
    expect(await db.settings.get(key)).toBeUndefined()
  })
  it('persists normalized input, context and quiet hours across reopening with detached reads', async () => {
    const reminder = await addReminder(input('water', { title: ' 喝水 ', scheduledAt: '2025-02-01T20:10:00+08:00' }), now)
    expect(reminder).toMatchObject({ title: '喝水', scheduledAt: at(10).toISOString(), createdAt: now.toISOString(), status: 'pending', deliveredAt: null, snoozedUntil: null })
    await saveReminderContext(context); await unquiet()
    const state = await loadReminderState()
    db.close(); await db.open()
    expect(await loadReminderState()).toEqual(state)
    state.reminders[0].title = 'changed'; state.context.temperature = -99
    expect((await loadReminderState()).reminders[0].title).toBe('喝水')
    expect((await loadReminderState()).context.temperature).toBe(5)
  })
  it('excludes all internal data from local/backups and clear/import resets without seeding', async () => {
    await addReminder(input(), now); await saveReminderContext(context)
    expect((await loadLocalData()).settings).not.toHaveProperty(key)
    const backup = await exportData(); expect(backup).not.toContain(key)
    await importData(backup)
    expect((await loadReminderState()).reminders).toEqual([])
    await addReminder(input(), now); await clearAllData()
    expect(await db.settings.get(key)).toBeUndefined()
    expect((await loadReminderState()).context.temperature).toBeNull()
  })
  it('serializes concurrent additions, settings updates, toggles and deletes without lost writes', async () => {
    const reminders = await Promise.all(Array.from({ length: 20 }, (_, index) => addReminder(input('plan', { title: `计划 ${index}` }), now)))
    expect(new Set(reminders.map(reminder => reminder.id)).size).toBe(20)
    await Promise.all([saveReminderContext(context), unquiet(), ...Array.from({ length: 20 }, () => updateReminder(reminders[0].id, 'toggle', now))])
    expect(await loadReminderState()).toMatchObject({ context, quietHours: { enabled: false } })
    expect((await loadReminderState()).reminders[0].enabled).toBe(true)
    await Promise.all(reminders.map(reminder => updateReminder(reminder.id, 'delete', now)))
    expect((await loadReminderState()).reminders).toEqual([])
    await expect(updateReminder('missing-id', 'complete', now)).resolves.toBeUndefined()
  })
  it('does not silently repair or overwrite corrupted/duplicate/unbounded stored data', async () => {
    await addReminder(input(), now)
    const valid = await loadReminderState()
    const corrupt = [null, { ...valid, extra: true }, { ...valid, reminders: [valid.reminders[0], valid.reminders[0]] }, { ...valid, reminders: Array.from({ length: 501 }, () => valid.reminders[0]) }, { ...valid, reminders: [{ ...valid.reminders[0], status: 'due', deliveredAt: null }] }, { ...valid, reminders: [{ ...valid.reminders[0], id: '../bad' }] }]
    for (const value of corrupt) {
      await db.settings.put({ key, value })
      await expect(loadReminderState()).rejects.toThrow()
      await expect(addReminder(input(), now)).rejects.toThrow()
      await expect(evaluateReminders(at(10))).rejects.toThrow()
      expect((await db.settings.get(key))?.value).toEqual(value)
    }
  })
  it('bounds reminder count at 500 without discarding existing reminders', async () => {
    const first = await addReminder(input(), now)
    await inject(state => { state.reminders = Array.from({ length: 500 }, (_, index) => ({ ...first, id: `reminder-${index}` })) })
    await expect(addReminder(input(), now)).rejects.toThrow('500')
    expect((await loadReminderState()).reminders).toHaveLength(500)
    await updateReminder('reminder-0', 'delete', now)
    await expect(addReminder(input(), now)).resolves.toBeDefined()
  })
  it('rolls back failed add/delivery/context writes and allows retry', async () => {
    vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('quota'))
    await expect(addReminder(input(), now)).rejects.toThrow('quota')
    expect((await loadReminderState()).reminders).toEqual([])
    const reminder = await addReminder(input(), now); await unquiet()
    vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('delivery failure'))
    await expect(evaluateReminders(at(10))).rejects.toThrow('delivery failure')
    expect((await loadReminderState()).reminders[0].status).toBe('pending')
    expect((await evaluateReminders(at(10)))[0].id).toBe(reminder.id)
    vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('context failure'))
    await expect(saveReminderContext(context)).rejects.toThrow('context failure')
    expect((await loadReminderState()).context.temperature).toBeNull()
  })
})

describe('validation', () => {
  it('rejects malformed input, schedules, limits and kind requirements atomically', async () => {
    const patches: Record<string, unknown>[] = [
      { kind: 'other' }, { title: '' }, { title: ' ' }, { title: 'x'.repeat(201) }, { title: 'a\nb' }, { enabled: 1 },
      { scheduledAt: null }, { scheduledAt: now.toISOString() }, { scheduledAt: at(-1).toISOString() }, { scheduledAt: 'tomorrow' },
      { scheduledAt: '2025-02-30T12:00:00Z' }, { scheduledAt: '2025-02-02' }, { scheduledAt: '2025-02-02T24:00:00Z' }, { scheduledAt: '2025-02-02T12:00:00+14:01' },
      { repeatMinutes: NaN }, { repeatMinutes: Infinity }, { repeatMinutes: 0 }, { repeatMinutes: 1.5 }, { repeatMinutes: 525601 },
      { temperatureBelow: Infinity }, { temperatureBelow: -101 }, { leadMinutes: -1 }, { leadMinutes: 1441 }, { leadMinutes: 0.5 },
      { station: 'x'.repeat(101) }, { exit: null }, { extra: true }, { kind: 'weather', temperatureBelow: null }, { kind: 'metro', station: '' }, { kind: 'metro', station: 'x', exit: ' ' },
    ]
    for (const patch of patches) await expect(addReminder({ ...input(), ...patch } as never, now)).rejects.toThrow()
    await expect(addReminder(input(), new Date('invalid'))).rejects.toThrow()
    await expect(evaluateReminders(new Date('invalid'))).rejects.toThrow()
    for (const id of ['', '../id', 'x'.repeat(101)]) await expect(updateReminder(id, 'delete')).rejects.toThrow()
    await expect(updateReminder('valid', 'other' as never)).rejects.toThrow()
    expect(await db.settings.get(key)).toBeUndefined()
    await expect(addReminder(input('plan', { scheduledAt: '2028-02-29T12:00:00Z', repeatMinutes: 1 }), now)).resolves.toBeDefined()
  })
  it('validates context consistency, finite temperatures, timestamps, future observations and quiet hours', async () => {
    for (const patch of [{ temperature: NaN }, { temperature: 101 }, { weatherObservedAt: null }, { temperature: null }, { mood: 'bad' }, { moodObservedAt: null }, { mood: 'unknown' }, { weatherObservedAt: '2025-02-30T12:00:00Z' }, { weatherObservedAt: '9999-01-01T00:00:00Z' }, { extra: 1 }]) await expect(saveReminderContext({ ...context, ...patch } as never)).rejects.toThrow()
    for (const quiet of [{ enabled: true, start: -1, end: 480 }, { enabled: true, start: 1320, end: 1440 }, { enabled: 'yes', start: 1, end: 2 }, { enabled: true, start: 1.5, end: 2 }, { enabled: false, start: NaN, end: 2 }, { enabled: true, start: 1, end: 2, extra: 1 }]) await expect(saveReminderQuietHours(quiet as never)).rejects.toThrow()
    expect(await db.settings.get(key)).toBeUndefined()
  })
})

describe('due rules and persistent deduplication', () => {
  it('delivers time kinds exactly at schedule, never early/disabled, and completes once', async () => {
    await unquiet()
    const reminders = await Promise.all(['water', 'meal', 'plan'].map(kind => addReminder(input(kind as ReminderKind), now)))
    const disabled = await addReminder(input('water', { enabled: false }), now)
    expect(await evaluateReminders(at(9))).toEqual([])
    expect((await evaluateReminders(at(10))).map(reminder => reminder.id)).toEqual(reminders.map(reminder => reminder.id))
    expect(await evaluateReminders(at(11))).toEqual([])
    db.close(); await db.open(); expect(await evaluateReminders(at(12))).toEqual([])
    await updateReminder(disabled.id, 'toggle', at(12)); expect((await evaluateReminders(at(12)))[0].id).toBe(disabled.id)
    await updateReminder(reminders[0].id, 'complete', at(12)); await updateReminder(reminders[0].id, 'complete', at(13))
    expect((await loadReminderState()).reminders[0].status).toBe('completed')
    await updateReminder(reminders[1].id, 'toggle', at(12)); await updateReminder(reminders[1].id, 'toggle', at(12))
    expect(await evaluateReminders(at(13))).toEqual([])
  })
  it('claims each occurrence once under concurrent evaluations and independent tab connection', async () => {
    await unquiet(); const reminder = await addReminder(input(), now)
    const claims = await Promise.all(Array.from({ length: 20 }, () => evaluateReminders(at(10))))
    expect(claims.flat().map(item => item.id)).toEqual([reminder.id])
    const otherTab = new Dexie('aily'); await otherTab.open()
    try {
      const claimed = await otherTab.table('settings').get(key)
      expect(claimed.value.reminders[0]).toMatchObject({ status: 'due', deliveredAt: at(10).toISOString() })
      await Promise.all([
        updateReminder(reminder.id, 'toggle', at(10)),
        otherTab.transaction('rw', otherTab.table('settings'), async () => {
          const setting = await otherTab.table('settings').get(key)
          setting.value.reminders[0].enabled = !setting.value.reminders[0].enabled
          await otherTab.table('settings').put(setting)
        }),
      ])
      expect((await loadReminderState()).reminders[0].enabled).toBe(true)
      expect(await evaluateReminders(at(11))).toEqual([])
    } finally { otherTab.close() }
  })
  it('requires fresh weather <=6h/mood <=2h with strict threshold and no future data', async () => {
    await unquiet(); await addReminder(input('weather'), now); await addReminder(input('mood'), now)
    expect(await evaluateReminders(now)).toEqual([])
    await saveReminderContext({ ...context, temperature: 10, mood: 'okay' })
    expect(await evaluateReminders(now)).toEqual([])
    await saveReminderContext(context)
    expect((await evaluateReminders(at(120))).map(item => item.kind)).toEqual(['weather', 'mood'])
    await inject(state => { state.reminders.forEach(item => { item.status = 'pending'; item.deliveredAt = null }) })
    expect((await evaluateReminders(at(360))).map(item => item.kind)).toEqual(['weather'])
    await inject(state => { state.reminders[0].status = 'pending'; state.reminders[0].deliveredAt = null })
    expect(await evaluateReminders(new Date(at(360).getTime() + 1))).toEqual([])
    await inject(state => { state.context.weatherObservedAt = at(1).toISOString(); state.context.moodObservedAt = at(1).toISOString() })
    expect(await evaluateReminders(now)).toEqual([])
    expect((await evaluateReminders(at(1))).map(item => item.kind)).toEqual(['weather', 'mood'])
  })
  it('honors earliest delivery on planned contextual reminders', async () => {
    await unquiet(); await saveReminderContext(context)
    await addReminder(input('weather', { scheduledAt: at(10).toISOString() }), now)
    await addReminder(input('mood', { scheduledAt: at(10).toISOString() }), now)
    expect(await evaluateReminders(at(9))).toEqual([])
    expect((await evaluateReminders(at(10))).map(item => item.kind)).toEqual(['weather', 'mood'])
  })
  it('metro uses only provided station/exit, lead time, and bypasses all-day quiet hours', async () => {
    await saveReminderQuietHours({ enabled: true, start: 0, end: 0 })
    const metro = await addReminder(input('metro'), now); await addReminder(input(), now)
    expect(await evaluateReminders(at(4))).toEqual([])
    expect(await evaluateReminders(at(5))).toEqual([{ ...metro, status: 'due', deliveredAt: at(5).toISOString() }])
    expect(await evaluateReminders(at(10))).toEqual([])
    const immediate = await addReminder(input('metro', { leadMinutes: 20 }), now)
    expect((await evaluateReminders(now))[0].id).toBe(immediate.id)
  })
  it('supports overnight/daytime quiet hours with inclusive start and exclusive end', async () => {
    const start = new Date(2025, 1, 1, 21, 0)
    await addReminder(input('plan', { scheduledAt: new Date(2025, 1, 1, 22, 0).toISOString() }), start)
    expect(await evaluateReminders(new Date(2025, 1, 1, 22, 0))).toEqual([])
    expect(await evaluateReminders(new Date(2025, 1, 2, 7, 59))).toEqual([])
    expect(await evaluateReminders(new Date(2025, 1, 2, 8, 0))).toHaveLength(1)
    await saveReminderQuietHours({ enabled: true, start: 9 * 60, end: 17 * 60 })
    await addReminder(input('meal', { scheduledAt: new Date(2025, 1, 2, 9, 0).toISOString() }), new Date(2025, 1, 2, 8, 0))
    expect(await evaluateReminders(new Date(2025, 1, 2, 9, 0))).toEqual([])
    expect(await evaluateReminders(new Date(2025, 1, 2, 16, 59))).toEqual([])
    expect(await evaluateReminders(new Date(2025, 1, 2, 17, 0))).toHaveLength(1)
  })
  it('re-arms repeating reminders to the first future slot without replaying backlog or duplicate completion', async () => {
    await unquiet(); const reminder = await addReminder(input('water', { repeatMinutes: 10 }), now)
    await evaluateReminders(at(10))
    await Promise.all([updateReminder(reminder.id, 'complete', at(45)), updateReminder(reminder.id, 'complete', at(45))])
    expect((await loadReminderState()).reminders[0]).toMatchObject({ scheduledAt: at(50).toISOString(), status: 'pending', deliveredAt: null })
    expect(await evaluateReminders(at(49))).toEqual([])
    expect(await evaluateReminders(at(50))).toHaveLength(1)
    await updateReminder(reminder.id, 'complete', at(50))
    expect((await loadReminderState()).reminders[0].scheduledAt).toBe(at(60).toISOString())
    const metro = await addReminder(input('metro', { repeatMinutes: 10 }), now)
    await evaluateReminders(at(5)); await updateReminder(metro.id, 'complete', at(45))
    expect((await loadReminderState()).reminders.find(item => item.id === metro.id)?.scheduledAt).toBe(at(60).toISOString())
  })
  it('keeps contextual repeats behind their next slot and fresh conditions, including quiet hours', async () => {
    await unquiet(); await saveReminderContext(context)
    const reminder = await addReminder(input('mood', { repeatMinutes: 30 }), now)
    expect(await evaluateReminders(now)).toHaveLength(1)
    await updateReminder(reminder.id, 'complete', now)
    expect((await loadReminderState()).reminders[0]).toMatchObject({ status: 'pending', scheduledAt: at(30).toISOString() })
    await updateReminder(reminder.id, 'complete', at(5))
    expect((await loadReminderState()).reminders[0].scheduledAt).toBe(at(30).toISOString())
    expect(await evaluateReminders(at(29))).toEqual([])
    await saveReminderQuietHours({ enabled: true, start: 0, end: 0 })
    expect(await evaluateReminders(at(30))).toEqual([])
    await unquiet()
    expect(await evaluateReminders(at(121))).toEqual([])
    await saveReminderContext({ ...context, moodObservedAt: at(121).toISOString() })
    expect(await evaluateReminders(at(121))).toHaveLength(1)
  })
  it('snoozes all kinds exactly10min even after context expires/changes, while respecting disable/quiet', async () => {
    await unquiet(); await saveReminderContext(context)
    const reminders = await Promise.all(['water', 'meal', 'weather', 'mood', 'metro', 'plan'].map(kind => addReminder(input(kind as ReminderKind), now)))
    expect(await evaluateReminders(at(10))).toHaveLength(6)
    await Promise.all(reminders.map(item => updateReminder(item.id, 'snooze', at(10))))
    await saveReminderContext({ temperature: null, weatherObservedAt: null, mood: 'unknown', moodObservedAt: null })
    expect(await evaluateReminders(at(19))).toEqual([])
    expect(await evaluateReminders(at(20))).toHaveLength(6)
    expect(await evaluateReminders(at(21))).toEqual([])
    await updateReminder(reminders[0].id, 'snooze', at(20)); await updateReminder(reminders[0].id, 'toggle', at(20))
    expect(await evaluateReminders(at(30))).toEqual([])
    await updateReminder(reminders[0].id, 'toggle', at(30)); await saveReminderQuietHours({ enabled: true, start: 0, end: 0 })
    expect(await evaluateReminders(at(30))).toEqual([])
    await unquiet(); expect((await evaluateReminders(at(30)))[0].id).toBe(reminders[0].id)
  })
})

describe('deterministic local suggestions', () => {
  it('uses explicit bilingual templates without scheduling/network or inventing routes', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not be used'))
    for (const activity of ['午餐', '跑步', '工作', '地铁出门', '随便说说']) {
      const suggestions = proposeNextSteps(activity)
      expect(proposeNextSteps(activity)).toEqual(suggestions)
      expect(suggestions[0].title).toMatch(/^建议：/)
      expect(suggestions[0].delayMinutes).toBeGreaterThan(0)
      expect(suggestions[0].reason).not.toMatch(/预测你会|号线|号口/)
    }
    expect(proposeNextSteps('开完会').map(item => item.title)).toEqual(['建议：整理会议要点', '建议：确认待办事项'])
    expect(proposeNextSteps('准备出门').map(item => item.title)).toEqual(['建议：核对目的地和路线', '建议：检查随身物品'])
    expect(proposeNextSteps('吃完饭')[0].title).toBe('建议：用餐后散步')
    expect(proposeNextSteps('工作')).toHaveLength(2)
    setLocale('en')
    expect(proposeNextSteps('lunch')[0].title).toMatch(/^Suggestion:/)
    expect(proposeNextSteps('work')[0].reason).toContain('without inferring')
    expect(fetch).not.toHaveBeenCalled()
    expect((await loadReminderState()).reminders).toEqual([])
    expect(await db.settings.get(key)).toBeUndefined()
    for (const activity of ['', ' ', 'x'.repeat(501)]) expect(() => proposeNextSteps(activity)).toThrow()
  })
})
