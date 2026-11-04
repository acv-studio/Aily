import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MomentsScreen from './MomentsScreen'
import {
  addSocialComment, generateSocialPost, hideSocialPost, respondSocialComment,
  toggleSocialLike, watchSocialFeed, type SocialFeedConfig, type SocialPost,
} from './socialFeed'

vi.mock('./DailyEventCard', () => ({ default: () => <div data-testid="daily-event-card">今日轻量事件</div> }))

vi.mock('./socialFeed', () => ({
  loadSocialFeed: vi.fn(),
  watchSocialFeed: vi.fn(),
  generateSocialPost: vi.fn(),
  toggleSocialLike: vi.fn(),
  addSocialComment: vi.fn(),
  respondSocialComment: vi.fn(),
  hideSocialPost: vi.fn(),
}))

const createdAt = '2026-01-01T12:00:00.000Z'
const fixturePosts = (): SocialPost[] => [
  { id: 'post-lu', characterId: 'lu', text: '今天做了一碗热汤。', visual: 'dinner', createdAt, source: 'demo', liked: false, comments: [] },
  { id: 'post-chen', characterId: 'chen', text: '今天的天空像一幅画。', visual: 'sky', createdAt, source: 'demo', liked: false, comments: [] },
  { id: 'post-gu', characterId: 'gu', text: '给阅读留了半小时。', visual: 'reading', createdAt, source: 'demo', liked: false, comments: [] },
]
let posts: SocialPost[]
let nextFeed: (posts: SocialPost[]) => void
let failFeed: ((error: unknown) => void) | undefined
let unsubscribe = vi.fn<() => void>()
const publish = () => nextFeed(structuredClone(posts))
const article = (index: number) => within(screen.getAllByRole('article')[index])
const openScreen = (config: SocialFeedConfig = {}) => {
  const onChat = vi.fn()
  return { ...render(<MomentsScreen userName="小夏" selected="chen" config={config} onChat={onChat} />), onChat }
}
const writeComment = (index: number, text: string) => {
  fireEvent.click(article(index).getByRole('button', { name: '评论' }))
  fireEvent.change(screen.getByRole('textbox', { name: '评论内容' }), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: '发送评论' }))
}

beforeEach(() => {
  vi.resetAllMocks()
  posts = fixturePosts()
  unsubscribe = vi.fn<() => void>()
  vi.mocked(watchSocialFeed).mockImplementation((next, error) => {
    nextFeed = next
    failFeed = error
    publish()
    return unsubscribe
  })
  vi.mocked(generateSocialPost).mockResolvedValue(undefined)
  vi.mocked(toggleSocialLike).mockImplementation(async postId => {
    const post = posts.find(item => item.id === postId)!
    post.liked = !post.liked
    publish()
  })
  vi.mocked(addSocialComment).mockImplementation(async (postId, userName, text) => {
    const comment = { id: 'comment-new', userName, text, createdAt }
    posts.find(item => item.id === postId)!.comments.push(comment)
    publish()
    return comment
  })
  vi.mocked(respondSocialComment).mockImplementation(async (postId, commentId) => {
    const comment = posts.find(item => item.id === postId)!.comments.find(item => item.id === commentId)!
    comment.reply = '谢谢你的分享，我们可以慢慢聊。'
    comment.replySource = 'demo'
    publish()
  })
  vi.mocked(hideSocialPost).mockImplementation(async postId => {
    posts = posts.filter(post => post.id !== postId)
    publish()
  })
})
afterEach(cleanup)

describe('MomentsScreen social feed interactions', () => {
  it('does not render reminder events in the feed', () => {
    openScreen()
    expect(screen.queryByTestId('daily-event-card')).not.toBeInTheDocument()
    expect(screen.queryByText('今日轻量事件')).not.toBeInTheDocument()
  })

  it('generates for the initially selected role', async () => {
    openScreen()
    fireEvent.click(screen.getByRole('button', { name: '生成动态' }))
    await waitFor(() => expect(generateSocialPost).toHaveBeenCalledExactlyOnceWith('chen', { signal: expect.any(AbortSignal) }))
  })

  it('clears an unsubmitted comment draft when switching local roles', () => {
    openScreen()
    fireEvent.click(article(0).getByRole('button', { name: '评论' }))
    fireEvent.change(screen.getByRole('textbox', { name: '评论内容' }), { target: { value: '还没发出的评论' } })
    fireEvent.click(screen.getByRole('button', { name: '陆听澜' }))
    expect(screen.queryByRole('textbox', { name: '评论内容' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '陈奕恒' }))
    fireEvent.click(article(0).getByRole('button', { name: '评论' }))
    expect(screen.getByRole('textbox', { name: '评论内容' })).toHaveValue('')
    expect(addSocialComment).not.toHaveBeenCalled()
  })

  it('resets local role and draft on selected prop changes, without allowing a stale comment to clear a new draft', async () => {
    let finish!: (comment: { id: string; userName: string; text: string; createdAt: string }) => void
    const pending = new Promise<{ id: string; userName: string; text: string; createdAt: string }>(resolve => { finish = resolve })
    vi.mocked(addSocialComment).mockReturnValueOnce(pending)
    const view = openScreen()
    fireEvent.click(screen.getByRole('button', { name: '顾辰泽' }))
    writeComment(0, '旧角色评论')
    for (const name of ['陆听澜', '陈奕恒', '顾辰泽']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    const onChat = vi.fn()
    view.rerender(<MomentsScreen userName="小夏" selected="lu" config={{}} onChat={onChat} />)
    expect(screen.getByText('陆听澜的朋友圈')).toBeInTheDocument()
    expect(screen.getByText('今天做了一碗热汤。')).toBeInTheDocument()
    expect(screen.queryByText('给阅读留了半小时。')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '评论内容' })).not.toBeInTheDocument()
    fireEvent.click(article(0).getByRole('button', { name: '评论' }))
    fireEvent.change(screen.getByRole('textbox', { name: '评论内容' }), { target: { value: '新角色草稿' } })
    await act(async () => { finish({ id: 'old-comment', userName: '小夏', text: '旧角色评论', createdAt }); await pending })
    expect(screen.getByRole('textbox', { name: '评论内容' })).toHaveValue('新角色草稿')
    expect(respondSocialComment).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '生成动态' }))
    await waitFor(() => expect(generateSocialPost).toHaveBeenCalledExactlyOnceWith('lu', { signal: expect.any(AbortSignal) }))
  })

  it('aborts old generation on selected prop changes and keeps the new generation busy after the old one finishes', async () => {
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    vi.mocked(generateSocialPost).mockReturnValueOnce(pending)
    const view = openScreen()
    fireEvent.click(screen.getByRole('button', { name: '生成动态' }))
    const signal = vi.mocked(generateSocialPost).mock.calls[0][1].signal!
    view.rerender(<MomentsScreen userName="小夏" selected="gu" config={{}} onChat={vi.fn()} />)
    expect(signal.aborted).toBe(true)
    expect(screen.getByText('顾辰泽的朋友圈')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '生成动态' })).toBeEnabled()
    let finishNew!: () => void
    const newPending = new Promise<void>(resolve => { finishNew = resolve })
    vi.mocked(generateSocialPost).mockReturnValueOnce(newPending)
    fireEvent.click(screen.getByRole('button', { name: '生成动态' }))
    await act(async () => { finish(); await pending })
    expect(screen.getByRole('button', { name: '正在生成…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '陈奕恒' })).toBeDisabled()
    expect(generateSocialPost).toHaveBeenNthCalledWith(2, 'gu', { signal: expect.any(AbortSignal) })
    await act(async () => { finishNew(); await newPending })
    expect(screen.getByRole('button', { name: '生成动态' })).toBeEnabled()
  })

  it('initially filters to the selected role and labels its local posts and replies as non-AI demonstrations', () => {
    posts[1].comments.push({ id: 'comment-demo', userName: '小夏', text: '云朵很棒', createdAt, reply: '记得抬头看看天空。', replySource: 'demo' })
    openScreen({ apiKey: '   ' })
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByText('陈奕恒的朋友圈')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '陈奕恒' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('今天的天空像一幅画。')).toBeInTheDocument()
    expect(screen.queryByText('今天做了一碗热汤。')).not.toBeInTheDocument()
    expect(screen.queryByText('给阅读留了半小时。')).not.toBeInTheDocument()
    expect(screen.getByText(/未配置模型：动态和角色回应使用本机演示文案，非 AI 生成/)).toBeInTheDocument()
    expect(screen.getAllByText('本机演示动态 · 非 AI 生成 · 虚构配图')).toHaveLength(1)
    expect(screen.getByText('本机演示回应 · 非 AI 生成')).toBeInTheDocument()
    expect(screen.getByText(/手动生成，不提供后台发布/)).toBeInTheDocument()
    expect(generateSocialPost).not.toHaveBeenCalled()
    expect(respondSocialComment).not.toHaveBeenCalled()
  })

  it('switches local feed filtering and generation target together without changing the parent selection', async () => {
    const config: SocialFeedConfig = { apiKey: 'test-key', endpoint: 'https://model.example/v1', model: 'test-model', onboardingProfile: null }
    const { onChat } = openScreen(config)
    expect(screen.getByRole('button', { name: '陈奕恒' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/生成与评论回应会发送至已配置的模型服务/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '顾辰泽' }))
    expect(screen.getByText('顾辰泽的朋友圈')).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByText('给阅读留了半小时。')).toBeInTheDocument()
    expect(screen.queryByText('今天的天空像一幅画。')).not.toBeInTheDocument()
    expect(screen.queryByText('今天做了一碗热汤。')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '动态角色' })).not.toBeInTheDocument()
    expect(onChat).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '生成动态' }))
    await waitFor(() => expect(generateSocialPost).toHaveBeenCalledExactlyOnceWith('gu', { ...config, signal: expect.any(AbortSignal) }))
    await waitFor(() => expect(screen.getByRole('button', { name: '生成动态' })).toBeEnabled())
    expect(vi.mocked(generateSocialPost).mock.calls[0][1].signal?.aborted).toBe(false)
  })

  it('uses the persistent like API and renders watched liked state after a remount', async () => {
    const view = openScreen()
    fireEvent.click(article(0).getByRole('button', { name: '点赞' }))
    await waitFor(() => expect(article(0).getByRole('button', { name: '取消点赞' })).toBeEnabled())
    expect(toggleSocialLike).toHaveBeenCalledExactlyOnceWith('post-chen')
    expect(article(0).getByRole('button', { name: '取消点赞' })).toHaveAttribute('aria-pressed', 'true')
    view.unmount()
    openScreen()
    expect(article(0).getByRole('button', { name: '取消点赞' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(article(0).getByRole('button', { name: '取消点赞' }))
    await waitFor(() => expect(article(0).getByRole('button', { name: '点赞' })).toBeEnabled())
    expect(toggleSocialLike).toHaveBeenNthCalledWith(2, 'post-chen')
    expect(article(0).getByRole('button', { name: '点赞' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('disables blank or whitespace-only comments without calling either comment API', () => {
    openScreen()
    fireEvent.click(article(0).getByRole('button', { name: '评论' }))
    expect(screen.getByRole('button', { name: '发送评论' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '评论内容' }), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: '发送评论' })).toBeDisabled()
    fireEvent.submit(screen.getByRole('textbox', { name: '评论内容' }).closest('form')!)
    expect(addSocialComment).not.toHaveBeenCalled()
    expect(respondSocialComment).not.toHaveBeenCalled()
  })

  it('adds one trimmed comment then requests and displays the watched role reply', async () => {
    const config = { apiKey: 'test-key', endpoint: 'https://model.example/v1', model: 'test-model' }
    openScreen(config)
    fireEvent.click(screen.getByRole('button', { name: '顾辰泽' }))
    writeComment(0, '  这本书值得读吗？  ')
    await screen.findByText('谢谢你的分享，我们可以慢慢聊。')
    await waitFor(() => expect(article(0).getByRole('button', { name: '评论' })).toBeEnabled())
    expect(addSocialComment).toHaveBeenCalledExactlyOnceWith('post-gu', '小夏', '这本书值得读吗？')
    expect(respondSocialComment).toHaveBeenCalledExactlyOnceWith('post-gu', 'comment-new', { ...config, signal: expect.any(AbortSignal) })
    expect(article(0).getByText('小夏')).toBeInTheDocument()
    expect(article(0).getByRole('button', { name: '评论' })).toHaveTextContent('1')
    expect(screen.queryByRole('textbox', { name: '评论内容' })).not.toBeInTheDocument()
  })

  it('shows a failed reply and retries the same persisted comment without adding a duplicate', async () => {
    vi.mocked(respondSocialComment).mockRejectedValueOnce(new Error('回应服务暂时不可用'))
    openScreen()
    writeComment(0, '云朵很好看')
    expect(await screen.findByRole('alert')).toHaveTextContent('回应服务暂时不可用')
    expect(article(0).getByText('云朵很好看')).toBeInTheDocument()
    expect(article(0).getByText('尚未回应，可重试。')).toBeInTheDocument()
    fireEvent.click(article(0).getByRole('button', { name: '重试回应' }))
    await screen.findByText('谢谢你的分享，我们可以慢慢聊。')
    await waitFor(() => expect(article(0).getByRole('button', { name: '评论' })).toBeEnabled())
    expect(addSocialComment).toHaveBeenCalledTimes(1)
    expect(respondSocialComment).toHaveBeenCalledTimes(2)
    expect(respondSocialComment).toHaveBeenNthCalledWith(2, 'post-chen', 'comment-new', { signal: expect.any(AbortSignal) })
    expect(posts[1].comments).toHaveLength(1)
    expect(article(0).getAllByText('云朵很好看')).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重试回应' })).not.toBeInTheDocument()
  })

  it('starts private chat with the post author, including the exact comment and reply context', () => {
    posts[2].comments.push({ id: 'comment-context', userName: '小夏', text: '你在读什么？', createdAt, reply: '一本散文集。', replySource: 'ai' })
    const { onChat } = openScreen()
    fireEvent.click(screen.getByRole('button', { name: '陆听澜' }))
    fireEvent.click(article(0).getByRole('button', { name: '私聊陆听澜' }))
    expect(onChat).toHaveBeenNthCalledWith(1, 'lu', '我看到你的动态了：“今天做了一碗热汤。”')
    fireEvent.click(screen.getByRole('button', { name: '顾辰泽' }))
    fireEvent.click(article(0).getByRole('button', { name: '私聊回应' }))
    expect(onChat).toHaveBeenNthCalledWith(2, 'gu', '我看到你的动态了：“给阅读留了半小时。”\n我的评论：“你在读什么？”\n你的回应：“一本散文集。”')
    expect(article(0).getByText('AI 生成回应')).toBeInTheDocument()
  })

  it('hides the requested post through the API and reflects its watched removal', async () => {
    openScreen()
    fireEvent.click(article(0).getByRole('button', { name: '隐藏动态' }))
    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())
    expect(hideSocialPost).toHaveBeenCalledExactlyOnceWith('post-chen')
    expect(screen.queryByText('今天的天空像一幅画。')).not.toBeInTheDocument()
    expect(screen.getByText('陈奕恒还没有动态，生成一条吧。')).toBeInTheDocument()
    expect(screen.queryByText('今天做了一碗热汤。')).not.toBeInTheDocument()
    expect(screen.queryByText('给阅读留了半小时。')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '陆听澜' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '陆听澜' }))
    expect(screen.getByText('今天做了一碗热汤。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '顾辰泽' }))
    expect(screen.getByText('给阅读留了半小时。')).toBeInTheDocument()
  })

  it.each(['generate', 'reply'] as const)('unsubscribes the watcher and aborts an in-flight %s on unmount', async kind => {
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    if (kind === 'generate') vi.mocked(generateSocialPost).mockReturnValueOnce(pending)
    else vi.mocked(respondSocialComment).mockReturnValueOnce(pending)
    const view = openScreen()
    if (kind === 'generate') fireEvent.click(screen.getByRole('button', { name: '生成动态' }))
    else writeComment(0, '记得好好吃饭')
    const api = kind === 'generate' ? generateSocialPost : respondSocialComment
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1))
    const signal = kind === 'generate'
      ? vi.mocked(generateSocialPost).mock.calls[0][1].signal!
      : vi.mocked(respondSocialComment).mock.calls[0][2].signal!
    expect(signal.aborted).toBe(false)
    expect(article(0).getByRole('button', { name: '点赞' })).toBeDisabled()
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(signal.aborted).toBe(true)
    await act(async () => { finish(); await pending })
    act(() => { publish(); failFeed?.(new Error('late read failure')) })
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('releases busy controls when reading is retried during a held generation', async () => {
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    vi.mocked(generateSocialPost).mockReturnValueOnce(pending)
    openScreen()
    fireEvent.click(screen.getByRole('button', { name: '生成动态' }))
    const signal = vi.mocked(generateSocialPost).mock.calls[0][1].signal!
    act(() => failFeed?.(new Error('read failure during generation')))
    fireEvent.click(screen.getByRole('button', { name: '重试读取' }))
    expect(signal.aborted).toBe(true)
    expect(screen.getByRole('button', { name: '生成动态' })).toBeEnabled()
    expect(article(0).getByRole('button', { name: '点赞' })).toBeEnabled()
    await act(async () => { finish(); await pending })
    expect(screen.getByRole('button', { name: '生成动态' })).toBeEnabled()
  })

  it('shows read failure, disables generation, and resubscribes on explicit read retry', () => {
    vi.mocked(watchSocialFeed).mockImplementationOnce((next, error) => {
      nextFeed = next
      failFeed = error
      error?.(new Error('storage unavailable'))
      return unsubscribe
    })
    openScreen()
    expect(screen.getByRole('alert')).toHaveTextContent('本机动态读取失败，请重试。')
    expect(screen.getByRole('button', { name: '生成动态' })).toBeDisabled()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试读取' }))
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(watchSocialFeed).toHaveBeenCalledTimes(2)
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '生成动态' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
