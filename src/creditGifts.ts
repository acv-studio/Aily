export const creditGifts = [
  { id:'flower', name:'一朵花', englishName:'A flower', emoji:'🌷', cost:3, description:'把今天的小心意送给 TA。', englishDescription:'A little thought to brighten their day.' },
  { id:'drink', name:'热饮', englishName:'Warm drink', emoji:'☕', cost:5, description:'一起停下来，喝杯暖暖的饮品。', englishDescription:'Pause together over a warm drink.' },
  { id:'lamp', name:'小夜灯', englishName:'Night light', emoji:'🏮', cost:8, description:'留一盏灯，聊一句晚安。', englishDescription:'A little light for a goodnight moment.' },
  { id:'movie', name:'电影邀约', englishName:'Movie invitation', emoji:'🎬', cost:10, description:'聊聊想一起看的电影，开启一个约会话题。', englishDescription:'Start a date-night conversation about a movie.' },
  { id:'travel', name:'旅行明信片', englishName:'Travel postcard', emoji:'💌', cost:10, description:'寄出一张想象中的明信片，聊聊想去的地方。', englishDescription:'An imaginary postcard from somewhere you would love to go.' },
  { id:'album', name:'回忆相册', englishName:'Memory album', emoji:'📷', cost:10, description:'用一小段文字，留住值得记住的片刻。', englishDescription:'Capture a meaningful moment in a short passage.' },
] as const
export type CreditGiftId = typeof creditGifts[number]['id']
export function getCreditGift(id:string){return creditGifts.find(gift=>gift.id===id)}
export function giftMessage(id:CreditGiftId,locale:'zh-CN'|'en'){
  const gift=getCreditGift(id)!
  return locale==='en'?`🎁 Virtual gift: ${gift.englishName} (${gift.cost} points, includes one AI reply).`:`🎁 虚拟礼物：${gift.name}（${gift.cost} 积分，含一次 AI 回应）`
}
export function giftResponseInstruction(id:CreditGiftId,locale:'zh-CN'|'en'){
  const gift=getCreditGift(id)!
  return locale==='en'?`The user sent a virtual ${gift.englishName}. ${gift.englishDescription} Respond naturally in 1–3 sentences. This is not a physical delivery. Do not increase relationship progress, require more gifts, or imply that basic care depends on payment.`:`用户送出了虚拟礼物「${gift.name}」。${gift.description} 请用自然的1–3句话回应，不要声称实物已配送，不提升关系进度，不要求继续送礼，不把基本关心与付费绑定。`
}
