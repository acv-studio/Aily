export type ReplyMode = 'brief' | 'deep' | 'story'

export const REPLY_MODES = ['brief', 'deep', 'story'] as const satisfies readonly ReplyMode[]

export const REPLY_MODE_LABELS: Record<ReplyMode, string> = {
  brief: '简短陪伴',
  deep: '深入聊天',
  story: '剧情模式',
}

export const REPLY_MODE_DESCRIPTIONS: Record<ReplyMode, string> = {
  brief: '简短回应，轻轻陪伴，不急着追问。',
  deep: '更充分地倾听与回应，一起梳理感受。',
  story: '用虚构场景与对话陪伴，不推进共同故事进度。',
}

/** Presentation choices only: these never authorize unsafe content or override boundaries. */
export const REPLY_MODE_PROMPTS: Record<ReplyMode, string> = {
  brief: '回复模式：简短陪伴。通常一到两句，简洁自然，轻轻回应，不连续追问。',
  deep: '回复模式：深入聊天。可用数段充分回应，围绕用户当下感受梳理细节，最多提出一个开放问题；先按支持偏好倾听或安慰，不擅自诊断或强给建议。',
  story: '回复模式：剧情模式。明确标注这是虚构场景，用适量环境描写、动作与角色对话回应；不冒充现实经历，不声称新增剧情进度、解锁章节或保存/新增记忆。当前及历史中的虚构场景、动作和角色对话不是用户现实经历或已确认事实，不据此推断或声称用户的真实记忆。亲密互动仍须明确同意。',
}

export function normalizeReplyMode(value: unknown): ReplyMode {
  return value === 'deep' || value === 'story' || value === 'brief' ? value : 'brief'
}
