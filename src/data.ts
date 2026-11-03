export type CharacterId = 'lu' | 'chen' | 'gu'

export interface Character {
  id: CharacterId
  name: string
  title: string
  status: string
  intro: string
  quote: string
  accent: string
  avatar: string
}

export const characters: Character[] = [
  {
    id: 'lu', name: '陆听澜', title: '温柔年上 · 行动派', status: '刚结束训练',
    intro: '话不多，但会把你说过的小事一件件放在心上。', quote: '外面降温了，外套带了吗？', accent: '#8ee7c4', avatar: '澜',
  },
  {
    id: 'chen', name: '陈奕恒', title: '对抗路 · 年下恋人', status: '正在点外卖',
    intro: '嘴硬、爱逗你，也总会用行动把没说出口的话补上。', quote: '这么晚还没吃？地址没变吧。', accent: '#ffc38f', avatar: '奕',
  },
  {
    id: 'gu', name: '顾辰泽', title: '克制强势 · 边界清晰', status: '正在阅读',
    intro: '直接、笃定。每一次靠近，都建立在清晰同意之上。', quote: '先告诉我，今天需要陪伴还是答案？', accent: '#c4a7ff', avatar: '泽',
  },
]

export const starterMessages = [
  { id: 1, from: 'character', text: '回来了？', time: '22:08' },
  { id: 2, from: 'character', text: '你上次说周五要交的方案，今天顺利吗？', time: '22:08', memory: true },
  { id: 3, from: 'user', text: '交完啦，比想象中顺利', time: '22:09' },
  { id: 4, from: 'character', text: '那就好。答应你的庆祝，没忘。', time: '22:09' },
]

export const memories = [
  { date: '今天', title: '终于交完的方案', detail: '你松了口气，他还记得那句“周五要交”。', icon: '✦', color: '#8ee7c4' },
  { date: '10月 26日', title: '第一次一起做晚饭', detail: '番茄炒蛋有点甜，但你们都说刚刚好。', icon: '⌁', color: '#ffc38f' },
  { date: '10月 20日', title: '我们认识的第一天', detail: '“先别急着介绍自己，你今天过得好吗？”', icon: '○', color: '#c4a7ff' },
]
