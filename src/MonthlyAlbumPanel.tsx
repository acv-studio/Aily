import { useState } from 'react'
import type { ChatMessage, ConfirmedMemory } from './chatService'
import type { CharacterId } from './data'
import type { MemoryPolicy } from './longMemory'
import { useI18n } from './i18n'
import { albumMonths, albumText, downloadAlbum } from './monthlyAlbum'
import './monthlyAlbum.css'

export default function MonthlyAlbumPanel({ memories, role, policy, messages, privateNames = [], search, category, externalBusy = false }: {
  memories: ConfirmedMemory[]; role: CharacterId; policy: MemoryPolicy; messages: ChatMessage[]
  privateNames?: string[]; search: string; category: string; externalBusy?: boolean
}) {
  const { t, locale } = useI18n()
  const months = albumMonths(memories, role, policy, messages)
  const [chosenMonth, setChosenMonth] = useState('')
  const month = months.find(group => group.month === chosenMonth)?.month || months[0]?.month || ''
  const events = (months.find(group => group.month === month)?.events || []).filter(event =>
    (category === 'all' || category === 'relationship') && event.text.toLowerCase().includes(search.trim().toLowerCase()))
  const [excluded, setExcluded] = useState<string[]>([])
  const [includeExcerpts, setIncludeExcerpts] = useState(false)
  const [terms, setTerms] = useState('')
  const [preview, setPreview] = useState<{ text: string; fingerprint: string } | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const locked = busy || externalBusy
  const selected = events.filter(event => !excluded.includes(event.id))
  const text = albumText(month, role, selected, includeExcerpts, [...privateNames, ...terms.split(/[\n,，]/)], locale)
  // Also invalidate previews when sources/settings change but the default generic output stays identical.
  const fingerprint = JSON.stringify({ month, role, locale, selected, includeExcerpts, terms, privateNames })
  const valid = !!preview && preview.fingerprint === fingerprint
  const reset = () => { setPreview(null); setConfirmed(false); setStatus('') }
  const deliver = async (share: boolean) => {
    if (!valid || !confirmed || locked || !selected.length || !preview) return
    const current = albumMonths(memories, role, policy, messages).find(group => group.month === month)?.events || []
    if (selected.some(event => !current.some(item => item.id === event.id))) {
      reset(); setStatus('共同经历、筛选或设置已变化，请返回调整并重新预览。'); return
    }
    setBusy(true); setStatus('')
    try {
      if (share && typeof navigator.share === 'function') {
        await navigator.share({ title: t('Aily · 月度回忆册'), text: preview.text })
        setStatus('已交给系统分享；是否送达由所选应用决定。')
      } else {
        downloadAlbum(preview.text, month)
        setStatus('已发起下载，可将文本文件分享给朋友；没有上传到云端。')
      }
    } catch (error) {
      setStatus(typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError' ? '已取消分享，未继续导出。' : '分享或下载未完成，请重试或使用下载。')
    } finally { setBusy(false) }
  }
  return <section className="monthly-album" aria-label={t('月度回忆册')}>
    <h2>{t('我们的本月故事')}</h2>
    <p>{t('按确认时间的 UTC 自然月整理，只使用已确认、允许引用的非敏感共同经历；不调用模型或上传。')}</p>
    {!policy.extractionEnabled && <p role="status">{t('自动整理已关闭，月度回忆册不再生成。')}</p>}
    {!events.length && <p className="chat-empty">{t('还没有符合条件的月度共同经历。确认共同事件或调整筛选后再来看看。')}</p>}
    {!!months.length && <label>{t('回忆月份（UTC）')}<select aria-label={t('回忆月份（UTC）')} disabled={locked} value={month} onChange={event => { setChosenMonth(event.target.value); setExcluded([]); reset() }}>{months.map(group => <option key={group.month}>{group.month}</option>)}</select></label>}
    {!!events.length && <>
      <div className="album-cover glass"><span>AILY · {month}</span><h3>{t('本月珍藏了 {count} 件共同经历', { count: selected.length })}</h3><p>{t('一页一页，记住一起走过的日子')}</p><small>{t('文字回忆册 · 非 AI 生成叙事')}</small></div>
      {!preview && <>
        <fieldset disabled={locked}><legend>{t('选择要分享的共同经历（原文仅在本机显示）')}</legend>{events.map(event => <label className="album-event" key={event.id}><input type="checkbox" checked={!excluded.includes(event.id)} onChange={change => { setExcluded(change.target.checked ? excluded.filter(id => id !== event.id) : [...excluded, event.id]); reset() }} /><span>{event.text}</span></label>)}</fieldset>
        <label className="album-choice"><input type="checkbox" disabled={locked} checked={includeExcerpts} onChange={event => { setIncludeExcerpts(event.target.checked); reset() }} />{t('包含脱敏文字摘录（默认不包含）')}</label>
        <p>{t('默认只分享月份与匿名小事条目。勾选摘录后会隐藏常见联系方式、链接、长数字及你的称呼，但不能识别所有姓名、地点或隐私。')}</p>
        {includeExcerpts && <label>{t('额外隐藏的姓名、地点或词语（逗号或换行分隔）')}<textarea disabled={locked} value={terms} maxLength={2000} onChange={event => { setTerms(event.target.value); reset() }} /></label>}
        <button disabled={!selected.length || locked} onClick={() => { setPreview({ text, fingerprint }); setConfirmed(false); setStatus('') }}>{t('预览分享内容')}</button>
      </>}
      {preview && <div className="album-preview glass"><h3>{t('对外分享预览')}</h3><pre>{preview.text}</pre>
        <p>{t('请逐条检查；自动脱敏不是匿名保证。分享文件不会随本机删除或修改而撤回，请自行管理旧副本。')}</p>
        {!valid && <p role="alert">{t('共同经历、筛选或设置已变化，请返回调整并重新预览。')}</p>}
        <label className="album-choice"><input type="checkbox" checked={confirmed} disabled={!valid || locked} onChange={event => setConfirmed(event.target.checked)} />{t('我已检查预览，确认可对外分享')}</label>
        <div className="album-actions"><button disabled={!valid || !confirmed || locked} onClick={() => void deliver(true)}>{t(typeof navigator.share === 'function' ? '分享回忆册' : '分享文件（下载）')}</button><button disabled={!valid || !confirmed || locked} onClick={() => void deliver(false)}>{t('下载回忆册')}</button><button disabled={locked} onClick={reset}>{t('返回调整')}</button></div>
      </div>}
    </>}
    {status && <p role="status">{t(status)}</p>}
  </section>
}
