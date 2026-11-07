import { useEffect, useRef, useState } from 'react'
import type { AppDataIdentity, AppDataManifest, AppDataPreview, AppDataSelection, AppDataTicket } from './appDataTypes'
import { approveAppDataPreview, discardAppDataPreview, discardAppDataTicket, listAppDataManifests, previewAppData, subscribeAppDataChanges } from './appDataGateway'
import { initializeAppDataProviders } from './appDataProviders'
import { assessUserInput } from './safety'
import { useI18n } from './i18n'
import './appData.css'

type Props = {
  identity: () => AppDataIdentity
  text: string
  modelAvailable: boolean
  send: (options: { text: string; appDataTicket: AppDataTicket; rejectOnFailure: true }) => Promise<void>
  stop: () => void
  close: () => void
}
const selectionKey = (selection: AppDataSelection) => `${selection.appId}/${selection.scope}`
export function appDataServiceLabel(endpoint: string) {
  try { const url = new URL(endpoint, window.location.href); return `${url.origin}${url.pathname}` }
  catch { return 'Invalid model endpoint' }
}

/** No background reads or persistent grants: each preview is a separate user-authorized turn. */
export default function AppDataPanel(props: Props) {
  const { locale } = useI18n()
  const copy = (zh: string, en: string) => locale === 'en' ? en : zh
  const [apps, setApps] = useState<AppDataManifest[]>([])
  const [selection, setSelection] = useState<AppDataSelection[]>([])
  const [text, setText] = useState(() => props.text.trim().slice(0, 300))
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState(''), [to, setTo] = useState('')
  const [preview, setPreview] = useState<AppDataPreview>()
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState<'reading' | 'sending' | null>(null)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const previewRef = useRef<AppDataPreview | undefined>(undefined)
  const ticketRef = useRef<AppDataTicket | undefined>(undefined)
  const sendingRef = useRef(false)
  const disposed = useRef(false)
  const invalidate = () => {
    if (previewRef.current) discardAppDataPreview(previewRef.current)
    previewRef.current = undefined
    setPreview(undefined); setConfirmed(false)
  }
  const currentIdentity = props.identity()
  const identityKey = JSON.stringify(currentIdentity)
  const allowed = !currentIdentity.temporary && currentIdentity.role === currentIdentity.primaryId
  useEffect(() => {
    disposed.current = false
    const refresh = () => {
      controller.current?.abort()
      invalidate()
      try {
        const next = listAppDataManifests()
        setApps(next)
        setSelection(previous => previous.filter(selected => next.some(app => app.id === selected.appId && app.scopes.some(scope => scope.id === selected.scope))))
      } catch { setError(copy('应用目录读取失败，请关闭后重试。', 'Could not read the app catalog. Close and retry.')) }
    }
    try { initializeAppDataProviders(); setApps(listAppDataManifests()) }
    catch { setError(copy('应用数据接口初始化失败，请关闭后重试。', 'Could not initialize app data providers. Close and retry.')) }
    const unsubscribe = subscribeAppDataChanges(refresh)
    return () => {
      disposed.current = true; unsubscribe(); controller.current?.abort()
      if (sendingRef.current) props.stop()
      if (previewRef.current) discardAppDataPreview(previewRef.current)
      if (ticketRef.current) discardAppDataTicket(ticketRef.current)
    }
  }, [])
  useEffect(() => { controller.current?.abort(); invalidate() }, [identityKey])
  const change = (work: () => void) => { controller.current?.abort(); invalidate(); setError(''); work() }
  const toggle = (appId: string, scope: string) => change(() => {
    const item = { appId, scope }, key = selectionKey(item)
    setSelection(previous => previous.some(value => selectionKey(value) === key) ? previous.filter(value => selectionKey(value) !== key) : [...previous, item])
  })
  const read = async () => {
    if (busy || !allowed) return
    invalidate(); setError('')
    if (!text.trim() || selection.length === 0 || selection.length > 20) { setError(copy('请填写问题，并选择 1–20 个数据范围。', 'Enter a question and select 1–20 data scopes.')); return }
    if (from && to && from >= to) { setError(copy('结束日期须晚于开始日期（不含结束当天）。', 'End date must follow the start date (end day excluded).')); return }
    if (assessUserInput(text)) { setError(copy('此问题不适合读取个人应用数据，请返回普通聊天获取安全支持。', 'Do not attach personal app data to this request. Return to regular chat for safety support.')); return }
    const request = new AbortController(); controller.current = request; setBusy('reading')
    try {
      const result = await previewAppData(selection, { text: text.trim(), limit: 20, ...(search.trim() ? { search: search.trim() } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }, props.identity(), request.signal)
      if (disposed.current || request.signal.aborted) { discardAppDataPreview(result); return }
      previewRef.current = result; setPreview(result)
    } catch {
      if (!disposed.current) setError(copy('未能完成读取，数据、安装状态或会话可能已变化。请检查选择后重新预览。', 'Read did not complete. Data, installation or session may have changed. Check your selection and preview again.'))
    } finally { if (!disposed.current) setBusy(null); if (controller.current === request) controller.current = null }
  }
  const send = async () => {
    if (!preview || !confirmed || busy || !allowed || !props.modelAvailable) return
    setBusy('sending'); setError('')
    let ticket: AppDataTicket | undefined
    try {
      ticket = approveAppDataPreview(preview); ticketRef.current = ticket
      sendingRef.current = true
      await props.send({ text: text.trim(), appDataTicket: ticket, rejectOnFailure: true })
      sendingRef.current = false
      if (!disposed.current) props.close()
    } catch {
      if (!disposed.current) { invalidate(); setError(copy('本次发送未完成。授权不会复用，请重新读取预览；若请求已发出，无法撤回服务端收到的数据。', 'Send did not complete. Authorization will not be reused: preview again. Data already received by the service cannot be recalled.')) }
    } finally { sendingRef.current = false; if (ticket) discardAppDataTicket(ticket); ticketRef.current = undefined; if (!disposed.current) setBusy(null) }
  }
  const cancel = () => { controller.current?.abort(); if (busy === 'sending') props.stop(); invalidate(); props.close() }
  const status = (value: string) => ({ ok: copy('已读取', 'Read'), empty: copy('没有已保存记录', 'No saved records'), unsupported: copy('暂无持久数据接口', 'No persistent data interface'), unavailable: copy('读取不可用，已跳过', 'Unavailable, skipped'), 'invalid-data': copy('数据格式异常，已跳过', 'Invalid data, skipped') })[value] || value
  return <section className="app-data-panel" aria-label={copy('主 Bot 应用数据', 'Main Bot app data')}>
    <p className="app-data-notice">{copy('只读取你勾选的已保存数据。点击预览仅在本机读取；再次确认才会发送给模型。新安装应用不会自动获权，未保存草稿、图片和音频内容不会发送。', 'Read only selected saved data. Preview stays on this device; a second confirmation sends it to the model. New apps are never auto-authorized. Unsaved drafts, image and audio contents are excluded.')}</p>
    {!allowed && <p role="alert">{copy('仅主 Bot 的普通会话可读取应用数据；临时会话不会读取。', 'Only the main Bot in regular chat can read app data. Temporary chat never reads it.')}</p>}
    <label>{copy('要问主 Bot 的问题', 'Question for the main Bot')}<textarea maxLength={300} value={text} disabled={!!busy} onChange={event => change(() => setText(event.target.value))} placeholder={copy('例如：帮我整理本月收支和冰箱库存', 'For example: summarize my monthly spending and pantry')} /></label>
    <label>{copy('记录关键词筛选（可选，不填则读取范围内全部记录）', 'Record keyword filter (optional; blank includes all records in range)')}<input type="text" maxLength={100} value={search} disabled={!!busy} onChange={event => change(() => setSearch(event.target.value))} /></label>
    <div className="app-data-dates"><label>{copy('开始日期（可选）', 'Start date (optional)')}<input type="date" value={from} disabled={!!busy} onChange={event => change(() => setFrom(event.target.value))} /></label><label>{copy('结束日期（不含当天，可选）', 'End date (exclusive, optional)')}<input type="date" value={to} disabled={!!busy} onChange={event => change(() => setTo(event.target.value))} /></label></div>
    <p className="app-data-muted">{copy('日期筛选适用于有日期的记录；库存、衣物、通讯录等为当前已保存状态。', 'Date filters apply to dated records. Pantry, clothing and contacts reflect current saved state.')}</p>
    <div className="app-data-catalog">{apps.map(app => <fieldset key={app.id} disabled={!!busy || !allowed}>
      <legend>{locale === 'en' ? app.english : app.name}</legend>
      {app.scopes.length ? app.scopes.map(scope => <label className="app-data-scope" key={scope.id}><input type="checkbox" checked={selection.some(value => value.appId === app.id && value.scope === scope.id)} onChange={() => toggle(app.id, scope.id)} /><span>{locale === 'en' ? scope.english : scope.name}{scope.sensitive && <small>{copy('含个人信息 · 仅本次许可', 'Personal data · this turn only')}</small>}</span></label>) : <p className="app-data-muted">{copy('当前没有可读取的持久业务记录。', 'No readable persistent business records yet.')}</p>}
    </fieldset>)}</div>
    <div className="app-data-actions"><button type="button" disabled={!!busy || !allowed || !selection.length} onClick={() => void read()}>{busy === 'reading' ? copy('正在本机读取…', 'Reading locally…') : copy('本机读取并预览', 'Read and preview locally')}</button><button type="button" onClick={cancel}>{busy === 'sending' ? copy('停止并关闭', 'Stop and close') : copy('取消并关闭', 'Cancel and close')}</button></div>
    {preview && <div className="app-data-preview" aria-label={copy('应用数据预览', 'App data preview')}>
      <h3>{copy('将发送的数据', 'Data to send')}</h3>
      {preview.views.map(view => <article key={`${view.appId}/${view.scope}`}><h4>{locale === 'en' ? view.english : view.name} · {view.scope}</h4><p>{status(view.result.status)} · {new Date(view.readAt).toLocaleString(locale)}{view.result.truncated && ` · ${copy('结果有截断，不代表全部明细', 'Truncated, not all details')}`}</p><pre>{JSON.stringify({ summary: view.result.summary, records: view.result.records }, null, 2)}</pre></article>)}
      <p>{copy('发送到：', 'Send to: ')}<strong>{appDataServiceLabel(currentIdentity.endpoint)}</strong> · {currentIdentity.model}</p>
      <p className="app-data-notice">{copy('问题、近期聊天及既有允许召回的记忆也会按原聊天规则发送。应用数据原文不另存入聊天；生成的回答会保存在本机，但不会进入之后的模型上下文、摘要或自动记忆。已发送的数据无法撤回，模型服务有自己的留存政策。', 'Your question, recent chat and eligible memories still follow normal chat rules. App source data is not separately stored in chat. The answer is saved locally, but excluded from later model context, summaries and automatic memories. Sent data cannot be recalled; the service has its own retention policy.')}</p>
      <label className="app-data-consent"><input type="checkbox" checked={confirmed} disabled={!!busy || !allowed} onChange={event => setConfirmed(event.target.checked)} />{copy('我已检查预览，允许向上述模型发送这些数据，仅限本次。', 'I reviewed this preview and allow these data to be sent to this model for this turn only.')}</label>
      {!props.modelAvailable && <p role="status">{copy('当前是演示模式。预览保留在本机，请先配置模型连接再重新预览。', 'Demo mode: preview stays local. Configure a model connection, then preview again.')}</p>}
      <button type="button" disabled={!confirmed || !!busy || !allowed || !props.modelAvailable} onClick={() => void send()}>{busy === 'sending' ? copy('正在发送并生成回答…', 'Sending and generating…') : copy('仅本次授权并询问主 Bot', 'Authorize this turn and ask the main Bot')}</button>
    </div>}
    {error && <p role="alert" className="app-data-error">{error}</p>}
  </section>
}
