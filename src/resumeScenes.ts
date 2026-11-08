import type { CharacterId } from './data'
export type ResumeScene = { id: string; activity: string; english: string; detail: string; englishDetail: string; icon: 'tea' | 'walk' | 'book' | 'music' | 'rest' | 'write' | 'train' | 'cook'; periods: readonly ResumePeriod[] }
export type ResumePeriod = 'morning' | 'day' | 'evening' | 'night'
const scene = (id: string, activity: string, english: string, detail: string, englishDetail: string, icon: ResumeScene['icon'], periods: ResumePeriod[]): ResumeScene => ({ id, activity, english, detail, englishDetail, icon, periods })
const common: ResumeScene[] = [
  scene('morning-tea', '泡了一杯热茶', 'A warm cup of tea', '晨间的光，落在杯沿。', 'Morning light rests on the rim of a cup.', 'tea', ['morning']),
  scene('morning-walk', '在晨光里散步', 'A walk in the morning light', '慢一点，也是一种好节奏。', 'A slower pace can be a good rhythm.', 'walk', ['morning']),
  scene('day-music', '听一首轻快的歌', 'A lighthearted song', '给平常的一天，换个背景音。', 'A new soundtrack for an ordinary day.', 'music', ['day']),
  scene('evening-walk', '沿着晚风慢慢走', 'Walking in the evening breeze', '夕阳把街角染得很柔和。', 'Sunset softens the corner of the street.', 'walk', ['evening']),
  scene('night-music', '听一段安静的旋律', 'A quiet melody', '夜色里，音量也放轻一点。', 'A softer volume for a quieter night.', 'music', ['night']),
  scene('night-rest', '准备好好休息', 'Getting ready to rest', '今天可以先到这里，明天再慢慢来。', 'Today can end here. Tomorrow can take its time.', 'rest', ['night']),
]
export const resumeScenes: Record<CharacterId, readonly ResumeScene[]> = {
  lu: [
    ...common,
    scene('lu-breakfast', '准备一份简单早餐', 'Preparing a simple breakfast', '热乎乎的早晨，不必匆忙。', 'A warm morning, without the rush.', 'cook', ['morning']),
    scene('lu-stretch', '做一组舒展练习', 'A gentle stretch', '先松一松肩膀，再开始一天。', 'Relax the shoulders before starting the day.', 'train', ['morning', 'day']),
    scene('lu-book', '翻到书里的下一页', 'Turning to the next page', '把注意力放回眼前的小事。', 'A little attention for the small things nearby.', 'book', ['day', 'evening']),
    scene('lu-train', '刚结束训练', 'Finishing a workout', '留一点空白，让呼吸慢慢平稳。', 'A little space for the breath to settle.', 'train', ['day', 'evening']),
    scene('lu-dinner', '琢磨今晚吃点什么', 'Thinking about dinner', '一顿简单的饭，也值得认真对待。', 'Even a simple dinner deserves a little care.', 'cook', ['evening']),
    scene('lu-notes', '写下今天的一点小事', 'A small note about the day', '不必写满，记住一点就好。', 'A page need not be full. One small thing is enough.', 'write', ['night']),
  ],
  chen: [
    ...common,
    scene('chen-song', '挑一首今天的开场曲', 'Choosing today’s opening song', '用一个轻快的节拍开始。', 'Start with a lighthearted beat.', 'music', ['morning']),
    scene('chen-train', '给自己安排一点运动', 'Making room for some movement', '动一动，再给自己留点休息。', 'Move a little, then leave room for a break.', 'train', ['day']),
    scene('chen-pages', '翻一本有趣的小书', 'Browsing an interesting little book', '偶尔遇见一句，刚好喜欢的话。', 'Sometimes one sentence is just the right one.', 'book', ['day', 'evening']),
    scene('chen-food', '纠结晚餐选哪一种', 'Choosing what to have for dinner', '认真选择，也可以轻松一点。', 'Even careful choices can feel light.', 'cook', ['evening']),
    scene('chen-night', '整理今天的歌单', 'Putting together today’s playlist', '把喜欢的旋律留到下一次。', 'Save a favorite melody for another time.', 'music', ['night']),
    scene('chen-note', '随手记下一点新想法', 'Jotting down a new idea', '灵感不必很大，够有趣就好。', 'An idea need not be big. Interesting is enough.', 'write', ['morning', 'night']),
  ],
  gu: [
    ...common,
    scene('gu-coffee', '慢慢喝完一杯咖啡', 'Taking time over a cup of coffee', '从容一点，再开始今天。', 'A little composure before the day begins.', 'tea', ['morning']),
    scene('gu-read', '正在阅读', 'Reading', '留一段安静的时间给书页。', 'A quiet stretch of time for the pages.', 'book', ['day', 'evening']),
    scene('gu-desk', '整理手边的笔记', 'Organizing a few notes', '把零散的思绪，摆放整齐。', 'Putting scattered thoughts into a little order.', 'write', ['day']),
    scene('gu-tea', '给自己留一杯晚茶', 'An evening cup of tea', '忙碌之外，也留一点松弛。', 'A little ease beyond the busy parts.', 'tea', ['evening']),
    scene('gu-nightbook', '读完今天最后几页', 'The last few pages of the day', '书签停在这里，今天也停一停。', 'Let the bookmark pause here, and the day pause too.', 'book', ['night']),
    scene('gu-window', '在窗边放空片刻', 'A quiet moment by the window', '不用急着给每件事找答案。', 'Not everything needs an answer right away.', 'rest', ['day', 'night']),
  ],
}
export function resumePeriod(now: Date): ResumePeriod { const hour = now.getHours(); return hour >= 6 && hour < 11 ? 'morning' : hour >= 11 && hour < 17 ? 'day' : hour >= 17 && hour < 22 ? 'evening' : 'night' }
/** Pure selection; presentation only, never a claim about background work. */
export function selectResumeScene(character: CharacterId, now: Date, previousId?: string, random = Math.random): ResumeScene {
  const available = resumeScenes[character].filter(entry => entry.periods.includes(resumePeriod(now)))
  const alternatives = available.filter(entry => entry.id !== previousId)
  const pool = alternatives.length ? alternatives : available
  const value = random(); const index = Number.isFinite(value) ? Math.floor(Math.max(0, Math.min(.999999, value)) * pool.length) : 0
  return pool[index]
}
const lastScene = new Map<CharacterId, string>()
export function nextResumeScene(character: CharacterId, now = new Date()): ResumeScene { const next = selectResumeScene(character, now, lastScene.get(character)); lastScene.set(character, next.id); return next }
