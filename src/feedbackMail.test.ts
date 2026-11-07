import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
const native = vi.hoisted(() => ({ compose: vi.fn(), platform: 'web', available: false }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.platform !== 'web', getPlatform: () => native.platform, isPluginAvailable: () => native.available }, registerPlugin: () => ({ compose: native.compose }) }))
import { buildFeedbackEmail, composeFeedbackEmail, emptyFeedbackDraft, FEEDBACK_EMAIL, feedbackMailto, isFeedbackDraft } from './feedbackMail'
beforeEach(() => { native.compose.mockReset(); native.platform = 'web'; native.available = false })
afterEach(() => vi.restoreAllMocks())
describe('feedback email contract', () => {
  it.each(['suggestion', 'complaint', 'thanks'] as const)('formats %s to the fixed recipient without changing user content', kind => {
    const draft = { ...emptyFeedbackDraft(), kind, title: '中文 & subject', message: '内容 + % ? & #\n谢谢 💌', replyTo: 'sender@example.com' }
    const email = buildFeedbackEmail(draft, 'zh-CN'), url = feedbackMailto(email)
    expect(FEEDBACK_EMAIL).toBe('1756563255@qq.com')
    expect(url.startsWith('mailto:1756563255@qq.com?')).toBe(true)
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('subject')).toBe(email.subject)
    expect(params.get('body')).toBe(email.body)
    expect(params.get('body')).toContain(draft.message)
    expect(params.has('bcc')).toBe(false)
    expect(email.body).toContain('sender@example.com')
  })
  it('does not turn content or title into recipient/header overrides', () => {
    const email = buildFeedbackEmail({ ...emptyFeedbackDraft(), title: 'x&bcc=other@example.com', message: '?to=other@example.com &subject=wrong' }, 'en')
    const url = feedbackMailto(email), params = new URLSearchParams(url.split('?')[1])
    expect(params.has('bcc')).toBe(false); expect(params.has('to')).toBe(false)
    expect(params.get('subject')).toContain('x&bcc=other@example.com')
  })
  it('rejects blanks, invalid kinds, oversized content, header newlines and invalid reply mail', () => {
    expect(() => buildFeedbackEmail(emptyFeedbackDraft(), 'en')).toThrow()
    expect(() => buildFeedbackEmail({ ...emptyFeedbackDraft(), message: 'x'.repeat(3001) }, 'en')).toThrow()
    expect(() => buildFeedbackEmail({ ...emptyFeedbackDraft(), message: 'ok', title: 'hello\nbcc:other' }, 'en')).toThrow()
    expect(() => buildFeedbackEmail({ ...emptyFeedbackDraft(), message: 'ok', replyTo: 'invalid' }, 'en')).toThrow()
    expect(isFeedbackDraft({ ...emptyFeedbackDraft(), kind: 1 })).toBe(false)
  })
  it('calls only the native composer after explicit submission and preserves cancellation', async () => {
    native.platform = 'ios'; native.available = true; native.compose.mockResolvedValue({ status: 'cancelled' })
    expect(native.compose).not.toHaveBeenCalled()
    const draft = { ...emptyFeedbackDraft(), message: 'Please improve the album' }
    expect(await composeFeedbackEmail(draft, 'en')).toEqual({ status: 'cancelled' })
    expect(native.compose).toHaveBeenCalledExactlyOnceWith(buildFeedbackEmail(draft, 'en'))
    expect(native.compose.mock.calls[0][0]).not.toHaveProperty('recipient')
  })
  it('rejects invalid native outcomes instead of inventing a sent status', async () => {
    native.platform = 'ios'; native.available = true; native.compose.mockResolvedValue({ status: 'delivered' })
    await expect(composeFeedbackEmail({ ...emptyFeedbackDraft(), message: 'ok' }, 'en')).rejects.toMatchObject({ code: 'MAIL_FAILED' })
  })
})
