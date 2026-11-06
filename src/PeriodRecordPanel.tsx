import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from './i18n'
import { addPeriodRecord, deletePeriodRecord, loadPeriodRecords, PeriodRecordError, periodToday, validatePeriodRecord, type PeriodRecord } from './periodRecords'
import './periodRecords.css'

/** Content only: the chat's parent owns the modal and its focus/close behavior. */
export default function PeriodRecordPanel({ temporary = false, onSaved }: { temporary?: boolean; onSaved?: (record: PeriodRecord) => void | Promise<void> }) {
  const { t } = useI18n()
  const id = useId()
  const mounted = useRef(false)
  const temporaryRef = useRef(temporary)
  temporaryRef.current = temporary
  const pending = useRef(false)
  const [records, setRecords] = useState<PeriodRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    let alive = true
    setLoading(true); setLoadError(false); setError(''); setResult('')
    void loadPeriodRecords().then(value => {
      if (alive) { setRecords(value); setLoading(false) }
    }).catch(() => { if (alive) { setLoadError(true); setLoading(false) } })
    return () => { alive = false }
  }, [revision])
  useEffect(() => { setConfirmDelete(null); setResult(''); setError('') }, [temporary])
  const locked = temporary || loading || loadError || busy
  const mutate = async (remove?: string) => {
    if (!mounted.current || temporaryRef.current || pending.current || loading || loadError) return
    if (!remove) {
      const invalid = validatePeriodRecord({ startDate, endDate, note }, records)
      if (invalid) { setError(invalid); setResult(''); return }
    }
    pending.current = true; setBusy(true); setError(''); setResult('')
    const options = { canWrite: () => mounted.current && !temporaryRef.current }
    try {
      const updated = remove ? await deletePeriodRecord(remove, options) : await addPeriodRecord({ startDate, endDate, note }, options)
      if (mounted.current) {
        setRecords(updated); setConfirmDelete(null)
        if (!remove) { setStartDate(''); setEndDate(''); setNote('') }
        if (!temporaryRef.current) { setResult(remove ? '记录已删除。' : '经期记录已保存在本机。'); if (!remove) void onSaved?.({ startDate, endDate: endDate || undefined, note: note.trim() || undefined }) }
      }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof PeriodRecordError ? failure.translationKey : remove ? '删除未完成，请重试；记录仍保留。' : '经期记录未保存，请检查本机存储后重试。')
    } finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  return <section className="period-record-panel" aria-label={t('经期记录')} aria-busy={loading || busy}>
    <h2>{t('经期记录')}</h2>
    <p id={`${id}-privacy`} className="period-record-panel__explanation">{t('记录仅保存在本机，不发送到聊天、记忆或 AI 模型，不包含在聊天备份中；清空本机资料时一并删除。')}</p>
    <p>{t('仅记录你填写的日期，不预测经期或提供医疗建议。日期按此设备的本地日历填写。')}</p>
    {temporary && <p role="status" className="period-record-panel__notice">{t('临时会话中仅可查看，不能新增或删除本机经期记录。')}</p>}
    {loading && <p role="status">{t('正在读取经期记录…')}</p>}
    {loadError && <div role="alert"><p>{t('无法读取经期记录，请重试；未覆盖已有记录。')}</p><button type="button" onClick={() => setRevision(value => value + 1)}>{t('重试')}</button></div>}
    <form noValidate aria-describedby={`${id}-privacy`} onSubmit={event => { event.preventDefault(); void mutate() }}>
      <fieldset disabled={locked}>
        <legend>{t('添加经期记录')}</legend>
        <div className="period-record-panel__dates">
          <label htmlFor={`${id}-start`}>{t('开始日期')}<input id={`${id}-start`} type="date" required max={periodToday()} value={startDate} onChange={event => { setStartDate(event.target.value); setError(''); setResult('') }} /></label>
          <label htmlFor={`${id}-end`}>{t('结束日期（选填）')}<input id={`${id}-end`} type="date" min={startDate || undefined} max={periodToday()} value={endDate} onChange={event => { setEndDate(event.target.value); setError(''); setResult('') }} /></label>
        </div>
        <label htmlFor={`${id}-note`}>{t('备注（选填，最多 200 字）')}<textarea id={`${id}-note`} maxLength={200} rows={3} value={note} onChange={event => { setNote(event.target.value); setError(''); setResult('') }} /></label>
        <button type="submit">{t(busy ? '正在保存…' : '保存经期记录')}</button>
      </fieldset>
    </form>
    {error && <p role="alert">{t(error)}</p>}
    {result && <p role="status">{t(result)}</p>}
    <h3>{t('历史记录')}</h3>
    {!loading && !loadError && (records.length ? <ul className="period-record-panel__history">{records.map(record => <li key={record.startDate}>
      <div><time dateTime={record.startDate}>{record.startDate}</time><span> — </span>{record.endDate ? <time dateTime={record.endDate}>{record.endDate}</time> : <span>{t('未填写结束日期')}</span>}</div>
      {record.note && <p className="period-record-panel__note">{record.note}</p>}
      {confirmDelete === record.startDate && !temporary ? <div className="period-record-panel__confirmation" role="group" aria-label={t('确认删除经期记录')}>
        <p>{t('确定删除这条经期记录？此操作无法撤销。')}</p>
        <button type="button" disabled={locked} onClick={() => void mutate(record.startDate)}>{t('确认删除')}</button>
        <button type="button" disabled={busy} onClick={() => setConfirmDelete(null)}>{t('取消')}</button>
      </div> : <button type="button" disabled={locked} aria-label={t('删除 {date} 的经期记录', { date: record.startDate })} onClick={() => { setConfirmDelete(record.startDate); setError(''); setResult('') }}>{t('删除记录')}</button>}
    </li>)}</ul> : <p>{t('还没有经期记录。')}</p>)}
  </section>
}
