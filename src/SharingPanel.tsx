import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ConfirmedMemory } from './chatService'
import { characters, type CharacterId } from './data'
import { defaultCardText, downloadCard, invitationLink, renderMemoryCard, shareCard } from './sharing'
import { translate, useI18n, type Locale } from './i18n'
import './sharing.css'

export function InvitePanel({ role, close }: { role: CharacterId; close: () => void }) {
  const { t } = useI18n()
  const [selected, setSelected] = useState(role)
  const [result, setResult] = useState('')
  let link = ''; try { link = invitationLink(selected) } catch { /* Native/file origins cannot be shared as web invitations. */ }
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setResult('邀请链接已复制') }
    catch { setResult('无法自动复制，请长按或选中下方链接复制') }
  }
  const share = async () => {
    try { await navigator.share({ title: t('认识 Aily'), text: t('来认识这位 AI 角色，按自己的节奏开始一个故事。'), url: link }); setResult('邀请已交给系统分享') }
    catch (error) { setResult(error instanceof Error && error.name === 'AbortError' ? '已取消分享' : '无法系统分享，请复制链接') }
  }
  return <section className="sharing-panel screen" aria-label={t('邀请朋友')}><button className="secondary" onClick={close}>{t('返回')}</button><div className="glass sharing-box"><h2>{t('邀请朋友认识 Aily')}</h2><p>{t('分享一个开始，不分享你的私人故事。')}</p><label>{t('推荐角色')}<select value={selected} onChange={event => { setSelected(event.target.value as CharacterId); setResult('') }}>{characters.map(character => <option key={character.id} value={character.id}>{t(character.name)}</option>)}</select></label><p>{t('链接只包含推荐角色，不含姓名、聊天、回忆或 API Key。朋友仍需完成成年确认与自己的偏好设置。')}</p>{link ? <><label>{t('邀请链接')}<input aria-label={t('邀请链接')} readOnly value={link} onFocus={event => event.target.select()} /></label><div className="sharing-actions"><button onClick={() => void copy()}>{t('复制邀请链接')}</button>{typeof navigator.share === 'function' && <button onClick={() => void share()}>{t('系统分享邀请')}</button>}</div></> : <p role="alert">{t('当前地址不是网页地址，请从部署后的网页邀请朋友。')}</p>}<p>{t('朋友需要能访问同一网页；本机地址只能在本机使用。本原型没有邀请归因、双方奖励或安装追踪，邀请不会改变关系阶段。')}</p>{result && <p role="status">{t(result)}</p>}</div></section>
}

export function InviteLanding({ role, start, dismiss }: { role: CharacterId; start: () => void; dismiss: () => void }) {
  const { t } = useI18n()
  const character = characters.find(item => item.id === role)!
  return <main className="app-shell sharing-landing"><div className="glass sharing-box"><p className="eyebrow">{t('朋友邀请你认识 Aily')}</p><h1>{t(character.name)}</h1><p>{t(character.intro)}</p><p>{t('这是 AI 角色，不是真人或专业医疗服务。邀请链接不会公开邀请者的聊天和回忆，也不会替你接受成年与隐私说明。')}</p><button onClick={start}>{t('认识这位 AI 角色')}</button><button className="secondary" onClick={dismiss}>{t('自己选择角色')}</button></div></main>
}

export function MemoryShareDialog({ memory, close, canExport }: { memory: ConfirmedMemory; close: () => void; canExport: () => boolean }) {
  const { t, locale } = useI18n()
  const [includeText, setIncludeText] = useState(false)
  // Null is the localized stock draft; source text and user edits remain verbatim.
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? translate(defaultCardText, {}, locale)
  const [confirmed, setConfirmed] = useState(false)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [preview, setPreview] = useState('')
  const [renderedText, setRenderedText] = useState<string | null>(null)
  const [loadedPreview, setLoadedPreview] = useState('')
  const [renderedLocale, setRenderedLocale] = useState<Locale | null>(null)
  const previewReady = !!blob && renderedText === text && renderedLocale === locale && loadedPreview === preview
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const locked = useRef(false)
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef(close); closeRef.current = close
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const node = dialogRef.current!
    node.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !locked.current) { event.preventDefault(); closeRef.current() }
      if (event.key !== 'Tab') return
      const targets = [...node.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')]
      const first = targets[0]; const last = targets.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === node)) { event.preventDefault(); first?.focus() }
    }
    node.addEventListener('keydown', keyboard)
    return () => { node.removeEventListener('keydown', keyboard); previous?.focus() }
  }, [])
  useEffect(() => {
    let disposed = false; let url = ''
    setBlob(null); setPreview(''); setRenderedText(null); setRenderedLocale(null); setLoadedPreview(''); setConfirmed(false); setResult('')
    void renderMemoryCard({ role: memory.characterId, text }).then(value => {
      if (disposed) return
      url = URL.createObjectURL(value); setBlob(value); setPreview(url); setRenderedText(text); setRenderedLocale(locale)
    }).catch(() => { if (!disposed) setResult('图片生成失败，请修改文案后重试') })
    return () => { disposed = true; if (url) URL.revokeObjectURL(url) }
  }, [memory.characterId, text, locale])
  const share = async () => {
    if (!blob || !previewReady || !confirmed || locked.current) return
    if (!canExport()) { setConfirmed(false); setResult('这条回忆已到期或不再允许分享，请返回回忆页'); return }
    locked.current = true; setBusy(true); setResult('')
    try { setResult(await shareCard(blob) ? '回忆卡已交给系统分享' : '当前浏览器不支持图片分享，请保存 PNG 后手动分享') }
    catch (error) { setResult(error instanceof Error && error.name === 'AbortError' ? '已取消分享' : '分享未完成，请保存 PNG 后手动分享') }
    finally { locked.current = false; setBusy(false) }
  }
  return createPortal(<div className="memory-modal-overlay"><section ref={dialogRef} tabIndex={-1} className="memory-modal glass sharing-dialog" role="dialog" aria-modal="true" aria-label={t('分享回忆卡')}><h2>{t('分享回忆卡')}</h2><p>{t('默认不带聊天原文、姓名、时间、称呼或附件。卡片使用本机示意图；只导出下方预览，不上传服务器。')}</p><label><input type="checkbox" checked={includeText} disabled={busy} onChange={event => { setIncludeText(event.target.checked); setDraft(event.target.checked ? Array.from(memory.text).slice(0, 120).join('') : null); setConfirmed(false) }} />{t('主动公开这条回忆的文字（最多 120 字）')}</label><label>{t('公开文案')}<textarea aria-label={t('公开文案')} value={text} maxLength={120} disabled={busy} onChange={event => { setDraft(event.target.value); setConfirmed(false) }} /></label><p>{t('请删除姓名、地址等私人信息。此处不提供完备自动脱敏；已经下载或发出的图片无法撤回。')}</p>{preview && <img className="sharing-preview" src={preview} onLoad={() => setLoadedPreview(preview)} alt={t('待分享的回忆卡预览')} />}<label><input type="checkbox" checked={confirmed} disabled={busy || !previewReady} onChange={event => setConfirmed(event.target.checked)} />{t('我已检查预览，同意公开卡片内容')}</label><div className="sharing-actions"><button disabled={!previewReady || !confirmed || busy} onClick={() => void share()}>{t('系统分享图片')}</button><button disabled={!previewReady || !confirmed || busy} onClick={() => { if (!canExport()) { setConfirmed(false); setResult('这条回忆已到期或不再允许分享，请返回回忆页'); return }; downloadCard(blob!); setResult('PNG 已交给浏览器下载，可手动分享') }}>{t('保存 PNG')}</button><button className="secondary" disabled={busy} onClick={close}>{t('取消')}</button></div>{result && <p role="status">{t(result)}</p>}</section></div>, document.body)
}
