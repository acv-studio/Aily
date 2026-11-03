import { useEffect, useRef, useState } from 'react'
import './DataTransferPanel.css'
import { Download, Upload } from 'lucide-react'
import { clearAllData, exportData, importData } from './db'
import { decryptBackup, encryptBackup } from './cryptoBackup'
import { saveEncryptedBackup } from './saveBackup'

type Props = {
  beforeDataChange: () => Promise<void>
  onImported: (data: Awaited<ReturnType<typeof importData>>) => void
  onCleared: () => void
}

export default function DataTransferPanel({ beforeDataChange, onImported, onCleared }: Props) {
  const [password, setPassword] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [confirmation, setConfirmation] = useState<'import' | 'clear' | null>(null)
  const [busy, setBusy] = useState<'export' | 'import' | 'clear' | null>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const running = useRef(false)
  const confirmGroup = useRef<HTMLDivElement>(null)
  const importButton = useRef<HTMLButtonElement>(null)
  const clearButton = useRef<HTMLButtonElement>(null)
  const previousConfirmation = useRef<typeof confirmation>(null)
  useEffect(() => {
    if (confirmation) confirmGroup.current?.focus()
    else if (previousConfirmation.current && !busy) {
      const trigger = previousConfirmation.current === 'import' ? importButton.current : clearButton.current
      if (trigger?.disabled) input.current?.focus()
      else trigger?.focus()
    }
    // Keep the prior trigger while busy: disabled fieldsets cannot receive focus.
    if (confirmation || !busy) previousConfirmation.current = confirmation
  }, [confirmation, busy])
  const resetFile = () => { setFile(null); if (input.current) input.current.value = '' }
  const run = async (operation: NonNullable<typeof busy>, work: () => Promise<void>) => {
    if (running.current) return
    running.current = true; setBusy(operation); setNotice(null)
    try { await work(); setConfirmation(null); setPassword('') }
    catch (error) { setNotice({ text: error instanceof Error ? error.message : '操作未完成，请重试', error: true }) }
    finally { running.current = false; setBusy(null) }
  }
  const download = () => run('export', async () => {
    if (password.length < 6) throw new Error('请设置至少 6 位的备份密码')
    await beforeDataChange()
    const encrypted = await encryptBackup(await exportData(), password)
    const saved = await saveEncryptedBackup(encrypted)
    setNotice({ text: saved === 'cancelled' ? '已取消备份导出' : saved === 'shared'
      ? '加密备份已交给系统分享，请确认已保存；API Key 不包含在文件中'
      : '已发起加密备份下载，请妥善保存文件和密码。' })
  })
  const restore = () => run('import', async () => {
    if (!file) throw new Error('请先选择备份文件')
    // Read/decrypt before waiting for outstanding local writes.
    const raw = await decryptBackup(await file.text(), password)
    await beforeDataChange()
    const data = await importData(raw)
    resetFile(); onImported(data)
    setNotice({ text: '备份已导入，本机资料已更新。' })
  })
  const clear = () => run('clear', async () => {
    await beforeDataChange(); await clearAllData(); onCleared(); resetFile()
    setNotice({ text: '本机聊天、记忆与相关设置已清空。' })
  })

  return <section className="data-transfer glass" aria-labelledby="data-transfer-heading" aria-busy={!!busy}>
    <h3 id="data-transfer-heading">本机聊天与记忆</h3>
    <p>聊天、附件、记忆、摘要与称呼偏好保存在当前浏览器。换机或清除浏览器数据前，请先导出备份。</p>
    <p className="backup-scope">备份不含 API Key、成年确认、演示钱包、主动消息设置或故事进度。导入会替换聊天与相关设置，并重置主动消息设置和故事进度；钱包不变。导入或清空前，请关闭其他 Aily 标签页并暂停主动消息。</p>
    <fieldset disabled={!!busy}>
      <label htmlFor="backup-password">备份密码</label>
      <input id="backup-password" type="password" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} aria-describedby="backup-password-help" placeholder="导出设置密码，导入填写原密码" />
      <p id="backup-password-help">加密导出至少 6 位；导入使用导出时的密码。旧版未加密 JSON 可留空。忘记密码无法恢复。</p>
      <button className="backup-action" disabled={confirmation !== null} onClick={() => void download()}><Download size={18} />{busy === 'export' ? '正在加密导出…' : '导出加密备份'}</button>
      <div className="backup-import">
        <label htmlFor="backup-file">导入备份文件</label>
        <input ref={input} id="backup-file" type="file" accept=".json,application/json" onChange={event => { setFile(event.target.files?.[0] || null); setConfirmation(null); setNotice(null) }} />
        {file && <p className="backup-file-name">已选择：{file.name}（{Math.max(1, Math.ceil(file.size / 1024))} KB）</p>}
        <button ref={importButton} className="backup-action" disabled={!file || confirmation !== null} onClick={() => { setNotice(null); setConfirmation('import') }}><Upload size={18} />导入并替换本机数据</button>
      </div>
      <button ref={clearButton} className="backup-clear" disabled={confirmation !== null} onClick={() => { setNotice(null); setConfirmation('clear') }}>清空本机聊天与记忆</button>
      {confirmation && <div ref={confirmGroup} tabIndex={-1} className="backup-confirm" role="group" aria-label={confirmation === 'import' ? '确认导入备份' : '确认清空聊天'}>
        <h4>{confirmation === 'import' ? '替换当前本机数据？' : '清空当前本机数据？'}</h4>
        <p>{confirmation === 'import' ? '当前聊天、附件、记忆、摘要与相关设置将被备份替换。' : '当前聊天、附件、记忆、摘要与相关设置将被删除。'}主动消息设置和故事进度也会重置，演示钱包不变。此操作无法撤销，请先保存需要的备份。</p>
        <div><button onClick={() => setConfirmation(null)}>取消</button><button className="backup-danger" onClick={() => void (confirmation === 'import' ? restore() : clear())}>{busy ? '正在处理…' : confirmation === 'import' ? '确认替换' : '确认清空'}</button></div>
      </div>}
    </fieldset>
    {notice && <p className={`backup-notice ${notice.error ? 'is-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
  </section>
}
