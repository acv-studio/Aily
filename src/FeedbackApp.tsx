import { useRef, useState } from 'react'
import { Copy, Heart, Lightbulb, Mail, MessageCircle, Send } from 'lucide-react'
import type { Locale } from './i18n'
import { buildFeedbackEmail, composeFeedbackEmail, emptyFeedbackDraft, FEEDBACK_DRAFT_KEY, FEEDBACK_EMAIL, FEEDBACK_MAX_LENGTH, isFeedbackDraft, type FeedbackDraft, type FeedbackKind, type FeedbackMailResult } from './feedbackMail'
import './feedbackApp.css'

function readDraft(): { draft: FeedbackDraft; failed: boolean } {
  try {
    const raw = localStorage.getItem(FEEDBACK_DRAFT_KEY)
    if (!raw) return { draft: emptyFeedbackDraft(), failed: false }
    const draft: unknown = JSON.parse(raw)
    if (!isFeedbackDraft(draft)) throw new Error('Invalid feedback draft')
    return { draft, failed: false }
  } catch { return { draft: emptyFeedbackDraft(), failed: true } }
}
export default function FeedbackApp({ locale }: { locale: Locale }) {
  const en = locale === 'en', copy = (zh: string, english: string) => en ? english : zh
  const [state, setState] = useState(readDraft), [saveFailed, setSaveFailed] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('')
  const [manual, setManual] = useState(false), [sentDraft, setSentDraft] = useState('')
  const working = useRef(false)
  const draft = state.draft
  const kinds: { id: FeedbackKind; label: string; hint: string; icon: typeof Heart }[] = [
    { id: 'suggestion', label: copy('建议', 'Suggestion'), hint: copy('有什么可以做得更好？', 'What could we improve?'), icon: Lightbulb },
    { id: 'complaint', label: copy('吐槽', 'Complaint'), hint: copy('哪里让你不开心了？尽管说。', 'What frustrated you? Let us know.'), icon: MessageCircle },
    { id: 'thanks', label: copy('感谢', 'Thanks'), hint: copy('哪一刻让你觉得暖心？', 'What made your day a little better?'), icon: Heart },
  ]
  const update = (patch: Partial<FeedbackDraft>) => {
    const next = { ...draft, ...patch }
    setState(previous => ({ ...previous, draft: next })); setStatus(''); setError(''); setSentDraft('')
    if (state.failed) return // Do not overwrite unreadable preexisting data.
    try { localStorage.setItem(FEEDBACK_DRAFT_KEY, JSON.stringify(next)); setSaveFailed(false) }
    catch { setSaveFailed(true) }
  }
  const messageFor = (result: FeedbackMailResult) => ({
    sent: copy('已交给系统邮件发送，最终送达以邮件服务为准。反馈草稿仍保留。', 'Submitted to your mail app for sending. Delivery depends on the mail service; your feedback draft is kept.'),
    saved: copy('已保存到系统邮件草稿，尚未发送；这里的内容也已保留。', 'Saved as a mail draft, not sent. Your feedback content is also kept here.'),
    cancelled: copy('已取消发送，反馈内容已保留，可以继续修改。', 'Sending cancelled. Your feedback is kept for editing.'),
    opened: copy('已请求打开邮件应用，请在邮件中确认发送；如果没有打开，请先配置邮箱或使用手动发送。', 'Requested your mail app. Confirm sending there; if it did not open, configure a mail app or use manual sending.'),
  })[result.status]
  const send = async () => {
    if (working.current || sentDraft === JSON.stringify(draft)) return
    setError(''); setStatus('')
    try { buildFeedbackEmail(draft, locale) } catch (failure) {
      setError(copy(failure && typeof failure === 'object' && 'code' in failure && failure.code === 'INVALID_REPLY_EMAIL' ? '请填写有效的回复邮箱，或留空。' : '请填写反馈内容（最多 3000 字），标题不能包含换行。', failure && typeof failure === 'object' && 'code' in failure && failure.code === 'INVALID_REPLY_EMAIL' ? 'Enter a valid reply email, or leave it empty.' : 'Enter feedback (maximum 3000 characters); title must be a single line.')); return
    }
    working.current = true; setBusy(true)
    try {
      const result = await composeFeedbackEmail(draft, locale)
      setStatus(messageFor(result)); if (result.status === 'sent') setSentDraft(JSON.stringify(draft))
    } catch {
      setError(copy('无法打开或使用系统邮箱，请先配置邮件账户；也可以复制反馈内容，手动发送到下方邮箱。当前填写内容仍保留，请在关闭前复制。', 'Unable to use the mail app. Configure a mail account, or copy your feedback and send it manually to the address below. Your current text is kept; copy it before closing.')); setManual(true)
    } finally { working.current = false; setBusy(false) }
  }
  let emailText = ''
  try { const email = buildFeedbackEmail(draft, locale); emailText = `${copy('收件人', 'To')}: ${FEEDBACK_EMAIL}\n${copy('主题', 'Subject')}: ${email.subject}\n\n${email.body}` } catch { /* Manual preview appears only for valid completed feedback. */ }
  const copyFeedback = async () => {
    if (!emailText || working.current) return
    setError(''); setStatus('')
    try { await navigator.clipboard.writeText(emailText); setStatus(copy('反馈内容已复制，请粘贴到邮件中发送。', 'Feedback copied. Paste it into your email to send.')) }
    catch { setManual(true); setError(copy('当前无法自动复制，请长按下方文本手动复制。', 'Automatic copying is unavailable. Select the text below and copy it manually.')) }
  }
  const currentKind = kinds.find(kind => kind.id === draft.kind)!
  return <section className="feedback-app" aria-label={copy('用户反馈', 'User feedback')}>
    <div className="feedback-intro"><span className="feedback-intro-icon"><Mail size={28}/></span><div><h3>{copy('想说的话，我们都想听', 'We would love to hear from you')}</h3><p>{copy('建议、吐槽，或者一句谢谢。', 'An idea, a frustration, or a little thank you.')}</p></div></div>
    <p className="feedback-privacy">{copy('只发送你填写的反馈和可选回复邮箱，不自动附带聊天记录、相册、设备标识或账号信息。发送会打开系统邮件，由你确认；发件邮箱由系统邮件账户决定。', 'Only your feedback and optional reply email are included—no chat history, photos, device identifiers or account data. Your mail app opens for you to confirm sending; the sender address comes from your mail account.')}</p>
    {(state.failed || saveFailed) && <p className="feedback-warning" role="alert">{copy(state.failed ? '之前的反馈草稿读取失败，原数据未覆盖。新填写的内容暂时无法保存到本机。' : '草稿未能保存到本机，关闭页面前请复制内容。', state.failed ? 'The previous draft could not be read and has not been overwritten. New text cannot currently be saved locally.' : 'Your draft could not be saved locally. Copy it before closing.')}</p>}
    <form onSubmit={event => { event.preventDefault(); void send() }}>
      <fieldset disabled={busy} className="feedback-fields"><legend>{copy('反馈类型', 'Feedback type')}</legend><div className="feedback-kind-tabs">{kinds.map(kind => { const Icon = kind.icon; return <button key={kind.id} type="button" aria-pressed={draft.kind === kind.id} onClick={() => update({ kind: kind.id })}><Icon size={18}/>{kind.label}</button> })}</div>
        <label>{copy('标题（可选）', 'Title (optional)')}<input value={draft.title} maxLength={80} onChange={event => update({ title: event.target.value })} placeholder={copy('用一句话概括', 'A short summary')}/></label>
        <label>{copy('反馈内容', 'Your feedback')}<textarea required rows={7} value={draft.message} maxLength={FEEDBACK_MAX_LENGTH} onChange={event => update({ message: event.target.value })} placeholder={currentKind.hint}/></label><div className="feedback-count">{draft.message.length} / {FEEDBACK_MAX_LENGTH}</div>
        <label>{copy('回复邮箱（可选）', 'Reply email (optional)')}<input type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" value={draft.replyTo} maxLength={254} onChange={event => update({ replyTo: event.target.value })} placeholder={copy('方便我们回复你，不填也可以', 'For a reply, if you would like one')}/></label>
        <div className="feedback-recipient"><span>{copy('发送给', 'Send to')}</span><code>{FEEDBACK_EMAIL}</code></div>
        <button className="feedback-send" type="submit" disabled={!draft.message.trim() || sentDraft === JSON.stringify(draft)}><Send size={18}/>{busy ? copy('正在打开邮箱…', 'Opening mail…') : sentDraft === JSON.stringify(draft) ? copy('已交给系统邮箱', 'Submitted to mail') : copy('发送反馈', 'Send feedback')}</button>
      </fieldset>
    </form>
    {error && <p role="alert" className="feedback-error">{error}</p>}<p className="feedback-status" role="status" aria-live="polite">{status}</p>
    <div className="feedback-manual-actions"><button disabled={busy || !emailText} type="button" onClick={() => void copyFeedback()}><Copy size={16}/>{copy('复制反馈内容', 'Copy feedback')}</button><button disabled={busy || !emailText} type="button" onClick={() => setManual(!manual)} aria-expanded={manual}>{copy(manual ? '收起手动发送' : '手动发送', manual ? 'Hide manual sending' : 'Send manually')}</button></div>
    {manual && emailText && <label className="feedback-manual-text">{copy('复制到邮件中发送', 'Copy into your mail app')}<textarea readOnly rows={8} value={emailText} onFocus={event => event.currentTarget.select()}/></label>}
    <p className="feedback-storage-note">{copy('草稿只保存在本机，不进入聊天备份。卸载反馈入口会保留草稿；清除应用数据会移除。', 'Drafts stay on-device and are excluded from chat backups. Removing the feedback app keeps drafts; clearing app data removes them.')}</p>
  </section>
}
