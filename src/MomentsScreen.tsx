import { useEffect, useRef, useState } from 'react'
import { Heart, MessageCircle, RefreshCw, Send } from 'lucide-react'
import { characters, type CharacterId } from './data'
import {
  addSocialComment, generateSocialPost, hideSocialPost, respondSocialComment,
  toggleSocialLike, watchSocialFeed, type SocialFeedConfig, type SocialPost,
} from './socialFeed'
import './socialFeed.css'
import { useI18n } from './i18n'

export default function MomentsScreen({ userName, selected, config, onChat }: {
  userName: string
  selected: CharacterId
  config: SocialFeedConfig
  onChat: (characterId: CharacterId, text: string) => void
}) {
  const { t } = useI18n()
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [readError, setReadError] = useState(false)
  const [reload, setReload] = useState(0)
  const [feedRole, setFeedRole] = useState(selected)
  const [commenting, setCommenting] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const operation = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  const currentCharacter = characters.find(character => character.id === feedRole)!
  const rolePosts = posts.filter(post => post.characterId === feedRole)

  useEffect(() => {
    // A parent-selected role starts a fresh view, even during a pending reply.
    // Abort and detach the old operation so its completion cannot clear a new draft.
    operation.current?.abort()
    operation.current = null
    setBusy(null)
    setFeedRole(selected)
    setCommenting(null)
    setDraft('')
    setError(previous => readError ? previous : '')
  }, [selected])

  useEffect(() => {
    mounted.current = true
    const unsubscribe = watchSocialFeed(next => {
      if (!mounted.current) return
      setPosts(next); setReady(true); setReadError(false)
    }, () => {
      if (!mounted.current) return
      setError('本机动态读取失败，请重试。'); setReadError(true)
    })
    return () => {
      mounted.current = false
      unsubscribe()
      operation.current?.abort()
      operation.current = null
    }
  }, [reload])

  const run = async (key: string, action: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(key); setError('')
    try { await action(controller.signal) }
    catch (failure) {
      if (mounted.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : '操作失败，请重试。')
    } finally {
      if (operation.current === controller) {
        operation.current = null
        if (mounted.current) setBusy(null)
      }
    }
  }
  const submit = (post: SocialPost) => {
    const text = draft.trim()
    if (!text) return
    void run(`comment:${post.id}`, async signal => {
      const comment = await addSocialComment(post.id, userName, text)
      if (!mounted.current || signal.aborted) return
      setDraft(''); setCommenting(null)
      await respondSocialComment(post.id, comment.id, { ...config, signal })
    })
  }
  const privateChat = (post: SocialPost, comment?: string, reply?: string) => {
    onChat(post.characterId, `我看到你的动态了：“${post.text}”${comment ? `\n我的评论：“${comment}”` : ''}${reply ? `\n你的回应：“${reply}”` : ''}`)
  }

  return <section className="screen feed">
    <div className="feed-hero"><p>{t('{name}的朋友圈', { name: t(currentCharacter.name) })}</p><span>AI 角色的虚构动态 · 配图为本机示意图</span></div>
    <div className="feed-controls glass">
      <button className="feed-refresh" disabled={!ready || readError || !!busy} onClick={() => void run('generate', signal => generateSocialPost(feedRole, { ...config, signal }))}><RefreshCw size={16} className={busy === 'generate' ? 'spinning' : ''} />{busy === 'generate' ? '正在刷新…' : '刷新'}</button>
      <p>{config.apiKey?.trim() ? '生成与评论回应会发送至已配置的模型服务，仅发送当前任务、动态、评论及互动边界，不读取聊天或记忆。' : '未配置模型：动态和角色回应使用本机演示文案，非 AI 生成。'} 点击刷新时生成，不提供后台发布。动态和互动保存在本机，不包含在聊天备份中；导入或清空聊天会重置。</p>
    </div>
    {error && <div className="feed-error" role="alert">{error}{readError && <button onClick={() => { setError(''); setReady(false); setBusy(null); setReload(value => value + 1) }}>重试读取</button>}</div>}
    {!ready && !readError && <p role="status">正在读取本机动态…</p>}
    {ready && !rolePosts.length && <p>{t('{name}还没有动态，刷新看看吧。', { name: t(currentCharacter.name) })}</p>}
    {rolePosts.map(post => {
      const character = characters.find(item => item.id === post.characterId)!
      return <article className="moment glass" key={post.id}>
        <header><span className="simple-avatar" style={{ '--accent': character.accent } as React.CSSProperties}>{character.avatar}</span><div><strong>{character.name}<small>AI</small></strong><time dateTime={post.createdAt}>{new Date(post.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div><button className="hide-moment" aria-label="隐藏动态" disabled={!!busy} onClick={() => void run(`hide:${post.id}`, () => hideSocialPost(post.id))}>隐藏</button></header>
        <p>{post.text}</p>
        <div className={`moment-visual ${post.visual}`}><span>{post.visual === 'dinner' ? '日常餐桌' : post.visual === 'sky' ? '此刻的天空' : '阅读时光'}</span></div>
        <small className="moment-source">{post.source === 'ai' ? 'AI 生成动态' : '本机演示动态 · 非 AI 生成'} · 虚构配图</small>
        {post.comments.map(comment => <div className="moment-comment" key={comment.id}><strong>{comment.userName}</strong> <span>{comment.text}</span>{comment.reply ? <><p><strong>{character.name}</strong> {comment.reply}</p><small>{comment.replySource === 'ai' ? 'AI 生成回应' : '本机演示回应 · 非 AI 生成'}</small></> : <p role="status">{busy === `comment:${post.id}` || busy === `reply:${comment.id}` ? '角色正在回应…' : '尚未回应，可重试。'}</p>}
          <div className="moment-comment-actions">{!comment.reply && <button disabled={!!busy} onClick={() => void run(`reply:${comment.id}`, signal => respondSocialComment(post.id, comment.id, { ...config, signal }))}>重试回应</button>}<button disabled={!!busy} onClick={() => privateChat(post, comment.text, comment.reply)}>私聊回应</button></div>
        </div>)}
        {commenting === post.id && <form className="comment-box" onSubmit={event => { event.preventDefault(); submit(post) }}><input autoFocus aria-label="评论内容" value={draft} maxLength={500} disabled={!!busy} onChange={event => setDraft(event.target.value)} placeholder="写下评论…"/><button disabled={!!busy || !draft.trim()} type="submit">发送评论</button><button type="button" disabled={!!busy} onClick={() => { setCommenting(null); setDraft('') }}>取消</button></form>}
        <footer><button aria-label={post.liked ? '取消点赞' : '点赞'} aria-pressed={post.liked} className={post.liked ? 'liked' : ''} disabled={!!busy} onClick={() => void run(`like:${post.id}`, () => toggleSocialLike(post.id))}><Heart fill={post.liked ? 'currentColor' : 'none'}/> {post.liked ? 1 : 0}</button><button aria-label="评论" disabled={!!busy} onClick={() => { setCommenting(post.id); setDraft('') }}><MessageCircle/> {post.comments.length}</button><button aria-label={`私聊${character.name}`} disabled={!!busy} onClick={() => privateChat(post)}><Send/></button></footer>
      </article>
    })}
  </section>
}
