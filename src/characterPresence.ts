import { db } from './db'
import type { CharacterId } from './data'

export interface SplashSettings {
  primary: CharacterId
  enabled: boolean
  personalized: boolean
  staticScene: boolean
}
export interface CharacterActivity {
  status: string
  quote: string
  scene: 'morning' | 'day' | 'evening' | 'night'
}
const key = '__characterSplash'
export const defaultSplashSettings = (primary: CharacterId): SplashSettings => ({ primary, enabled: true, personalized: true, staticScene: false })
function valid(value: unknown): value is SplashSettings {
  if (!value || typeof value !== 'object') return false
  const settings = value as SplashSettings
  return ['lu', 'chen', 'gu'].includes(settings.primary) && ['enabled', 'personalized', 'staticScene'].every(field => typeof settings[field as keyof SplashSettings] === 'boolean')
}
export async function loadSplashSettings(fallback: CharacterId): Promise<SplashSettings> {
  return db.transaction('rw', db.settings, async () => {
    const stored = (await db.settings.get(key))?.value
    if (valid(stored)) return { ...stored }
    // Upgrade existing users once: later conversation switches must not change
    // their primary. The transaction also coordinates simultaneous tab starts.
    const settings = defaultSplashSettings(fallback)
    await db.settings.put({ key, value: settings })
    return settings
  })
}
export async function saveSplashSettings(settings: SplashSettings) {
  if (!valid(settings)) throw new Error('无效的主角色设置')
  await db.settings.put({ key, value: { ...settings } })
}

// Only preset, non-sensitive character life. No chat, memories, weather or model
// requests are read here; turning personalization off also stops using local time.
const schedules: Record<CharacterId, CharacterActivity[]> = {
  lu: [
    { status: '正在准备早餐', quote: '早餐刚好，坐下来慢慢吃。', scene: 'morning' },
    { status: '正在训练', quote: '训练告一段落，就来陪你。', scene: 'day' },
    { status: '正在练新菜', quote: '今天试一道新菜，要不要一起？', scene: 'evening' },
    { status: '正在收拾厨房', quote: '把今天收好，留一点安静给我们。', scene: 'night' },
  ],
  chen: [
    { status: '正在通勤', quote: '路上听到一首歌，等会儿分享给你。', scene: 'morning' },
    { status: '正在发呆', quote: '只是休息一下，可没偷懒啊。', scene: 'day' },
    { status: '正在点外卖', quote: '又到了纠结吃什么的时间。一起选？', scene: 'evening' },
    { status: '正在打游戏', quote: '这一局结束，听你说说今天。', scene: 'night' },
  ],
  gu: [
    { status: '正在整理今日计划', quote: '不必着急，我们按自己的节奏来。', scene: 'morning' },
    { status: '正在工作', quote: '稍作停顿，也是一种安排。', scene: 'day' },
    { status: '正在阅读', quote: '读到一段有趣的话，愿意一起聊聊吗？', scene: 'evening' },
    { status: '正在整理书桌', quote: '今天到这里。你想说的，我会听。', scene: 'night' },
  ],
}
export function getCharacterActivity(role: CharacterId, now = new Date(), personalized = true): CharacterActivity {
  if (!personalized || !Number.isFinite(now.getTime())) return { status: '在这里等你', quote: '回来了？我们慢慢聊。', scene: 'evening' }
  const hour = now.getHours()
  return schedules[role][hour >= 6 && hour < 11 ? 0 : hour >= 11 && hour < 17 ? 1 : hour >= 17 && hour < 22 ? 2 : 3]
}
