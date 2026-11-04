import { useI18n } from './i18n'
import { useEffect, useState } from 'react'
import { characters, type CharacterId } from './data'
import { defaultProactiveSettings, loadProactiveSettings, saveProactiveSettings, type ProactiveSettings } from './proactiveMessages'
import './proactiveMessages.css'

const formatTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const parseTime = (value: string) => { const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes }
export default function ProactiveSettingsPanel({ selected, close, closeLabel = '← 返回我的' }: { selected: CharacterId; close: () => void; closeLabel?: string }) {
  const { t } = useI18n()
  const [role, setRole] = useState(selected)
  const [settings, setSettings] = useState<ProactiveSettings>(defaultProactiveSettings)
  const [weather, setWeather] = useState('')
  const [weatherChanged, setWeatherChanged] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true); setError(''); setResult(''); setWeatherChanged(false)
    void loadProactiveSettings(role).then(value => { if (alive) { setSettings(value); setWeather(value.weather?.condition || ''); setLoading(false) } }).catch(() => { if (alive) setError('无法读取主动消息设置，请重试；未覆盖已有设置。') })
    return () => { alive = false }
  }, [role, revision])
  const save = async () => {
    setSaving(true); setError(''); setResult('')
    try {
      const updated = { ...settings, weather: weatherChanged ? (weather ? { condition: weather as NonNullable<ProactiveSettings['weather']>['condition'], observedAt: new Date().toISOString() } : null) : settings.weather }
      await saveProactiveSettings(role, updated)
      setSettings(updated); setWeatherChanged(false); setResult('设置已保存')
      window.dispatchEvent(new Event('aily-proactive-settings'))
    } catch { setError('设置未保存，请检查本机存储后重试。') }
    finally { setSaving(false) }
  }
  return <section className="screen proactive-settings">
    <button className="text-button" onClick={close} disabled={saving}>{t(closeLabel)}</button>
    <h2>{t('角色主动消息')}</h2>
    <p>{t('由角色主动向本机聊天发送问候，默认关闭。仅在应用打开且页面可见时检查，不提供关闭应用后的推送；不会补发错过的消息。')}</p>
    <label>{t('设置角色')}<select aria-label={t('设置角色')} value={role} disabled={saving} onChange={event => setRole(event.target.value as CharacterId)}>{characters.map(character => <option key={character.id} value={character.id}>{t(character.name)}</option>)}</select></label>
    {loading ? <p role="status">{t(error || '正在读取设置…')}{error && <button onClick={() => setRevision(value => value + 1)}>{t('重试')}</button>}</p> : <>
      <fieldset disabled={saving}>
        <label className="proactive-check"><input type="checkbox" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} />{t('开启主动消息')}</label>
        <label>{t('消息频率')}<select aria-label={t('消息频率')} value={settings.frequency} onChange={event => setSettings({ ...settings, frequency: event.target.value as ProactiveSettings['frequency'] })}><option value="low">{t('轻量 · 每天最多 1 条，间隔 24 小时')}</option><option value="normal">{t('适中 · 每天最多 2 条，间隔 6 小时')}</option><option value="high">{t('频繁 · 每天最多 3 条，间隔 3 小时')}</option></select></label>
        <h3>{t('发起情境')}</h3>
        {(['time', 'weather', 'relationship'] as const).map((trigger, index) => <label className="proactive-check" key={trigger}><input type="checkbox" checked={settings.triggers[trigger]} onChange={event => setSettings({ ...settings, triggers: { ...settings.triggers, [trigger]: event.target.checked } })} />{t(['按时间 · 早间 08–11 / 傍晚 18–22', '按天气 · 使用你手动提供的天气', '按关系阶段 · 确认回忆后的阶段变化'][index])}</label>)}
        <label>{t('当前天气（手动提供）')}<select aria-label={t('当前天气（手动提供）')} value={weather} onChange={event => { setWeather(event.target.value); setWeatherChanged(true) }}><option value="">{t('不提供天气')}</option><option value="sunny">{t('晴朗')}</option><option value="cloudy">{t('多云')}</option><option value="rainy">{t('下雨')}</option><option value="snowy">{t('下雪')}</option><option value="hot">{t('炎热')}</option><option value="cold">{t('寒冷')}</option></select></label>
        <p>{t('不获取定位，不查询天气服务。天气仅在提供后 6 小时内用于问候。要再次提供相同天气，请先选“不提供天气”再选回。')}</p>
        <label className="proactive-check"><input type="checkbox" checked={settings.quietHours.enabled} onChange={event => setSettings({ ...settings, quietHours: { ...settings.quietHours, enabled: event.target.checked } })} />{t('免打扰')}</label>
        <div className="proactive-times"><label>{t('开始时间')}<input aria-label={t('免打扰开始时间')} type="time" required value={formatTime(settings.quietHours.start)} onChange={event => { if (event.target.value) setSettings({ ...settings, quietHours: { ...settings.quietHours, start: parseTime(event.target.value) } }) }} /></label><label>{t('结束时间')}<input aria-label={t('免打扰结束时间')} type="time" required value={formatTime(settings.quietHours.end)} onChange={event => { if (event.target.value) setSettings({ ...settings, quietHours: { ...settings.quietHours, end: parseTime(event.target.value) } }) }} /></label></div>
        <p>{t('按此设备本地时间；支持跨午夜。开始与结束相同表示全天免打扰。正在回复、临时会话或你刚发过消息时暂停主动问候。')}</p>
        <button className="primary" onClick={() => void save()}>{t(saving ? '正在保存…' : '保存设置')}</button>
      </fieldset>
      {result && <p role="status">{t(result)}</p>}{error && <p role="alert">{t(error)}</p>}
    </>}
    <p>{t('消息是标注的本机文案演示，不调用 AI。设置按角色保存，不包含在聊天备份中；导入或清空聊天数据后会重置。')}</p>
  </section>
}
