import { describe, expect, it } from 'vitest'
import { normalizeReplyMode, REPLY_MODES, REPLY_MODE_DESCRIPTIONS, REPLY_MODE_LABELS, REPLY_MODE_PROMPTS } from './replyModes'

describe('reply mode definitions', () => {
  it('preserves valid modes and defaults unknown values to brief', () => {
    for (const mode of REPLY_MODES) expect(normalizeReplyMode(mode)).toBe(mode)
    for (const value of [undefined, null, '', 'DEEP', 'unknown', 1, {}, ['story']]) expect(normalizeReplyMode(value)).toBe('brief')
  })

  it('provides all three labels, descriptions and distinct prompts', () => {
    expect(REPLY_MODES.map(mode => REPLY_MODE_LABELS[mode])).toEqual(['简短陪伴', '深入聊天', '剧情模式'])
    for (const mode of REPLY_MODES) {
      expect(REPLY_MODE_DESCRIPTIONS[mode]).toBeTruthy()
      expect(REPLY_MODE_PROMPTS[mode]).toContain(REPLY_MODE_LABELS[mode])
    }
    expect(new Set(Object.values(REPLY_MODE_PROMPTS)).size).toBe(3)
    expect(REPLY_MODE_PROMPTS.story).toContain('虚构')
    expect(REPLY_MODE_PROMPTS.story).toContain('不声称新增剧情进度')
    expect(REPLY_MODE_PROMPTS.story).toContain('当前及历史中的虚构场景')
    expect(REPLY_MODE_PROMPTS.story).toContain('不是用户现实经历或已确认事实')
    expect(REPLY_MODE_PROMPTS.story).toContain('不据此推断或声称用户的真实记忆')
  })
})
