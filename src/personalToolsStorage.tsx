import { useEffect, useRef, useState } from 'react'

export type PersonalToolCopy = (zh: string, en: string) => string
export const localToday = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
export const personalToolId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
export const isPersonalRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
export const isPersonalDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
export const isPersonalMonth = (value: string) => /^\d{4}-\d{2}$/.test(value) && isPersonalDate(`${value}-01`)
export function shiftPersonalMonth(value: string, delta: number) {
  if (!isPersonalMonth(value)) return localToday().slice(0, 7)
  const [year, month] = value.split('-').map(Number)
  const shifted = new Date(0)
  shifted.setUTCFullYear(year, month - 1 + delta, 1)
  const result = shifted.toISOString().slice(0, 7)
  return isPersonalMonth(result) ? result : value
}

// Keep the legacy plain-array contract. Never repair/drop malformed records silently.
export function usePersonalItems<T extends { id: string }>(key: string, valid: (value: unknown) => value is T) {
  const load = (): { items: T[]; raw: string | null; failed: boolean } => {
    try {
      const raw = localStorage.getItem(key)
      const parsed: unknown = raw === null ? [] : JSON.parse(raw)
      if (!Array.isArray(parsed) || !parsed.every(valid) || new Set(parsed.map(item => item.id)).size !== parsed.length) throw new Error('Invalid local data')
      return { items: parsed, raw, failed: false }
    } catch { return { items: [], raw: null, failed: true } }
  }
  const [state, setState] = useState(load)
  const [stale, setStale] = useState(false)
  const [writeFailed, setWriteFailed] = useState(false)
  const reload = () => { setState(load()); setStale(false); setWriteFailed(false) }
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if ((event.key === key || event.key === null) && (event.storageArea === null || event.storageArea === localStorage)) setStale(true)
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [key])
  const isCurrent = () => {
    if (state.failed || stale) return false
    try {
      // Best effort only: localStorage does not provide atomic compare-and-swap.
      if (localStorage.getItem(key) !== state.raw) { setStale(true); setWriteFailed(false); return false }
      return true
    } catch { setWriteFailed(true); return false }
  }
  const save = (items: T[]) => {
    if (!isCurrent()) return false
    try {
      const raw = JSON.stringify(items)
      localStorage.setItem(key, raw)
      setState({ items, raw, failed: false }); setWriteFailed(false)
      return true
    } catch { setWriteFailed(true); return false }
  }
  return { items: state.items, save, isCurrent, reload, stale, readFailed: state.failed, writeFailed, blocked: state.failed || stale }
}

type StoreNoticeProps = {
  copy: PersonalToolCopy
  store: { stale: boolean; readFailed: boolean; writeFailed: boolean; reload: () => void }
}
export function PersonalStoreNotice({ store, copy }: StoreNoticeProps) {
  return <>
    {store.stale && <div className="personal-error" role="alert">{copy('本地数据已在其他页面或操作中更改。本次修改未保存，请重新读取后重试；表单草稿会保留。', 'Local data changed in another page or action. This change was not saved. Reload before retrying; your form draft will be kept.')} <button type="button" onClick={store.reload}>{copy('重新读取', 'Reload data')}</button></div>}
    {store.readFailed && <div className="personal-error" role="alert">{copy('本地数据读取失败。为避免覆盖原数据，暂时不能修改或导出；请检查浏览器存储后重试。', 'Local data could not be read. Changes and export are blocked to protect existing data. Check browser storage, then retry.')} <button type="button" onClick={store.reload}>{copy('重试读取', 'Retry loading')}</button></div>}
    {store.writeFailed && <p className="personal-error" role="alert">{copy('保存或读取失败（存储不可用或已满）。本次修改未保存，原数据保持不变，草稿已保留，请重试。', 'Save or read failed (storage unavailable or full). This change was not saved; existing data is unchanged and your draft is kept. Please retry.')}</p>}
  </>
}
export function PersonalLocalNotice({ copy }: { copy: PersonalToolCopy }) {
  return <p className="personal-privacy">{copy('记录保存在当前浏览器，不同步，不包含在聊天加密备份中。主 Bot 普通聊天会自动查询已保存记录，并将相关数据发送给你配置的模型，无需手动选择、预览或确认；临时会话和非主 Bot 不读取。清除浏览器数据会移除记录；共用设备上的其他使用者可能看到它们。', 'Records are saved in this browser, not synced or included in encrypted chat backups. In regular chat, the main Bot automatically queries saved records and sends relevant data to your configured model, without manual selection, preview or confirmation. Temporary chats and other Bots do not read app data. Clearing browser data removes records; other users of a shared device may see them.')}</p>
}

export function PersonalJsonExport<T>({ items, name, blocked, isCurrent, copy }: { items: T[]; name: 'ledger' | 'diary'; blocked: boolean; isCurrent: () => boolean; copy: PersonalToolCopy }) {
  const [open, setOpen] = useState(false), [error, setError] = useState(false), [requested, setRequested] = useState(false)
  const urls = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const active = urls.current
    return () => { active.forEach((timer, url) => { clearTimeout(timer); URL.revokeObjectURL(url) }); active.clear() }
  }, [])
  const download = () => {
    setError(false); setRequested(false)
    if (!isCurrent()) return
    let url: string | undefined
    let anchor: HTMLAnchorElement | undefined
    try {
      const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json;charset=utf-8' })
      url = URL.createObjectURL(blob)
      anchor = document.createElement('a'); anchor.href = url; anchor.download = `aily-${name}-${localToday()}.json`
      document.body.appendChild(anchor); anchor.click()
      // Delay revocation so Safari has time to consume the download URL.
      const captured = url
      urls.current.set(url, setTimeout(() => { URL.revokeObjectURL(captured); urls.current.delete(captured) }, 30_000))
      setRequested(true)
    } catch { if (url) URL.revokeObjectURL(url); setError(true) }
    finally { anchor?.remove() }
  }
  return <div className="personal-export">
    <button type="button" disabled={blocked} onClick={() => { setOpen(!open); setError(false); setRequested(false) }} aria-expanded={open}>{copy('导出 JSON', 'Export JSON')}</button>
    {open && <section className="personal-export-confirm" aria-label={copy('确认导出', 'Confirm export')}>
      <p>{copy('导出全部已保存记录（不受筛选影响），不包含未保存草稿。JSON 文件未加密，可能包含私密内容；请只保存在你信任的位置。浏览器决定下载位置，不会上传数据。', 'Exports all saved records (regardless of filters), not unsaved drafts. The JSON file is unencrypted and may contain private content; save it only somewhere you trust. Your browser chooses the download location. Nothing is uploaded.')}</p>
      <button type="button" className="personal-primary" disabled={blocked} onClick={download}>{copy('下载 JSON 文件', 'Download JSON file')}</button>
      {requested && <p role="status">{copy('已请求下载，请检查浏览器下载或文件保存提示。', 'Download requested. Check your browser downloads or file-save prompt.')}</p>}
      {error && <p className="personal-error" role="alert">{copy('无法导出文件。记录未被更改；请重试或使用支持下载的浏览器。', 'Could not export the file. Records were not changed. Retry or use a browser that supports downloads.')}</p>}
    </section>}
  </div>
}
