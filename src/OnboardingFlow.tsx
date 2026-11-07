import { useState } from 'react'
import { t, useI18n } from './i18n'
import LanguageSettings from './LanguageSettings'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { characters, type CharacterId } from './data'
import type { ChatMessage } from './chatService'
import { defaultOnboardingProfile, type OnboardingProfile } from './onboarding'
import './onboarding.css'
import { SafetyConsent } from './SafetyPrivacyPanel'
import { acceptSafetyConsent } from './privacy'
import { DEEPSEEK_ENDPOINT, DEEPSEEK_MODEL, MAGPIE_ENDPOINT, MAGPIE_MODEL, modelProvider, normalizeGatewayUrl, type ModelProvider } from './modelGateway'

function gatewayConfig(value: string): { endpoint: string; error: string } {
  if (!value.trim()) return { endpoint: '', error: '' }
  try {
    const endpoint = normalizeGatewayUrl(value)
    const url = new URL(endpoint)
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]', '10.0.2.2'].includes(url.hostname)) {
      return { endpoint: '', error: '网关 URL 必须使用 HTTPS；仅本机 localhost、127.0.0.1、[::1] 或 10.0.2.2 可以使用 HTTP。' }
    }
    return { endpoint, error: '' }
  } catch {
    return { endpoint: '', error: '网关 URL 必须是有效的 HTTP(S) 地址，不能包含账号密码、查询参数或片段。' }
  }
}

type ProfileProps = { profile: OnboardingProfile; change: (patch: Partial<OnboardingProfile>) => void }
const introductions: Record<CharacterId, string> = {
  lu: '我是陆听澜。话可能不多，但你说的小事，我会认真听。今天不急，我们慢慢认识。',
  chen: '陈奕恒，记住了吗？我有时嘴硬，但不会拿你的难处开玩笑。先认识一下，今天过得怎么样？',
  gu: '我是顾辰泽。你可以直接告诉我想要什么，也可以随时说不。我们按你舒服的节奏来。',
}
function Names({ profile, change }: ProfileProps) {
  return <><label>{t('你的名字或昵称')}<input maxLength={40} value={profile.userName} onChange={e => change({ userName: e.target.value })}/></label><label>{t('你想怎么称呼 TA')}<input maxLength={40} value={profile.characterName} onChange={e => change({ characterName: e.target.value })}/></label><label className="check"><input type="checkbox" checked={profile.familiarNames} onChange={e => change({ familiarNames: e.target.checked })}/>{t('先叫名字，熟悉后可以再商量亲密称呼')}</label></>
}
function Preferences({ profile, change }: ProfileProps) {
  return <><label>{t('聊天长度')}<select value={profile.chatLength} onChange={e => change({ chatLength: e.target.value as OnboardingProfile['chatLength'] })}><option value="short">{t('简短，一两句就好')}</option><option value="long">{t('多聊一点')}</option></select></label><label>{t('主动消息频率')}<select value={profile.proactiveFrequency} onChange={e => change({ proactiveFrequency: e.target.value as OnboardingProfile['proactiveFrequency'] })}><option value="off">{t('不要主动打扰')}</option><option value="occasional">{t('偶尔问候')}</option><option value="daily">{t('每天问候')}</option></select></label><p className="hint">{t('这里先记录偏好。实际主动问候请在“我的 → 角色主动消息设置”按角色单独开启；仅应用打开时可用。')}</p><label className="check"><input type="checkbox" checked={profile.banter} onChange={e => change({ banter: e.target.checked })}/>{t('接受轻度吃醋和斗嘴（不攻击、不强迫）')}</label><label>{t('难过时希望 TA')}<select value={profile.supportStyle} onChange={e => change({ supportStyle: e.target.value as OnboardingProfile['supportStyle'] })}><option value="listen">{t('先倾听')}</option><option value="comfort">{t('先安慰')}</option></select></label></>
}
function Boundaries({ profile, change }: ProfileProps) {
  return <><label>{t('禁用话题')}<textarea maxLength={500} placeholder={t('如：工作、外貌评价；也可以留空')} value={profile.blockedTopics} onChange={e => change({ blockedTopics: e.target.value })}/></label><div className="time-fields"><label>{t('允许通知开始时间')}<input type="time" value={profile.notificationStart} onChange={e => change({ notificationStart: e.target.value })}/></label><label>{t('允许通知结束时间')}<input type="time" value={profile.notificationEnd} onChange={e => change({ notificationEnd: e.target.value })}/></label></div><p className="hint">{t('此处保存偏好，不改变角色主动消息设置。实际免打扰时段请在“我的”单独设置；支持跨午夜。')}</p></>
}
export function OnboardingEditor({ initial, save, close }: { initial: OnboardingProfile; save: (profile: OnboardingProfile) => Promise<void>; close: () => void }) {
  useI18n()
  const [profile, setProfile] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const change = (patch: Partial<OnboardingProfile>) => setProfile(current => ({ ...current, ...patch }))
  return <main className="onboarding onboarding-flow"><button className="text-button" disabled={busy} onClick={close}><ArrowLeft size={18}/>{t('返回')}</button><h1>{t('称呼与互动偏好')}</h1><p className="hint">{t('这里修改与{name}的互相称呼；互动偏好与边界用于所有角色。修改称呼不会降低关系进度。', { name: t(characters.find(role => role.id === profile.characterId)?.name || '') })}</p><fieldset disabled={busy} className="onboarding-fields"><Names profile={profile} change={change}/><Preferences profile={profile} change={change}/><Boundaries profile={profile} change={change}/>{error && <p role="alert">{t(error)}</p>}<button className="primary" disabled={busy || !profile.userName.trim() || !profile.characterName.trim()} onClick={async () => { setBusy(true); setError(''); try { await save(profile); close() } catch { setError('偏好未保存，请检查本机存储后重试。') } finally { setBusy(false) } }}>{t('保存偏好')}</button></fieldset></main>
}
export default function Onboarding({ selected, setSelected, finish, apiKey, setApiKey, endpoint = '', model = '', setEndpoint, setModel, onSafetyAccepted }: { onSafetyAccepted?: () => void; selected: CharacterId; setSelected: (id: CharacterId) => void; finish: (profile: OnboardingProfile, messages: ChatMessage[]) => Promise<void>; apiKey: string; setApiKey: (key: string) => void; endpoint?: string; model?: string; setEndpoint?: (value: string) => void; setModel?: (value: string) => void }) {
  const { locale } = useI18n()
  const [step, setStep] = useState(-1)
  // Localize fresh defaults only; saved and entered values never change with locale.
  const [profile, setProfile] = useState(() => {
    const defaults = defaultOnboardingProfile(selected)
    return locale === 'en' ? { ...defaults, userName: 'You', characterName: t(defaults.characterName), safeWord: 'Stop' } : defaults
  })
  const [trial, setTrial] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [provider, setProvider] = useState<ModelProvider | null>(null)
  const [gatewayUrl, setGatewayUrl] = useState(() => endpoint && modelProvider(endpoint) === 'openai' ? endpoint : '')
  const [gatewayModel, setGatewayModel] = useState(() => endpoint && modelProvider(endpoint) === 'openai' ? model : '')
  const gateway = gatewayConfig(gatewayUrl)
  const selectProvider = (choice: ModelProvider) => {
    if (choice === 'openai') {
      // Preset credentials must never follow the user to a custom destination.
      if (provider !== 'openai') setApiKey('')
      setEndpoint?.(gateway.endpoint || gatewayUrl.trim())
      setModel?.(gatewayModel.trim())
    } else if (choice === 'deepseek') {
      if (provider !== 'deepseek') setApiKey('')
      setEndpoint?.(DEEPSEEK_ENDPOINT)
      setModel?.(DEEPSEEK_MODEL)
    } else {
      setApiKey('magpie')
      setEndpoint?.(MAGPIE_ENDPOINT)
      setModel?.(MAGPIE_MODEL)
    }
    setProvider(choice)
    setError('')
  }
  const serviceReady = provider === 'magpie' || provider === 'deepseek' && !!apiKey.trim() || provider === 'openai' && !!gateway.endpoint && !!gatewayModel.trim() && !!apiKey.trim()
  const character = characters.find(c => c.id === profile.characterId)!
  const change = (patch: Partial<OnboardingProfile>) => { setProfile(current => ({ ...current, ...patch })); setTrial([]) }
  const next = () => { setError(''); setStep(current => current + 1) }
  const labels = ['初遇', '选择角色', '自我介绍', '你的称呼', 'TA 的称呼', '互动偏好', '边界与同意', '称呼试聊', '数据说明']
  return <main className="onboarding onboarding-flow"><div className="ambient ambient-one"/><div className="brand"><span className="brand-mark">A</span><span>Aily</span></div>{step >= 0 && <><p className="step-indicator" aria-live="polite">{t('第 {step} / 9 步 · {label}', { step: step + 1, label: t(labels[step]) })}</p><progress max={9} value={step + 1} aria-label={t('首次引导进度')}/></>}{step > 0 && <button className="text-button" disabled={busy} onClick={() => { setError(''); setStep(current => current - 1) }}><ArrowLeft size={18}/>{t('返回')}</button>}
    {step === -1 && <section className="language-welcome"><p className="eyebrow">LANGUAGE</p><h1>{t('选择语言')}</h1><p className="lead">{t('请选择界面语言，之后可以在“我的”中修改。')}</p><LanguageSettings /><button className="primary" onClick={next}>{t('继续')} <ChevronRight size={18}/></button></section>}
    {step === 0 && <section className="welcome"><p className="eyebrow">{t('不只是聊天')}</p><h1>{t('一段会记得、')}<br/><em>{t('会生长')}</em>{t('的关系')}</h1><p className="lead">{t('TA 会记住你说过的小事，把每一次共同经历，写成只属于你们的故事。')}</p><div className="memory-preview glass"><span className="orb">✦</span><div><small>{t('来自未来的一条回忆 · 场景示例')}</small><strong>{t('“你还记得，那天我说想看海吗？”')}</strong></div></div><p className="disclosure">{t('你将与 AI 角色互动 · 本机优先保存，外部模型另有传输')}</p><SafetyConsent onAccepted={() => { acceptSafetyConsent(); onSafetyAccepted?.(); next() }} /></section>}
    {step === 1 && <section className="choose"><p className="eyebrow">{t('选择首位陪伴角色')}</p><h1>{t('你想先认识谁？')}</h1><div className="character-stack">{characters.map(c => <button key={c.id} aria-pressed={profile.characterId === c.id} className={`character-card ${profile.characterId === c.id ? 'selected' : ''}`} style={{ '--accent': c.accent } as React.CSSProperties} onClick={() => { setSelected(c.id); change({ ...profile, characterId: c.id, characterName: t(c.name) }) }}><span className="avatar" style={{ '--accent': c.accent } as React.CSSProperties}>{t(c.avatar)}</span><div><strong>{t(c.name)}</strong><span>{t(c.title)}</span><p>{t(c.intro)}</p><p>{t('互动示例：“{quote}”', { quote: t(c.quote) })}</p></div><span className="radio">{profile.characterId === c.id ? '✓' : ''}</span></button>)}</div><p className="hint">{t('TA 将成为首位主角色，之后可随时切换。')}</p><button className="primary" onClick={next}>{t('开始我们的故事')}<ChevronRight size={18}/></button></section>}
    {step === 2 && <><h1>{t('先听听我的自我介绍')}</h1><article className="intro-card glass"><strong>{t('{name} · AI 角色', { name: t(character.name) })}</strong><p>{t(introductions[profile.characterId])}</p></article><button className="primary" onClick={next}>{t('继续')}</button></>}
    {step === 3 && <><h1>{t('我该怎么称呼你？')}</h1><label>{t('你的名字或昵称')}<input maxLength={40} value={profile.userName} onChange={e => change({ userName: e.target.value })}/></label><label className="check"><input type="checkbox" checked={profile.familiarNames} onChange={e => change({ familiarNames: e.target.checked })}/>{t('先叫名字，熟悉后可以再商量亲密称呼')}</label><button className="primary" disabled={!profile.userName.trim()} onClick={next}>{t('继续')}</button><button className="secondary" onClick={() => { change({ userName: locale === 'en' ? 'You' : '你', familiarNames: false }); next() }}>{t('先不填写')}</button></>}
    {step === 4 && <><h1>{t('你想怎么叫我？')}</h1><label>{t('你想怎么称呼 TA')}<input maxLength={40} value={profile.characterName} onChange={e => change({ characterName: e.target.value })}/></label><p className="hint">{t('全名、昵称或自定义称呼都可以。之后修改也不会被当作关系降级。')}</p><button className="primary" disabled={!profile.characterName.trim()} onClick={next}>{t('继续')}</button><button className="secondary" onClick={() => { change({ characterName: t(character.name) }); next() }}>{t('先用全名')}</button></>}
    {step === 5 && <><h1>{t('怎样陪你更舒服？')}</h1><Preferences profile={profile} change={change}/><button className="primary" onClick={next}>{t('继续')}</button><button className="secondary" onClick={() => { const defaults = defaultOnboardingProfile(profile.characterId); change({ chatLength: defaults.chatLength, proactiveFrequency: defaults.proactiveFrequency, banter: defaults.banter, supportStyle: defaults.supportStyle }); next() }}>{t('先用默认偏好')}</button></>}
    {step === 6 && <><h1>{t('靠近，也尊重边界')}</h1><Boundaries profile={profile} change={change}/><button className="primary" disabled={!profile.notificationStart || !profile.notificationEnd} onClick={next}>{t('继续')}</button></>}
    {step === 7 && <><h1>{t('试着叫一声')}</h1><p className="hint">{t('本机称呼预演，不会发送给模型。确认后保存第一条关系记忆。')}</p><article className="intro-card glass"><p>{t('TA 叫你：{name}', { name: profile.userName === '你' || !profile.userName ? t('你') : profile.userName })}<br/>{t('你叫 TA：{name}', { name: profile.characterName || t(character.name) })}</p>{trial.map(message => <p key={message.id} className={message.from === 'user' ? 'trial-user' : ''}>{message.text}</p>)}</article>{!trial.length ? <button className="primary" onClick={() => { const now = Date.now(); const user = profile.userName.trim(); const name = profile.characterName.trim(); const time = new Date().toLocaleTimeString(locale); const createdAt = new Date().toISOString(); setTrial([{ id: now, from: 'user', text: t('{name}，我今天想先和你打个招呼。', { name }), time, createdAt, status: 'sent' }, { id: now + 1, from: 'character', text: user === '你' || user === 'You' ? t('好，就叫我{name}。暂时不填名字也没关系，我们慢慢认识。', { name }) : t('{user}，听到了。你叫我{name}就好，想换称呼时随时告诉我。', { user, name }), time, createdAt, status: 'sent' }]) }}>{t('发送试聊')}</button> : <button className="primary" onClick={next}>{t('称呼没问题，继续')}</button>}<button className="secondary" onClick={() => { setTrial([]); setStep(3) }}>{t('纠正称呼')}</button></>}
    {step === 8 && <>
      <h1>{t('选择 AI 服务')}</h1><p className="hint">{t('选择一种回复生成方式，之后随时可以在“我的”中修改。')}</p>
      <div className="provider-choice-stack">
        <button type="button" aria-pressed={provider === 'openai'} className={provider === 'openai' ? 'selected' : ''} onClick={() => selectProvider('openai')}><strong>{t('OpenAI兼容网关')}</strong><span>{t('填写自定义网关 URL、模型名称和 API Key')}</span><small>{t('Key 仅保留在本次浏览器会话')}</small></button>
        <button type="button" aria-pressed={provider === 'deepseek'} className={provider === 'deepseek' ? 'selected' : ''} onClick={() => selectProvider('deepseek')}><strong>DeepSeek</strong><span>{t('填写自己的 DeepSeek API Key')}</span><small>{t('Key 仅保留在本次浏览器会话')}</small></button>
        <button type="button" aria-pressed={provider === 'magpie'} className={provider === 'magpie' ? 'selected' : ''} onClick={() => selectProvider('magpie')}><strong>Magpie</strong><span>{t('使用当前设备的本地网关')}</span><small>{MAGPIE_MODEL}</small></button>
      </div>
      {provider === 'openai' && <>
        <label>{t('网关 URL')}<input type="url" required autoComplete="off" value={gatewayUrl} aria-invalid={!!gateway.error} aria-describedby="onboarding-gateway-help" onChange={e => { const value = e.target.value; setGatewayUrl(value); setEndpoint?.(gatewayConfig(value).endpoint || value.trim()) }} placeholder="https://gateway.example.com"/></label>
        <p id="onboarding-gateway-help" className="hint">{t('可填写根 URL、/v1 基础地址或完整的 /chat/completions 地址；根 URL 会补全 /v1/chat/completions，其他路径按原样使用。请使用 HTTPS，本机地址可以使用 HTTP。')}</p>
        {gateway.error && <p role="alert">{t(gateway.error)}</p>}
        <label>{t('模型名称')}<input required autoComplete="off" value={gatewayModel} onChange={e => { setGatewayModel(e.target.value); setModel?.(e.target.value.trim()) }} placeholder="your-model-name"/></label>
        <label>API Key<input type="password" required autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-…"/></label>
      </>}
      {provider === 'deepseek' && <label>DeepSeek API Key<input type="password" required autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-…"/></label>}
      <article className="intro-card glass"><p>{t('聊天、称呼、偏好与记忆保存在本机 IndexedDB，不会自动同步到其他设备。清除浏览器数据或卸载可能导致记录丢失，请在“我的”导出加密备份。')}</p><p>{t('聊天内容会发送至你选择的 AI 服务以生成回复。API Key 只保留在本次浏览器会话，不包含在备份内。')}</p></article>
      {error && <p role="alert">{t(error)}</p>}
      <button className="primary" disabled={busy || !serviceReady} onClick={async () => { setBusy(true); setError(''); try { await finish(profile, trial) } catch { setError('引导未完成：本机保存失败，请检查存储权限后重试。') } finally { setBusy(false) } }}>{busy ? t('正在保存…') : t('完成引导')}</button>
    </>}
  </main>
}
