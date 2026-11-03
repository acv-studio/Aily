import { useEffect, useState } from 'react'
import { characters } from './data'
import type { SplashSettings } from './characterPresence'
import './characterSplashSettings.css'

export default function CharacterSplashSettings({ settings, onSave }: { settings: SplashSettings; onSave: (settings: SplashSettings) => Promise<void> }) {
  const [draft, setDraft] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { setDraft(settings) }, [settings])
  const save = async () => {
    setSaving(true); setMessage('')
    try { await onSave(draft); setMessage('主角色与屏保设置已保存，下次打开生效') }
    catch { setMessage('设置保存失败，请重试；原设置未改变') }
    finally { setSaving(false) }
  }
  return <section className="splash-settings glass" aria-labelledby="splash-settings-title">
    <h2 id="splash-settings-title">主角色与屏保</h2>
    <p>主角色用于下次打开时的屏保和默认消息入口，不删除其他角色的聊天或回忆。</p>
    <fieldset disabled={saving}>
      <label htmlFor="splash-primary">主角色</label><select id="splash-primary" value={draft.primary} onChange={event => setDraft({ ...draft, primary: event.target.value as SplashSettings['primary'] })}>{characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select>
      <label className="splash-toggle"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />再次打开时展示屏保</label>
      <label className="splash-toggle"><input type="checkbox" checked={draft.personalized} onChange={event => setDraft({ ...draft, personalized: event.target.checked })} />按本地时间展示角色日程</label>
      <label className="splash-toggle"><input type="checkbox" checked={draft.staticScene} onChange={event => setDraft({ ...draft, staticScene: event.target.checked })} />静态画面（关闭动效）</label>
    </fieldset>
    <p>仅使用安全的预设日程，不读取聊天、记忆、天气或成人内容，不调用模型。关闭日程后使用固定欢迎画面；系统减弱动态设置也会关闭动效。</p>
    <button onClick={() => void save()} disabled={saving}>{saving ? '正在保存…' : '保存主角色与屏保'}</button>
    {message && <p role="status">{message}</p>}
  </section>
}
