import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FeedbackApp from './FeedbackApp'
import HomeScreen from './HomeScreen'
import { composeFeedbackEmail, FEEDBACK_DRAFT_KEY } from './feedbackMail'
import { installedExtensionIds, setExtensionInstalled } from './extensionApps'
import { getLocale, setLocale } from './i18n'
vi.mock('./WeatherWidget', () => ({ default: () => <div>Weather fixture</div> }))
vi.mock('./ClockWidget', () => ({ default: () => <div>Clock fixture</div> }))
vi.mock('./feedbackMail', async importOriginal => ({ ...await importOriginal<typeof import('./feedbackMail')>(), composeFeedbackEmail: vi.fn() }))
const previousLocale = getLocale()
beforeEach(() => { localStorage.clear(); setLocale('zh-CN'); vi.mocked(composeFeedbackEmail).mockReset() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); setLocale(previousLocale) })
const fill = (value = '相册整理很好，希望增加视频支持。') => fireEvent.change(screen.getByLabelText('反馈内容'), { target: { value } })
describe('feedback app', () => {
  it('is installed by default on the desktop and opens the real feedback renderer', async () => {
    render(<HomeScreen selected="lu" conversations={{}} openChat={vi.fn()}/>)
    const open = await screen.findByRole('button', { name: /反馈$/ })
    expect(installedExtensionIds()).toContain('feedback')
    fireEvent.click(open)
    expect(screen.getByRole('heading', { name: '反馈' })).toBeInTheDocument()
    expect(screen.getByText('1756563255@qq.com')).toBeInTheDocument()
    expect(composeFeedbackEmail).not.toHaveBeenCalled()
  })
  it('does not reinstall feedback after explicit removal when the desktop reopens', () => {
    const home = render(<HomeScreen selected="lu" conversations={{}} openChat={vi.fn()}/>)
    expect(installedExtensionIds()).toContain('feedback'); home.unmount()
    setExtensionInstalled('feedback', false)
    render(<HomeScreen selected="lu" conversations={{}} openChat={vi.fn()}/>)
    expect(screen.queryByRole('button', { name: /反馈$/ })).toBeNull()
  })
  it('offers all three categories and persists the draft across reopening', () => {
    const view = render(<FeedbackApp locale="zh-CN"/>)
    expect(screen.getByRole('button', { name: '发送反馈' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '吐槽' })); fill('操作有一点卡顿。')
    fireEvent.change(screen.getByLabelText('标题（可选）'), { target: { value: '操作体验' } })
    view.unmount(); render(<FeedbackApp locale="zh-CN"/>)
    expect(screen.getByRole('button', { name: '吐槽' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('反馈内容')).toHaveValue('操作有一点卡顿。')
    expect(screen.getByLabelText('标题（可选）')).toHaveValue('操作体验')
    fireEvent.click(screen.getByRole('button', { name: '感谢' }))
    expect(screen.getByRole('button', { name: '感谢' })).toHaveAttribute('aria-pressed', 'true')
    expect(composeFeedbackEmail).not.toHaveBeenCalled()
  })
  it('opens a composer on submit without claiming an external handoff was sent', async () => {
    vi.mocked(composeFeedbackEmail).mockResolvedValue({ status: 'opened' })
    render(<FeedbackApp locale="zh-CN"/>); fill()
    fireEvent.click(screen.getByRole('button', { name: '发送反馈' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已请求打开邮件应用'))
    expect(screen.getByRole('status')).not.toHaveTextContent('发送成功')
    expect(composeFeedbackEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'suggestion', message: '相册整理很好，希望增加视频支持。' }), 'zh-CN')
  })
  it.each(['cancelled', 'saved'] as const)('keeps feedback after the native composer returns %s', async status => {
    vi.mocked(composeFeedbackEmail).mockResolvedValue({ status })
    render(<FeedbackApp locale="zh-CN"/>); fill('谢谢你的陪伴。')
    fireEvent.click(screen.getByRole('button', { name: '发送反馈' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(status === 'saved' ? '尚未发送' : '已取消发送'))
    expect(screen.getByLabelText('反馈内容')).toHaveValue('谢谢你的陪伴。')
    expect(localStorage.getItem(FEEDBACK_DRAFT_KEY)).toContain('谢谢你的陪伴。')
  })
  it('shows a manual fallback when mail is unavailable and never sends on its own', async () => {
    vi.mocked(composeFeedbackEmail).mockRejectedValue(Object.assign(new Error('No mail account'), { code: 'MAIL_UNAVAILABLE' }))
    render(<FeedbackApp locale="zh-CN"/>); fill('建议增加夜间模式。')
    fireEvent.click(screen.getByRole('button', { name: '发送反馈' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请先配置邮件账户')
    expect((screen.getByLabelText('复制到邮件中发送') as HTMLTextAreaElement).value).toContain('1756563255@qq.com')
    expect(screen.getByLabelText('反馈内容')).toHaveValue('建议增加夜间模式。')
    expect(composeFeedbackEmail).toHaveBeenCalledOnce()
  })
  it('prevents duplicate submissions while composing and after the same draft is queued', async () => {
    let finish!: (result: { status: 'sent' }) => void
    vi.mocked(composeFeedbackEmail).mockReturnValue(new Promise(resolve => { finish = resolve }))
    render(<FeedbackApp locale="zh-CN"/>); fill('感谢开发者。')
    const form = screen.getByLabelText('反馈内容').closest('form')!
    fireEvent.submit(form); fireEvent.submit(form)
    expect(composeFeedbackEmail).toHaveBeenCalledOnce()
    finish({ status: 'sent' })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('最终送达以邮件服务为准'))
    expect(screen.getByRole('button', { name: '已交给系统邮箱' })).toBeDisabled()
    fireEvent.submit(form)
    expect(composeFeedbackEmail).toHaveBeenCalledOnce()
    fill('再加一个建议。')
    expect(screen.getByRole('button', { name: '发送反馈' })).toBeEnabled()
  })
  it('blocks whitespace-only feedback without calling the composer', () => {
    render(<FeedbackApp locale="zh-CN"/>); fill('   ')
    expect(screen.getByRole('button', { name: '发送反馈' })).toBeDisabled()
    fireEvent.submit(screen.getByLabelText('反馈内容').closest('form')!)
    expect(screen.getByRole('alert')).toHaveTextContent('请填写反馈内容')
    expect(composeFeedbackEmail).not.toHaveBeenCalled()
  })
  it('does not overwrite an unreadable existing draft', () => {
    localStorage.setItem(FEEDBACK_DRAFT_KEY, 'invalid existing data')
    render(<FeedbackApp locale="zh-CN"/>); fill('新写的建议。')
    expect(screen.getByRole('alert')).toHaveTextContent('原数据未覆盖')
    expect(localStorage.getItem(FEEDBACK_DRAFT_KEY)).toBe('invalid existing data')
  })
})
