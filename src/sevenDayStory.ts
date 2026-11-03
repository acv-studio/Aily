import { db, loadMemoryPolicy } from './db'
import type { ConfirmedMemory } from './chatService'

export const storyTitle = '把日子慢慢写成我们'
export type StoryProgress = { choices: number[]; completedDates: string[] }
type StoryChoice = { label: string; line: string; ending: string }
type StoryChapter = { title: string; art: string; intro: string; choices: [StoryChoice, StoryChoice] }

export const chapters: StoryChapter[] = [
  {
    title: '下班后的晚饭', art: '⌁',
    intro: '厨房的灯亮着，汤轻轻沸腾。陆听澜回头：“回来得正好。先洗手，汤马上好了。”饭桌旁放着一张海岸明信片，背面还空着。',
    choices: [
      { label: '从背后抱住他', line: '“今天有点想你。以后累了，想先抱一会儿。”', ending: '他停了一下，手覆上你的手背：“嗯，再抱会儿。”你们记下了累时先拥抱的偏好，也约好慢慢写满那张海岸明信片。' },
      { label: '靠在门边看他', line: '“需要我帮忙吗？安静陪着也很好。”', ending: '他递来洗好的番茄：“那就陪我。”你们记下了安静陪伴的偏好，也约好慢慢写满那张海岸明信片。' },
    ],
  },
  {
    title: '给海岸留一个位置', art: '✉',
    intro: '昨晚的明信片被陆听澜放在桌上。“不用马上出发。先选一段我们都喜欢的海岸，等有空再去。”这是一份可以慢慢实现的共同计划。',
    choices: [
      { label: '去看清晨的海', line: '“想看日出，带着热饮慢慢走。”', ending: '他在明信片上画了一轮小太阳。你们把清晨看海、带热饮散步写进共同计划，不赶行程。' },
      { label: '去听傍晚的浪', line: '“傍晚去吧，找个地方坐着听海。”', ending: '他画下落日和一张长椅。你们把傍晚看海、坐着听浪写进共同计划，不赶行程。' },
    ],
  },
  {
    title: '一份合口味的便当', art: '♧',
    intro: '陆听澜准备练习一份适合带去海边的便当。“不是替你决定口味。你喜欢哪一种，我们就试哪一种。”',
    choices: [
      { label: '清淡一点', line: '“清淡一点，带上番茄和热汤。”', ending: '他把清淡、番茄和热汤写在便当清单上：“记住了，下次照这个做。”海岸计划多了一份合你口味的便当。' },
      { label: '来一点甜', line: '“番茄炒蛋甜一点，再带一小份甜点。”', ending: '他把偏甜的番茄炒蛋和小份甜点写进清单：“好，甜度由你来尝。”海岸计划多了一份合你口味的便当。' },
    ],
  },
  {
    title: '雨天也不用赶路', art: '☂',
    intro: '窗外落雨，陆听澜把海岸路线图收进抽屉。“天气不好就换一天。今天想怎么休息？”明信片还在，不必为了计划勉强自己。',
    choices: [
      { label: '说说今天的事', line: '“想聊一聊，你先听我说就好。”', ending: '他关小了背景音乐，认真听你说完。你们记下了烦累时先倾听、暂时不急着给建议的约定；看海可以等天气合适。' },
      { label: '一起安静待着', line: '“今天不想说话，陪我看看雨吧。”', ending: '他把椅子挪到窗边，留出舒服的距离。你们记下了烦累时可以安静、不必解释的约定；看海可以等天气合适。' },
    ],
  },
  {
    title: '明信片的第一行', art: '✎',
    intro: '雨停后，陆听澜拿出那张海岸明信片。“路线和便当都有了。第一行，你想写什么？”共同计划不需要漂亮的宣言，只需要你愿意留下的一句话。',
    choices: [
      { label: '把普通日子写进去', line: '“写：一起吃饭，一起慢慢走。”', ending: '你们在明信片上写下“一起吃饭，一起慢慢走”。他在旁边添了一只小碗，把普通日子当作值得珍藏的事。' },
      { label: '给未来留一点期待', line: '“写：有空的时候，我们去看海。”', ending: '你们在明信片上写下“有空的时候，我们去看海”。他留出一块空白：“等那天到了，再补上日期。”' },
    ],
  },
  {
    title: '出发前的慢清单', art: '☷',
    intro: '陆听澜把明信片、便当清单和海岸路线摊开。“最后还有一件事：到了海边，按你舒服的节奏来。”计划随时可以调整，不是必须完成的任务。',
    choices: [
      { label: '随性一点', line: '“不用排满，走累了就停下来。”', ending: '你们约好留白的行程：随性散步，累了就休息。他划掉多余的景点：“留下时间，比打卡重要。”' },
      { label: '留一个小仪式', line: '“带上明信片，找个喜欢的地方一起读一遍。”', ending: '你们约好在海边读明信片的小仪式，其余时间不排满。他把卡片放进袋子：“到时找个你喜欢的地方。”' },
    ],
  },
  {
    title: '把日子慢慢写成我们', art: '✦',
    intro: '陆听澜把这几次留下的字放在一起：晚饭、海岸、便当、雨天和明信片。“原来已经有这么多了。没来的日子不用补偿，我们就从愿意继续的这一天往下写。”',
    choices: [
      { label: '把回忆收好', line: '“先收好这张明信片，以后再慢慢添。”', ending: '他把明信片放进回忆盒：“好。不是结束，只是有了一页我们。”你们选择珍藏这段共同回忆，未来的海岸计划依然可以慢慢实现。' },
      { label: '给下一次留一页', line: '“再留一页，下次把真正看到的海写进去。”', ending: '他在旁边放了一张空白卡片：“等我们都有空。”你们选择给下一次看海留一页，没有期限，也不需要证明什么。' },
    ],
  },
]

const progressKey = '__sevenDayStory:lu'
const invalidProgress = () => new Error('七日故事进度损坏，请保留数据后检查')

/** A local calendar date, deliberately not a UTC ISO date or elapsed 24 hours. */
export function localDate(date: Date): string {
  if (!Number.isFinite(date.getTime()) || date.getFullYear() < 1 || date.getFullYear() > 9999) throw new Error('无效日期')
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function calendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return year >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function validateProgress(value: unknown): StoryProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidProgress()
  const record = value as Record<string, unknown>
  const { choices, completedDates } = record
  if (Object.keys(record).some(key => key !== 'choices' && key !== 'completedDates')
    || !Array.isArray(choices) || !Array.isArray(completedDates) || choices.length > 7
    || choices.length !== completedDates.length) throw invalidProgress()
  for (let i = 0; i < choices.length; i++) {
    if ((choices[i] !== 0 && choices[i] !== 1) || !calendarDate(completedDates[i])
      || (i > 0 && completedDates[i] <= completedDates[i - 1])) throw invalidProgress()
  }
  return { choices: [...choices], completedDates: [...completedDates] }
}

export async function loadStoryProgress(): Promise<StoryProgress> {
  const stored = await db.settings.get(progressKey)
  return stored ? validateProgress(stored.value) : { choices: [], completedDates: [] }
}

function checkChapter(index: number, choice?: number) {
  if (!Number.isInteger(index) || index < 0 || index >= chapters.length) throw new Error('无效章节')
  if (arguments.length > 1 && choice !== 0 && choice !== 1) throw new Error('无效选择')
}

export function storyRecall(progress: StoryProgress): string {
  const checked = validateProgress(progress)
  return checked.choices.map((choice, index) => `第${index + 1}章「${chapters[index].title}」：${chapters[index].choices[choice].line} ${chapters[index].choices[choice].ending}`).join('\n')
}

export function chapterIntro(index: number, progress: StoryProgress): string {
  checkChapter(index)
  const checked = validateProgress(progress)
  const remembered = (day: number, lines: [string, string]) => checked.choices[day] === undefined ? '' : lines[checked.choices[day]]
  const callbacks = [
    '',
    remembered(0, ['他先张开手臂：“你说过累了想先抱一会儿。抱够了，我们再挑海岸。”', '他给你留了身旁的位置：“安静陪着就很好。我们坐在一起慢慢挑。”']),
    remembered(1, ['为了你选的清晨看海，他试着做一份早餐便当，热饮也在清单上。', '为了你选的傍晚听浪，他准备一份晚餐便当，打算坐在长椅上慢慢吃。']),
    remembered(0, ['他记得你喜欢累时先拥抱，轻声问：“今天也想抱一会儿吗？不想也没关系。”', '他记得你喜欢安静陪伴，留出舒服的距离：“我就在旁边，不用急着说话。”']),
    remembered(2, ['桌上是照你口味做的清淡便当，番茄和热汤冒着暖气。吃过再写，不急。', '桌上是你选的偏甜番茄炒蛋和小份甜点。他把笔递来：“尝过甜度，再写我们的第一行。”']),
    `${remembered(1, ['路线留给清晨的日出，热饮和慢慢走的时间都算进去了。', '路线留给傍晚的落日，长椅旁有坐着听浪的空闲。'])}${remembered(3, ['他记得雨天你想先被倾听：“路上有想说的，我先听，不急着给建议。”', '他记得雨天你想安静：“路上不想聊天也可以，我们一起听海。”'])}`,
    `${remembered(4, ['明信片上写着“一起吃饭，一起慢慢走”，旁边的小碗还在。', '明信片上写着“有空的时候，我们去看海”，出发日期仍然留白。'])}${remembered(5, ['你们选了随性的行程：走累就停，不需要赶完景点。', '你们留了在海边读明信片的小仪式，其余时间不排满。'])}`,
  ]
  return `${chapters[index].intro}${callbacks[index] ? `\n${callbacks[index]}` : ''}`
}

export function chapterEnding(index: number, choice: number, progress: StoryProgress): string {
  checkChapter(index, choice)
  const checked = validateProgress(progress)
  const ending = chapters[index].choices[choice].ending
  if (index !== 6) return ending
  const recap = storyRecall({ choices: checked.choices.slice(0, 6), completedDates: checked.completedDates.slice(0, 6) })
  return `${ending}\n《${storyTitle}》共同回顾：\n${recap}${recap ? '\n' : ''}第7章「${chapters[6].title}」：${chapters[6].choices[choice].line} ${ending}`
}

/** The read/check/write share a transaction: concurrent retries return the first decision. */
export async function completeStoryChapter(index: number, choice: number, now = new Date()): Promise<StoryProgress> {
  checkChapter(index, choice)
  return db.transaction('rw', db.settings, db.memories, async () => {
    const progress = await loadStoryProgress()
    if (index < progress.choices.length) return progress // Never recreate a deleted chapter memory.
    if (index !== progress.choices.length) throw new Error('请先完成前面的章节')
    const today = localDate(now)
    const lastDate = progress.completedDates.at(-1)
    if (lastDate && today <= lastDate) throw new Error('下一章将在下一个本地日历日解锁')
    if ((await loadMemoryPolicy('lu')).disabledCategories.includes('relationship')) throw new Error('此类记忆已关闭，请在记忆设置中启用关系记忆后重试')
    const next = { choices: [...progress.choices, choice], completedDates: [...progress.completedDates, today] }
    await db.settings.put({ key: progressKey, value: next })
    const memory: ConfirmedMemory = {
      id: `sevenDayStory:lu:${index + 1}:${crypto.randomUUID()}`, characterId: 'lu', category: 'relationship',
      state: 'confirmed', enabled: true, importance: 4, confirmedAt: now.toISOString(),
      text: `与陆听澜完成《${storyTitle}》第${index + 1}章「${chapters[index].title}」。用户选择：${chapters[index].choices[choice].line}\n${chapters[index].choices[choice].ending}`,
    }
    // A reset starts fresh memories without overwriting imported or user-edited ones.
    await db.memories.put(memory)
    return next
  })
}
