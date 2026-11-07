import { Capacitor, registerPlugin } from '@capacitor/core'

export const FEEDBACK_EMAIL = '1756563255@qq.com'
export const FEEDBACK_DRAFT_KEY = 'aily.ext.feedback.v1'
export const FEEDBACK_MAX_LENGTH = 3000
export type FeedbackKind = 'suggestion' | 'complaint' | 'thanks'
export type FeedbackDraft = { kind: FeedbackKind; title: string; message: string; replyTo: string }
export type FeedbackMailResult = { status: 'sent' | 'saved' | 'cancelled' | 'opened' }
interface FeedbackMailPlugin { compose(options: { subject: string; body: string }): Promise<FeedbackMailResult> }
const mail = registerPlugin<FeedbackMailPlugin>('FeedbackMail')
export const emptyFeedbackDraft = (): FeedbackDraft => ({ kind: 'suggestion', title: '', message: '', replyTo: '' })
export function isFeedbackDraft(value: unknown): value is FeedbackDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Record<string, unknown>
  return typeof draft.kind === 'string' && ['suggestion', 'complaint', 'thanks'].includes(draft.kind) && typeof draft.title === 'string' && draft.title.length <= 80 && typeof draft.message === 'string' && draft.message.length <= FEEDBACK_MAX_LENGTH && typeof draft.replyTo === 'string' && draft.replyTo.length <= 254
}
export function buildFeedbackEmail(draft: FeedbackDraft, locale: string): { subject: string; body: string } {
  if (!isFeedbackDraft(draft) || !draft.message.trim() || /[\r\n\v\f\u0085\u2028\u2029]/.test(draft.title)) throw Object.assign(new Error('Invalid feedback'), { code: 'INVALID_FEEDBACK' })
  const replyTo = draft.replyTo.trim()
  if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) throw Object.assign(new Error('Invalid reply email'), { code: 'INVALID_REPLY_EMAIL' })
  const en = locale === 'en'
  const kind = en ? ({ suggestion: 'Suggestion', complaint: 'Complaint', thanks: 'Thanks' })[draft.kind] : ({ suggestion: '建议', complaint: '吐槽', thanks: '感谢' })[draft.kind]
  const title = draft.title.trim()
  return {
    subject: `[Aily ${en ? 'Feedback' : '反馈'}] ${kind}${title ? ` · ${title}` : ''}`,
    body: [en ? `Feedback type: ${kind}` : `反馈类型：${kind}`, ...(title ? [en ? `Title: ${title}` : `标题：${title}`] : []), '', draft.message.trim(), '', ...(replyTo ? [en ? `Reply email: ${replyTo}` : `回复邮箱：${replyTo}`] : []), en ? 'Sent by the Aily feedback app. No chat history or media is attached.' : '来自 Aily 反馈应用。未附带聊天记录或媒体文件。'].join('\r\n'),
  }
}
export function feedbackMailto(email: { subject: string; body: string }): string {
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`
}
export async function composeFeedbackEmail(draft: FeedbackDraft, locale: string): Promise<FeedbackMailResult> {
  const email = buildFeedbackEmail(draft, locale)
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('FeedbackMail')) {
    const result = await mail.compose(email)
    if (!result || !['sent', 'saved', 'cancelled', 'opened'].includes(result.status)) throw Object.assign(new Error('Unexpected mail result'), { code: 'MAIL_FAILED' })
    return result
  }
  // Android / web hand off to the configured mail app. This is not a delivery receipt.
  window.location.assign(feedbackMailto(email))
  return { status: 'opened' }
}
