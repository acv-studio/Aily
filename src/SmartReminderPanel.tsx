import { useState } from 'react'
import { Bell, Check, Droplets, Heart, MapPin, Plus, Sparkles, Thermometer, Utensils, X } from 'lucide-react'
import { getLocale, useI18n } from './i18n'
import { proposeNextSteps, type Reminder, type ReminderKind } from './smartReminders'
import type { SmartReminderController } from './useSmartReminders'
import './smartReminders.css'
import ReminderNotificationSettings from './ReminderNotificationSettings'

const text = (zh: string, en: string) => getLocale() === 'en' ? en : zh
const kinds: ReminderKind[] = ['water', 'meal', 'weather', 'mood', 'metro', 'plan']
const icons = { water: Droplets, meal: Utensils, weather: Thermometer, mood: Heart, metro: MapPin, plan: Sparkles }
const label = (kind: ReminderKind) => ({ water: text('喝水', 'Hydration'), meal: text('吃饭', 'Meals'), weather: text('天气关怀', 'Weather care'), mood: text('心情关怀', 'Mood care'), metro: text('地铁出行', 'Metro journey'), plan: text('下一步计划', 'Next steps') })[kind]
const defaultTitle = (kind: ReminderKind) => ({ water: text('休息一下，喝杯水', 'Take a break and drink some water'), meal: text('记得按时吃饭', 'Time for a meal'), weather: text('天气冷了，出门记得添衣、穿秋裤', 'It is cold: dress warmly before going out'), mood: text('如果愿意，去公园走走，给自己一点空间', 'If you feel like it, take a walk in the park'), metro: text('准备下车，确认出站口', 'Prepare to get off and check your exit'), plan: text('准备下一件事', 'Prepare for your next task') })[kind]
const localDateTime = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
const localTime = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
const parseTime = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + m }
function formattedTime(value: string) { return new Date(value).toLocaleString(getLocale() === 'en' ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
function metroTiming(reminder: Reminder) { return reminder.scheduledAt && Date.parse(reminder.scheduledAt) <= Date.now() ? text('已过预计到站时间，请核对当前行程', 'Estimated arrival has passed; check your current journey') : text('预计到站，请核对', 'estimated arrival; verify') }

export default function SmartReminderPanel({ controller, close }: { controller: SmartReminderController; close: () => void }) {
  useI18n()
  const { state, busy, error } = controller
  const [kind, setKind] = useState<ReminderKind>('water')
  const [title, setTitle] = useState(() => defaultTitle('water'))
  const [scheduled, setScheduled] = useState(() => localDateTime(new Date(Date.now() + 30 * 60_000)))
  const [repeat, setRepeat] = useState('120')
  const [threshold, setThreshold] = useState('10')
  const [temperature, setTemperature] = useState('')
  const [station, setStation] = useState('')
  const [exit, setExit] = useState('')
  const [lead, setLead] = useState('3')
  const [activity, setActivity] = useState('')
  const [steps, setSteps] = useState<ReturnType<typeof proposeNextSteps>>([])
  const [addedSteps, setAddedSteps] = useState<number[]>([])
  const [result, setResult] = useState('')
  const [formError, setFormError] = useState('')
  const chooseKind = (value: ReminderKind) => { setKind(value); setTitle(defaultTitle(value)); setRepeat(value === 'water' ? '120' : value === 'meal' ? '1440' : ''); setResult(''); setFormError('') }
  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setFormError(''); setResult('')
    const contextual = kind === 'weather' || kind === 'mood'
    const date = contextual ? null : new Date(scheduled)
    if (date && (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())) { setFormError(text('请选择未来的时间', 'Choose a time in the future')); return }
    if (kind === 'metro' && date && date.getTime() - Number(lead) * 60_000 <= Date.now()) { setFormError(text('预计到站时间应晚于提前提醒的时间', 'Arrival must leave enough time for the advance reminder')); return }
    const saved = await controller.add({ kind, title: title.trim(), enabled: true, scheduledAt: date?.toISOString() ?? null, repeatMinutes: repeat ? Number(repeat) : null, temperatureBelow: kind === 'weather' ? Number(threshold) : null, station: kind === 'metro' ? station.trim() : '', exit: kind === 'metro' ? exit.trim() : '', leadMinutes: kind === 'metro' ? Number(lead) : 0 })
    if (saved) setResult(text('提醒已保存', 'Reminder saved'))
  }
  const recordTemperature = async () => {
    if (!state) return
    setFormError(''); setResult('')
    const value = temperature.trim() ? Number(temperature) : null
    if (value !== null && (!Number.isFinite(value) || value < -60 || value > 60)) { setFormError(text('请输入 -60 到 60°C 的温度', 'Enter a temperature between -60 and 60°C')); return }
    if (await controller.context({ ...state.context, temperature: value, weatherObservedAt: value === null ? null : new Date().toISOString() })) setResult(text('天气记录已更新', 'Weather record updated'))
  }
  const recordMood = async (mood: 'unknown' | 'okay' | 'low') => {
    if (state && await controller.context({ ...state.context, mood, moodObservedAt: mood === 'unknown' ? null : new Date().toISOString() })) setResult(text('心情记录已更新', 'Mood record updated'))
  }
  const confirmStep = async (index: number) => {
    const step = steps[index]
    if (await controller.add({ kind: 'plan', title: step.title, enabled: true, scheduledAt: new Date(Date.now() + step.delayMinutes * 60_000).toISOString(), repeatMinutes: null, temperatureBelow: null, station: '', exit: '', leadMinutes: 0 })) {
      setAddedSteps(values => [...values, index]); setResult(text('下一步已加入提醒', 'Next step added to reminders'))
    }
  }
  return <section className="screen smart-reminders" aria-label={text('智能提醒中心', 'Smart reminder center')}>
    <button className="text-button" onClick={close} disabled={busy}>{text('← 返回', '← Back')}</button>
    <div className="reminder-heading"><span className="reminder-symbol"><Bell size={24} /></span><div><h2>{text('把小事，放在心上', 'Care for the little things')}</h2><p>{text('智能提醒 · 你的节奏，你来决定', 'Smart reminders · Your pace, your choice')}</p></div></div>
    <aside className="reminder-disclosure">{text('本机规则版：定时提醒可在下方开启系统本地通知，不需要后端。天气与心情仍由你记录，仅在应用打开且可见时检查（约每 15 秒）；未接入实时地图、定位、后台条件检测或 AI 预测。', 'Local rule-based version: timed reminders can use system local notifications below, without a server. Weather and mood still use your records and are checked about every 15 seconds while the app is open and visible. No live maps, location, background condition monitoring or AI prediction.')}</aside>
    <ReminderNotificationSettings controller={controller}/>
    {error && <div className="chat-error" role="alert">{error}<button disabled={busy} onClick={() => void controller.refresh()}>{text('重试', 'Retry')}</button></div>}
    {!state ? <p role="status">{text('正在读取提醒…', 'Loading reminders…')}</p> : <>
      <div className="reminder-presets" aria-label={text('提醒场景', 'Reminder scenarios')}>{kinds.map(value => { const Icon = icons[value]; return <button key={value} disabled={busy} aria-pressed={kind === value} className={kind === value ? 'selected' : ''} onClick={() => chooseKind(value)}><Icon size={19} />{label(value)}</button> })}</div>
      <form className="reminder-card glass" onSubmit={event => void create(event)}>
        <h3><Plus size={18} />{text('添加提醒', 'Add a reminder')}</h3>
        <fieldset disabled={busy}>
          <label>{text('提醒内容', 'Reminder message')}<input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
          {kind !== 'weather' && kind !== 'mood' && <label>{kind === 'metro' ? text('预计到站时间', 'Estimated arrival time') : text('首次提醒时间', 'First reminder time')}<input type="datetime-local" required value={scheduled} onChange={event => setScheduled(event.target.value)} /></label>}
          {(kind === 'water' || kind === 'meal') && <label>{text('重复间隔', 'Repeat interval')}<select value={repeat} onChange={event => setRepeat(event.target.value)}><option value="">{text('只提醒一次', 'Once')}</option><option value="60">{text('每 1 小时', 'Every hour')}</option><option value="120">{text('每 2 小时', 'Every 2 hours')}</option><option value="240">{text('每 4 小时', 'Every 4 hours')}</option><option value="1440">{text('每天', 'Every day')}</option></select></label>}
          {kind === 'weather' && <><label>{text('低于此温度时提醒（°C）', 'Remind below this temperature (°C)')}<input type="number" required min="-30" max="40" value={threshold} onChange={event => setThreshold(event.target.value)} /></label><p className="reminder-hint">{text('使用下方手动记录的温度，6 小时内有效；不会自动获取天气。', 'Uses the temperature you record below, valid for 6 hours. Weather is not fetched automatically.')}</p></>}
          {kind === 'mood' && <p className="reminder-hint">{text('仅在你主动记录“心情低落”后触发，2 小时内有效。不分析聊天，不判断心理状态。', 'Triggers only when you record a low mood, valid for 2 hours. Does not analyze chats or assess mental health.')}</p>}
          {kind === 'metro' && <><div className="reminder-grid"><label>{text('下车站点', 'Get-off station')}<input required maxLength={100} value={station} placeholder={text('填写已确认的站名', 'Enter a verified station')} onChange={event => setStation(event.target.value)} /></label><label>{text('出站口', 'Station exit')}<input required maxLength={100} value={exit} placeholder={text('例如 A 口（请核对）', 'e.g. Exit A (verify first)')} onChange={event => setExit(event.target.value)} /></label></div><label>{text('提前几分钟提醒', 'Minutes before arrival')}<input type="number" required min="1" max="30" value={lead} onChange={event => setLead(event.target.value)} /></label><p className="reminder-hint">{text('按你填写的预计时间提醒，不识别实际到站；站点和出口需自行核对。地铁提醒不受免打扰限制。', 'Based on your estimated time, not actual train location. Verify the station and exit yourself. Metro reminders bypass quiet hours.')}</p></>}
          {(kind === 'weather' || kind === 'mood') && <p className="reminder-hint">{text('每条情境提醒触发一次；完成后如需再次提醒，请重新添加。', 'Each context reminder fires once. Add another after completion if needed.')}</p>}
          <button className="primary reminder-primary" type="submit">{busy ? text('正在保存…', 'Saving…') : text('确认添加提醒', 'Confirm reminder')}</button>
        </fieldset>
      </form>
      {formError && <p role="alert">{formError}</p>}{result && <p className="reminder-result" role="status"><Check size={16} />{result}</p>}
      <section className="reminder-card glass"><h3><Heart size={18} />{text('告诉我你的此刻', 'Tell me how things are')}</h3><fieldset disabled={busy}><label htmlFor="reminder-temperature">{text('当前温度（手动记录，°C）', 'Current temperature (manual, °C)')}</label><div className="reminder-inline"><input id="reminder-temperature" type="number" min="-60" max="60" value={temperature} placeholder={state.context.temperature === null ? '°C' : String(state.context.temperature)} onChange={event => setTemperature(event.target.value)} /><button type="button" onClick={() => void recordTemperature()}>{text('更新温度', 'Update temperature')}</button></div><p className="reminder-hint">{state.context.weatherObservedAt ? `${text('上次记录', 'Last record')}: ${state.context.temperature}°C · ${formattedTime(state.context.weatherObservedAt)}` : text('尚未记录天气；留空更新可清除温度。', 'No weather record. Update with an empty input to clear it.')}</p><div className="reminder-moods">{(['low', 'okay', 'unknown'] as const).map(mood => <button key={mood} type="button" aria-pressed={state.context.mood === mood} onClick={() => void recordMood(mood)}>{mood === 'low' ? text('心情低落', 'Feeling low') : mood === 'okay' ? text('心情还好', 'Feeling okay') : text('不记录心情', 'Clear mood')}</button>)}</div>{state.context.moodObservedAt && <p className="reminder-hint">{text('心情记录时间', 'Mood recorded')}: {formattedTime(state.context.moodObservedAt)}</p>}</fieldset></section>
      <section className="reminder-card glass"><h3><Sparkles size={18} />{text('做完这件事，接下来呢？', 'What comes next?')}</h3><p className="reminder-hint">{text('根据关键词给出规划建议，不是对未来的预测；只有你确认后才会加入提醒。', 'Keyword-based planning suggestions, not predictions. Nothing is scheduled until you confirm.')}</p><form onSubmit={event => { event.preventDefault(); setSteps(proposeNextSteps(activity)); setAddedSteps([]); setResult('') }}><label>{text('刚做完或准备做的事', 'What you just did or plan to do')}<input required maxLength={500} value={activity} placeholder={text('例如：开完会、准备出门、吃完饭', 'e.g. finished a meeting, going out, ate a meal')} onChange={event => { setActivity(event.target.value); setSteps([]); setAddedSteps([]) }} /></label><button type="submit" className="secondary" disabled={busy || !activity.trim()}>{text('生成下一步建议', 'Suggest next steps')}</button></form><div className="reminder-steps">{steps.map((step, index) => <article key={index}><strong>{step.title}</strong><p>{step.reason}</p><small>{text('确认后', 'After confirming')} {step.delayMinutes} {text('分钟提醒', 'minutes')}</small><button disabled={busy || addedSteps.includes(index)} onClick={() => void confirmStep(index)}>{addedSteps.includes(index) ? text('已加入', 'Added') : text('确认加入提醒', 'Confirm and add')}</button></article>)}</div></section>
      <section className="reminder-card glass"><h3>{text('免打扰', 'Quiet hours')}</h3><fieldset disabled={busy}><label className="reminder-check"><input type="checkbox" checked={state.quietHours.enabled} onChange={event => void controller.quiet({ ...state.quietHours, enabled: event.target.checked })} />{text('开启免打扰', 'Enable quiet hours')}</label><div className="reminder-grid"><label>{text('开始时间', 'Start')}<input type="time" value={localTime(state.quietHours.start)} onChange={event => { if (event.target.value) void controller.quiet({ ...state.quietHours, start: parseTime(event.target.value) }) }} /></label><label>{text('结束时间', 'End')}<input type="time" value={localTime(state.quietHours.end)} onChange={event => { if (event.target.value) void controller.quiet({ ...state.quietHours, end: parseTime(event.target.value) }) }} /></label></div></fieldset><p className="reminder-hint">{text('按设备本地时间，支持跨午夜。起止相同表示全天免打扰；到期提醒会在结束后检查，地铁提醒除外。', 'Uses device local time and supports overnight ranges. Equal times mean all-day quiet. Due reminders are checked afterwards, except metro reminders.')}</p></section>
      <p className="reminder-hint">{text('提醒列表和处理操作位于上一级“提醒”页面。提醒与情境记录保存在此设备，不包含在聊天备份中。', 'Your reminder list and actions are on the parent Reminders page. Reminders and context stay on this device and are excluded from chat backups.')}</p>
    </>}
  </section>
}

export function ReminderItem({ reminder, controller }: { reminder: Reminder; controller: SmartReminderController }) {
  const Icon = icons[reminder.kind]
  return <article data-reminder-id={reminder.id} className={`reminder-item glass ${reminder.status}${controller.openedNotificationId === reminder.id ? ' notification-focused' : ''}`}><div className="reminder-item-title"><Icon size={20} /><strong>{reminder.title}</strong><span className="reminder-status">{!reminder.enabled ? text('已暂停', 'Paused') : reminder.status === 'due' ? text('待处理', 'Due') : reminder.status === 'completed' ? text('已完成', 'Completed') : text('等待触发', 'Waiting')}</span></div>
    <p className="reminder-hint">{label(reminder.kind)}{reminder.snoozedUntil ? ` · ${text('稍后提醒', 'Snoozed until')} ${formattedTime(reminder.snoozedUntil)}` : reminder.scheduledAt ? ` · ${formattedTime(reminder.scheduledAt)}` : ''}{reminder.repeatMinutes ? ` · ${text('每', 'Every')} ${reminder.repeatMinutes} ${text('分钟', 'minutes')}` : ''}</p>
    {reminder.kind === 'metro' && <p>{reminder.station} · {reminder.exit} · {text('提前', 'Remind')} {reminder.leadMinutes} {text('分钟提醒（预计）', 'minutes early (estimated)')} · {metroTiming(reminder)}</p>}
    <div className="reminder-actions"><button disabled={controller.busy || reminder.status === 'completed' || (reminder.repeatMinutes !== null && reminder.status !== 'due')} onClick={() => void controller.act(reminder.id, 'complete')}><Check size={15} />{text('已完成', 'Done')}</button><button disabled={controller.busy || reminder.status !== 'due' || !reminder.enabled} onClick={() => void controller.act(reminder.id, 'snooze')}>{text('10 分钟后', 'In 10 minutes')}</button><button disabled={controller.busy || reminder.status === 'completed'} onClick={() => void controller.act(reminder.id, 'toggle')}>{reminder.enabled ? text('暂停', 'Pause') : text('继续', 'Resume')}</button><button aria-label={`${text('删除提醒', 'Delete reminder')}: ${reminder.title}`} disabled={controller.busy} onClick={() => { if (window.confirm(text('删除这条提醒？此操作不可撤销。', 'Delete this reminder? This cannot be undone.'))) void controller.act(reminder.id, 'delete') }}><X size={15} /></button></div>
  </article>
}

export function SmartReminderBanner({ controller, open, disabled = false }: { controller: SmartReminderController; open: () => void; disabled?: boolean }) {
  useI18n()
  if (!controller.due.length) return null
  const reminder = controller.due[0]
  return <aside className="reminder-banner glass" role="status" aria-label={text('到期提醒', 'Due reminder')}><Bell size={20} /><div><strong>{reminder.title}</strong>{reminder.kind === 'metro' && <p>{reminder.station} · {reminder.exit} ({metroTiming(reminder)})</p>}<small>{text('待处理提醒', 'Reminders to handle')}: {controller.due.length}</small></div><button disabled={disabled} onClick={open}>{text('查看', 'View')}</button><button disabled={controller.busy} onClick={() => void controller.act(reminder.id, 'snooze')}>{text('稍后', 'Later')}</button></aside>
}
