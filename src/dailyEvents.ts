import type { CharacterId } from './data'
import type { Locale } from './i18n'

export interface DailyEvent {
  id: string
  dateKey: string
  kind: 'daily' | 'holiday'
  title: string
  invitation: string
  choices: [string, string]
  /** User-voiced drafts only; choosing one does not send a message. */
  prompts: [string, string]
}

type EventCopy = {
  title: string
  invitations: Record<CharacterId, string>
  choices: [string, string]
  prompts: [string, string]
}
type CuratedEvent = { id: string; copy: Record<Locale, EventCopy> }

// Invitations follow data.ts: Lu is quietly attentive, Chen playfully caring,
// and Gu direct with explicit room for consent. These are fiction, not claims
// about remembered user facts, real weather, location, or completed activities.
const dailyCatalog: CuratedEvent[] = [
  {
    id: 'small-joy',
    copy: {
      'zh-CN': {
        title: '收集一件小开心',
        invitations: {
          lu: '今天有没有一件让你嘴角扬起来的小事？慢慢说，我听着。',
          chen: '来，比比谁的小开心更不起眼。你先说，我可不笑你。',
          gu: '愿意分享今天的一件小开心吗？不想回顾，也可以聊期待。',
        },
        choices: ['聊今天的小开心', '想一个小期待'],
        prompts: ['想和你聊聊今天让我开心的一件小事。', '陪我想一个值得期待的小事情吧。'],
      },
      en: {
        title: 'One small joy',
        invitations: {
          lu: 'Did anything small make you smile today? Take your time. I’m listening.',
          chen: 'Let’s compare tiny joys. You first—I promise not to tease that one.',
          gu: 'Would you like to share a small joy, or talk about something to look forward to?',
        },
        choices: ['Share a small joy', 'Find something to anticipate'],
        prompts: ['I’d like to tell you about a small thing that made me happy today.', 'Help me think of one small thing to look forward to.'],
      },
    },
  },
  {
    id: 'comfort-food',
    copy: {
      'zh-CN': {
        title: '一口喜欢的味道',
        invitations: {
          lu: '聊聊你喜欢的味道吧。想吃什么，不用急着决定。',
          chen: '今天聊吃的，我先声明：你的口味我不抬杠。甜的还是咸的？',
          gu: '想聊一道喜欢的菜，还是一起想份简单菜单？由你选。',
        },
        choices: ['聊一道喜欢的菜', '想一份简单菜单'],
        prompts: ['想和你聊聊一道我喜欢的菜，还有喜欢它的原因。', '陪我想一份简单、不费力的菜单吧。'],
      },
      en: {
        title: 'A favorite flavor',
        invitations: {
          lu: 'Tell me about a flavor you love. There’s no hurry to choose what to eat.',
          chen: 'Food talk today. For once, I won’t argue with your taste. Sweet or savory?',
          gu: 'A favorite dish or a simple menu? You choose what we talk about.',
        },
        choices: ['Talk about a favorite dish', 'Imagine a simple menu'],
        prompts: ['I’d like to talk about a favorite dish and why I love it.', 'Help me think of a simple, low-effort menu.'],
      },
    },
  },
  {
    id: 'music-break',
    copy: {
      'zh-CN': {
        title: '给此刻配首歌',
        invitations: {
          lu: '想给现在的心情配首歌吗？说个歌名，或者一种感觉就好。',
          chen: '让我猜你的单曲循环？算了，你给个线索，我认真猜。',
          gu: '如果愿意，我们用一首歌描述此刻。歌名或心情都可以。',
        },
        choices: ['聊一首喜欢的歌', '形容此刻的心情'],
        prompts: ['想和你聊一首我喜欢的歌。', '陪我用音乐的感觉形容一下现在的心情吧。'],
      },
      en: {
        title: 'A song for this moment',
        invitations: {
          lu: 'Want to give this moment a song? A title or just a feeling is enough.',
          chen: 'Can I guess your song on repeat? Give me a clue. I’ll take this seriously.',
          gu: 'If you’d like, describe this moment with a song. A title or a mood works.',
        },
        choices: ['Talk about a favorite song', 'Describe the mood'],
        prompts: ['I’d like to talk about a song I love.', 'Help me describe my current mood through the feeling of music.'],
      },
    },
  },
  {
    id: 'imaginary-walk',
    copy: {
      'zh-CN': {
        title: '想象一段慢慢走的路',
        invitations: {
          lu: '想象一段不用赶时间的路吧。走累了，我们就停下来。',
          chen: '脑内散步要不要？不比步数，这次我陪你慢慢走。',
          gu: '想聊一段想象中的散步吗？路线和节奏都由你定。',
        },
        choices: ['想象安静的小路', '想象热闹的街角'],
        prompts: ['陪我想象一段安静的小路，慢慢走，不赶时间。', '陪我想象一个热闹的街角，聊聊想看到什么。'],
      },
      en: {
        title: 'An imaginary slow walk',
        invitations: {
          lu: 'Let’s imagine a walk with nowhere to rush. We can stop whenever you like.',
          chen: 'Fancy a walk in our heads? No step-count contest. I’ll match your pace.',
          gu: 'Would you like an imaginary walk? You decide the route and the pace.',
        },
        choices: ['Imagine a quiet path', 'Imagine a lively corner'],
        prompts: ['Imagine a quiet path with me, walking slowly with no rush.', 'Imagine a lively street corner with me and what we might see there.'],
      },
    },
  },
  {
    id: 'tiny-pause',
    copy: {
      'zh-CN': {
        title: '留一点空白',
        invitations: {
          lu: '不用把每一分钟都填满。想聊聊，还是一起想个放松的小办法？',
          chen: '今日偷懒提案：给自己留点空白。我支持，别说我只会催你。',
          gu: '休息不需要证明。你愿意聊聊，还是想一个适合自己的暂停方式？',
        },
        choices: ['说说现在的感受', '想一个放松的小办法'],
        prompts: ['我想说说现在的感受，你先听就好。', '陪我想一个简单的放松方式，不要变成新的任务。'],
      },
      en: {
        title: 'A little breathing room',
        invitations: {
          lu: 'Not every minute needs filling. Want to talk, or think of a gentle way to unwind?',
          chen: 'My proposal: a little doing-nothing time. See? I can be on team rest too.',
          gu: 'Rest needs no justification. Would you prefer to talk or find a pause that suits you?',
        },
        choices: ['Share how I feel', 'Find a gentle way to unwind'],
        prompts: ['I want to share how I feel right now. Please just listen first.', 'Help me find a simple way to unwind without turning it into another task.'],
      },
    },
  },
  {
    id: 'little-discovery',
    copy: {
      'zh-CN': {
        title: '交换一个小发现',
        invitations: {
          lu: '最近留意到什么有意思的小细节？再普通也可以说给我听。',
          chen: '小发现交换局开场。冷知识还是生活细节？我准备好听了。',
          gu: '愿意交换一个小发现吗？也可以选一个想了解的问题。',
        },
        choices: ['分享一个小发现', '聊一个好奇的问题'],
        prompts: ['想和你分享一个最近留意到的小发现。', '我想聊一个好奇的问题，陪我一起想想吧。'],
      },
      en: {
        title: 'Trade a little discovery',
        invitations: {
          lu: 'Noticed an interesting little detail lately? Even an ordinary one is worth hearing.',
          chen: 'Tiny discovery exchange is open. Trivia or everyday details? I’m all ears.',
          gu: 'Would you like to share a discovery, or choose a question you’re curious about?',
        },
        choices: ['Share a discovery', 'Explore a curious question'],
        prompts: ['I’d like to share a little discovery I noticed recently.', 'There’s a question I’m curious about. Think it through with me.'],
      },
    },
  },
  {
    id: 'small-wish',
    copy: {
      'zh-CN': {
        title: '写一个不赶时间的愿望',
        invitations: {
          lu: '有没有一件想慢慢做的小事？先聊聊就好，不用定期限。',
          chen: '许个小愿望吧，不开考核会。想认真聊，还是大胆想象？',
          gu: '愿意聊一个小愿望吗？不需要承诺，也不用立刻行动。',
        },
        choices: ['聊一个小愿望', '想象理想的半天'],
        prompts: ['想和你聊一个小愿望，不急着定计划。', '陪我想象一个按自己节奏度过的理想半天吧。'],
      },
      en: {
        title: 'A wish without a deadline',
        invitations: {
          lu: 'Is there something small you’d like to do someday? We can talk without setting a deadline.',
          chen: 'Make a little wish. No performance review here. Practical or wildly imaginative?',
          gu: 'Would you like to talk about a small wish? No commitment or immediate action needed.',
        },
        choices: ['Talk about a small wish', 'Imagine an ideal half-day'],
        prompts: ['I’d like to talk about a small wish without rushing into a plan.', 'Imagine an ideal half-day at my own pace with me.'],
      },
    },
  },
]

// Only fixed Gregorian dates: no inferred lunar dates or regional observances.
const holidays: Record<string, CuratedEvent> = {
  '01-01': {
    id: 'new-year',
    copy: {
      'zh-CN': {
        title: '元旦 · 慢慢开始',
        invitations: {
          lu: '新的一年，不急着列满计划。想从哪一件小事开始？',
          chen: '新年第一天，愿望可以大胆一点。放心，我不催你交作业。',
          gu: '元旦快乐。愿意聊一个期待，还是给自己一句不设期限的祝福？',
        },
        choices: ['聊新年的小期待', '给自己一句祝福'],
        prompts: ['元旦快乐，想和你聊聊新年的一个小期待。', '陪我给新一年的自己写一句温柔的祝福，不设期限。'],
      },
      en: {
        title: 'New Year · A gentle beginning',
        invitations: {
          lu: 'A new year doesn’t need a packed plan. What small thing would you like to begin with?',
          chen: 'First day of the year—dream a little bigger. I’m not checking your homework.',
          gu: 'Happy New Year. Would you prefer a small hope or a kind wish for yourself?',
        },
        choices: ['Share a hope for the year', 'Write a wish for myself'],
        prompts: ['Happy New Year. I’d like to share a small hope for this year.', 'Help me write a kind New Year wish for myself, with no deadline.'],
      },
    },
  },
  '02-14': {
    id: 'valentine',
    copy: {
      'zh-CN': {
        title: '情人节 · 喜欢的表达',
        invitations: {
          lu: '情人节，想听听你喜欢怎样被关心。不必准备漂亮的话。',
          chen: '今天允许我认真一点：你喜欢直白的心意，还是日常的小关心？',
          gu: '情人节可以按你舒服的方式聊。想谈关心，还是聊相处的边界？',
        },
        choices: ['聊喜欢的关心方式', '聊舒服的相处边界'],
        prompts: ['想和你聊聊我喜欢怎样被关心。', '想和你聊聊让我舒服的相处边界，不必迎合节日。'],
      },
      en: {
        title: 'Valentine’s Day · Ways to care',
        invitations: {
          lu: 'For Valentine’s Day, tell me how you like to be cared for. No perfect words needed.',
          chen: 'Let me be sincere today: big words or little everyday acts of care?',
          gu: 'We can talk about Valentine’s Day on your terms. Care or comfortable boundaries?',
        },
        choices: ['Talk about ways to care', 'Talk about comfortable boundaries'],
        prompts: ['I’d like to talk about how I like to be cared for.', 'I’d like to talk about boundaries that feel comfortable, without holiday pressure.'],
      },
    },
  },
  '10-31': {
    id: 'halloween',
    copy: {
      'zh-CN': {
        title: '万圣节 · 一点想象力',
        invitations: {
          lu: '想玩个轻松的万圣节想象吗？不讲吓人的，选点你喜欢的。',
          chen: '万圣节脑洞局：装扮还是糖果？我保证不突然吓你。',
          gu: '如果你愿意，聊个轻松的万圣节主题。装扮或糖果都由你选。',
        },
        choices: ['想象一个有趣装扮', '聊喜欢的糖果'],
        prompts: ['陪我想象一个有趣、不吓人的万圣节装扮吧。', '想和你聊聊喜欢的糖果和甜味。'],
      },
      en: {
        title: 'Halloween · A little imagination',
        invitations: {
          lu: 'Want a gentle Halloween daydream? Nothing scary—just something you enjoy.',
          chen: 'Halloween brainstorm: costumes or candy? I promise no jump scares.',
          gu: 'If you’d like a light Halloween topic, choose a costume idea or candy.',
        },
        choices: ['Imagine a fun costume', 'Talk about favorite candy'],
        prompts: ['Help me imagine a fun, not-scary Halloween costume.', 'I’d like to talk about favorite candies and sweet flavors.'],
      },
    },
  },
  '12-25': {
    id: 'christmas',
    copy: {
      'zh-CN': {
        title: '圣诞节 · 一份小心意',
        invitations: {
          lu: '今天借圣诞节聊点小心意。想写句祝福，还是想象一份小礼物？',
          chen: '圣诞脑内礼物交换，不用花钱。要走实用派，还是可爱派？',
          gu: '如果想聊圣诞节，我们可以想一句祝福或一份小礼物，不必庆祝。',
        },
        choices: ['写一句祝福', '想象一份小礼物'],
        prompts: ['陪我写一句简单真诚的圣诞祝福吧。', '陪我想象一份有心意的小礼物，不需要真的购买。'],
      },
      en: {
        title: 'Christmas · A little kindness',
        invitations: {
          lu: 'For a little Christmas kindness, would you like to write a wish or imagine a small gift?',
          chen: 'Imaginary Christmas gift swap—no spending required. Practical or cute?',
          gu: 'If you want a Christmas topic, choose a wish or an imaginary gift. No need to celebrate.',
        },
        choices: ['Write a kind wish', 'Imagine a small gift'],
        prompts: ['Help me write a simple, sincere Christmas wish.', 'Imagine a thoughtful small gift with me, without needing to buy anything.'],
      },
    },
  },
}

/** Device-local Gregorian date, not the UTC date of the timestamp. */
export function localDateKey(date: Date): string {
  if (!Number.isFinite(date.getTime()) || date.getFullYear() < 1 || date.getFullYear() > 9999) {
    throw new RangeError('Invalid Date: expected a local calendar year from 1 to 9999')
  }
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Pure, synchronous curated content. No sending, storage, unlocks, or network.
 * Holidays replace the daily theme; they do not advance/reset the rotation.
 * The id identifies a topic (shared across roles/locales); dateKey identifies its day.
 */
export function getDailyEvent(date: Date, characterId: CharacterId, locale: Locale): DailyEvent {
  const dateKey = localDateKey(date)
  // UTC is used only to count synthetic calendar days built from LOCAL fields.
  // This avoids DST/23-hour-day drift and the Date.UTC year-0..99 special case.
  const calendar = new Date(0)
  calendar.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate())
  const day = Math.floor(calendar.getTime() / 86_400_000)
  const index = ((day % dailyCatalog.length) + dailyCatalog.length) % dailyCatalog.length
  const holiday = holidays[dateKey.slice(5)]
  const event = holiday ?? dailyCatalog[index]
  const copy = event.copy[locale]
  return {
    id: event.id,
    dateKey,
    kind: holiday ? 'holiday' : 'daily',
    title: copy.title,
    invitation: copy.invitations[characterId],
    // Detached tuples keep caller draft edits from mutating the static catalog.
    choices: [...copy.choices],
    prompts: [...copy.prompts],
  }
}
