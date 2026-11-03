import { t, translate, resolveChatLocale } from './i18n'
import type { ChatMessage } from './chatService'
import type { CharacterId } from './data'
import { db, loadMemoryPolicy } from './db'
import { canRecall, isSensitive } from './longMemory'
import { getRelationship, stages } from './relationship'

export type ProactiveFrequency = 'low' | 'normal' | 'high'
export type ProactiveWeatherCondition = 'sunny' | 'cloudy' | 'rainy' | 'snowy' | 'hot' | 'cold'
export interface ProactiveWeather { condition: ProactiveWeatherCondition; observedAt: string }
export interface ProactiveSettings {
  enabled: boolean
  frequency: ProactiveFrequency
  quietHours: { enabled: boolean; start: number; end: number }
  triggers: { time: boolean; weather: boolean; relationship: boolean }
  /** Manually selected by the user. Never a fetched forecast or sensor reading. */
  weather: ProactiveWeather | null
}

export const defaultProactiveSettings: ProactiveSettings = {
  enabled: false,
  frequency: 'low',
  quietHours: { enabled: true, start: 22 * 60, end: 8 * 60 },
  triggers: { time: true, weather: true, relationship: true },
  weather: null,
}

interface SchedulerState {
  lastStage: string | null
  lastDeliveredAt: number | null
  dailyCounts: Record<string, number>
  events: string[]
}
interface StoredProactive { settings: ProactiveSettings; state: SchedulerState }
const keyFor = (role: CharacterId) => `__proactive:${role}`
const limits = { low: { cap: 1, hours: 24 }, normal: { cap: 2, hours: 6 }, high: { cap: 3, hours: 3 } }
const hour = 60 * 60 * 1000
const conditions: ProactiveWeatherCondition[] = ['sunny', 'cloudy', 'rainy', 'snowy', 'hot', 'cold']
const emptyState = (): SchedulerState => ({ lastStage: null, lastDeliveredAt: null, dailyCounts: {}, events: [] })
function check(value: unknown): asserts value { if (!value) throw new Error(t('无效的主动消息设置或调度状态')) }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function fields(value: Record<string, unknown>, names: string[]) {
  check(Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)))
}
function roleCheck(role: CharacterId) { check(['lu', 'chen', 'gu'].includes(role)) }
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
}
function validateSettings(value: unknown): ProactiveSettings {
  check(record(value)); fields(value, ['enabled', 'frequency', 'quietHours', 'triggers', 'weather'])
  check(typeof value.enabled === 'boolean' && ['low', 'normal', 'high'].includes(value.frequency as string))
  check(record(value.quietHours)); fields(value.quietHours, ['enabled', 'start', 'end'])
  check(typeof value.quietHours.enabled === 'boolean')
  for (const minute of [value.quietHours.start, value.quietHours.end]) check(Number.isInteger(minute) && (minute as number) >= 0 && (minute as number) < 1440)
  check(record(value.triggers)); fields(value.triggers, ['time', 'weather', 'relationship'])
  check(Object.values(value.triggers).every(item => typeof item === 'boolean'))
  if (value.weather !== null) {
    check(record(value.weather)); fields(value.weather, ['condition', 'observedAt'])
    check(conditions.includes(value.weather.condition as ProactiveWeatherCondition) && timestamp(value.weather.observedAt))
  }
  const settings = value as unknown as ProactiveSettings
  return { ...settings, quietHours: { ...settings.quietHours }, triggers: { ...settings.triggers }, weather: settings.weather ? { ...settings.weather, observedAt: new Date(settings.weather.observedAt).toISOString() } : null }
}
function validateStored(value: unknown): StoredProactive {
  check(record(value)); fields(value, ['settings', 'state'])
  const settings = validateSettings(value.settings)
  check(record(value.state)); fields(value.state, ['lastStage', 'lastDeliveredAt', 'dailyCounts', 'events'])
  const state = value.state
  check(state.lastStage === null || stages.some(stage => stage.name === state.lastStage))
  check(state.lastDeliveredAt === null || (Number.isSafeInteger(state.lastDeliveredAt) && (state.lastDeliveredAt as number) >= 0))
  check(record(state.dailyCounts))
  check(Object.entries(state.dailyCounts).every(([day, count]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isInteger(count) && (count as number) >= 0))
  check(Array.isArray(state.events) && state.events.every(event => typeof event === 'string') && new Set(state.events).size === state.events.length)
  return { settings, state: { ...state, dailyCounts: { ...state.dailyCounts }, events: [...state.events] } as SchedulerState }
}
async function readStored(role: CharacterId): Promise<StoredProactive> {
  const stored = await db.settings.get(keyFor(role))
  return stored ? validateStored(stored.value) : { settings: validateSettings(defaultProactiveSettings), state: emptyState() }
}
async function relationshipStage(role: CharacterId, now: Date): Promise<string> {
  const policy = await loadMemoryPolicy(role)
  const memories = await db.memories.where('characterId').equals(role).toArray()
  // Legacy confirmed records have no state; pending/archived/rejected never count.
  const eligible = memories.filter(memory => canRecall(memory, policy, now) && memory.sensitive !== true && !isSensitive(memory.text)
    && Number.isFinite(Date.parse(memory.confirmedAt)) && Date.parse(memory.confirmedAt) <= now.getTime())
  return getRelationship(role, eligible).stage.name
}

export async function loadProactiveSettings(role: CharacterId): Promise<ProactiveSettings> {
  roleCheck(role)
  return (await readStored(role)).settings
}

/** Internal keys are deliberately excluded from existing local/encrypted backups.
 * Re-enabling observes the current stage without inventing a first transition;
 * delivery history is retained across every settings change.
 */
export async function saveProactiveSettings(role: CharacterId, settings: ProactiveSettings): Promise<void> {
  roleCheck(role)
  const validated = validateSettings(settings)
  await db.transaction('rw', db.settings, db.memories, async () => {
    const current = await readStored(role)
    if (validated.enabled && (!current.settings.enabled || current.state.lastStage === null)) current.state.lastStage = await relationshipStage(role, new Date())
    await db.settings.put({ key: keyFor(role), value: { settings: validated, state: current.state } })
  })
}

function localDay(now: Date): string {
  return `${now.getFullYear().toString().padStart(4, '0')}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`
}
function quiet(settings: ProactiveSettings, now: Date): boolean {
  const { enabled, start, end } = settings.quietHours
  if (!enabled) return false
  const minute = now.getHours() * 60 + now.getMinutes()
  return start === end || (start < end ? minute >= start && minute < end : minute >= start || minute < end)
}
const personas = {
  lu: { morning: '早上好，记得吃点早餐。今天也慢慢来。', evening: '一天辛苦了，留一点时间给自己休息。', relationship: '我们的相处有了新的变化。不急，我愿意慢慢陪你。', weather: '出门前照顾好自己，' },
  chen: { morning: '早啊！早餐别省，今天也给自己加点油。', evening: '忙完没？该休息就休息，别硬撑。', relationship: '好像又了解彼此一点了。嘿，接下来也慢慢来。', weather: '天气是你手动选的，提醒你一句：' },
  gu: { morning: '早安。按自己的节奏开始今天，不必急着回复。', evening: '晚上好。今天到这里也可以，先照顾自己的休息。', relationship: '相处进入了新的阶段。你的边界和节奏仍然最重要。', weather: '根据你手动选的天气，' },
}
const weatherText: Record<ProactiveWeatherCondition, string> = { sunny: '晴天出门注意防晒。', cloudy: '阴天也可以找个舒服的节奏。', rainy: '下雨记得带伞，路上小心。', snowy: '下雪注意保暖和脚下安全。', hot: '天气热，记得补水。', cold: '天气冷，出门记得添衣。' }

/** Called only by an open local browser prototype; no model, network,
 * background execution or system notification. The caller supplies local time.
 */
export async function deliverProactive(characterId: CharacterId, now: Date): Promise<ChatMessage | undefined> {
  roleCheck(characterId)
  check(now instanceof Date && Number.isFinite(now.getTime()) && now.getTime() >= 0)
  return db.transaction('rw', db.settings, db.messages, db.memories, async () => {
    const stored = await readStored(characterId)
    const { settings, state } = stored
    if (!settings.enabled || (await db.settings.get('onboarded'))?.value !== true) return undefined
    const stage = await relationshipStage(characterId, now)
    const stageEvent = `relationship:${state.lastStage}:${stage}`
    // Deletion/expiry is not a relationship milestone. Observe it silently;
    // restoring an already-announced transition must not leave a stale baseline.
    const earlierStage = stages.findIndex(item => item.name === stage) < stages.findIndex(item => item.name === state.lastStage)
    if (state.lastStage === null || !settings.triggers.relationship || earlierStage || state.events.includes(stageEvent)) {
      state.lastStage = stage
      await db.settings.put({ key: keyFor(characterId), value: stored })
    }
    const messages = await db.messages.toArray()
    // A live send anywhere in the app, or recent user activity anywhere, wins.
    if (messages.some(message => message.status === 'sending' || (message.from === 'user' && (() => {
      const time = message.createdAt ? Date.parse(message.createdAt) : message.id >= 100_000_000_000 ? message.id : NaN
      return Number.isFinite(time) && now.getTime() - time < 30 * 60 * 1000
    })()))) return undefined
    const day = localDay(now)
    const limit = limits[settings.frequency]
    if (quiet(settings, now) || (state.dailyCounts[day] ?? 0) >= limit.cap
      || (state.lastDeliveredAt !== null && now.getTime() - state.lastDeliveredAt < limit.hours * hour)) return undefined
    const persona = personas[characterId]
    const latestUser = messages.filter(message => message.characterId === characterId && message.from === 'user' && !message.withdrawn && !message.attachment && (!message.kind || message.kind === 'text') && message.text.trim())
      .sort((a, b) => b.id - a.id)[0]?.text || ''
    const locale = resolveChatLocale(latestUser)
    const localized = (key: string) => translate(key, {}, locale)
    const candidates: { event: string; text: string; stage?: string }[] = []
    if (settings.triggers.weather && settings.weather) {
      const age = now.getTime() - Date.parse(settings.weather.observedAt)
      if (age >= 0 && age <= 6 * hour) candidates.push({ event: `weather:${settings.weather.condition}:${settings.weather.observedAt}`, text: localized(persona.weather) + localized(weatherText[settings.weather.condition]) })
    }
    if (settings.triggers.relationship && state.lastStage !== stage) candidates.push({ event: `relationship:${state.lastStage}:${stage}`, text: localized(persona.relationship), stage })
    const hours = now.getHours()
    const window = hours >= 8 && hours < 11 ? 'morning' : hours >= 18 && hours < 22 ? 'evening' : undefined
    if (settings.triggers.time && window) candidates.push({ event: `time:${day}:${window}`, text: localized(persona[window]) })
    const candidate = candidates.find(item => !state.events.includes(item.event))
    if (!candidate) return undefined
    const max = messages.reduce((highest, message) => Math.max(highest, message.id), 0)
    const id = Math.max(max, Date.now(), now.getTime()) + 1
    check(Number.isSafeInteger(id))
    const message: ChatMessage = { id, from: 'character', text: `${localized('【本机主动消息演示】')}${candidate.text}`, time: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`, createdAt: now.toISOString(), status: 'sent', kind: 'text' }
    await db.messages.add({ ...message, characterId })
    state.events.push(candidate.event)
    state.dailyCounts[day] = (state.dailyCounts[day] ?? 0) + 1
    state.lastDeliveredAt = now.getTime()
    if (candidate.stage) state.lastStage = candidate.stage
    await db.settings.put({ key: keyFor(characterId), value: stored })
    await db.settings.put({ key: `__conversation:${characterId}`, value: true })
    return message
  })
}
