import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { characters, type CharacterId } from './data'
import type { ChatMessage } from './chatService'
import { defaultOnboardingProfile, type OnboardingProfile } from './onboarding'
import './onboarding.css'
import { t, useI18n } from './i18n'
import LanguageSettings from './LanguageSettings'
import { SafetyConsent } from './SafetyPrivacyPanel'
import { acceptSafetyConsent, hasSafetyConsent } from './privacy'

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
  const [confirming, setConfirming] = useState(false)
  const [age, setAge] = useState(false)
  const [consent, setConsent] = useState(false)
  const [safeWord, setSafeWord] = useState('停')
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!confirming) return
    const previous = document.activeElement as HTMLElement | null
    const focusable = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') || [])
    focusable()[0]?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setConfirming(false) }
      if (event.key === 'Tab') {
        const elements = focusable()
        const first = elements[0]; const last = elements.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); previous?.focus() }
  }, [confirming])
  return <><label>{t('禁用话题')}<textarea maxLength={500} placeholder={t('如：工作、外貌评价；也可以留空')} value={profile.blockedTopics} onChange={e => change({ blockedTopics: e.target.value })}/></label><div className="time-fields"><label>{t('允许通知开始时间')}<input type="time" value={profile.notificationStart} onChange={e => change({ notificationStart: e.target.value })}/></label><label>{t('允许通知结束时间')}<input type="time" value={profile.notificationEnd} onChange={e => change({ notificationEnd: e.target.value })}/></label></div><p className="hint">{t('此处保存偏好，不改变角色主动消息设置。实际免打扰时段请在“我的”单独设置；支持跨午夜。')}</p><div className="consent-status"><strong>{t('成人模式：{status}', { status: profile.adultEnabled ? t('已开启') : t('关闭（默认）') })}</strong><p>{t('不影响普通聊天。开启不代表同意所有互动，任何时候都可以拒绝或关闭。')}</p>{profile.adultEnabled ? <button type="button" onClick={() => change({ adultEnabled: false, ageConfirmed: false, adultConsent: false })}>{t('关闭成人模式')}</button> : <button type="button" onClick={() => { setAge(false); setConsent(false); setSafeWord(profile.safeWord || '停'); setConfirming(true) }}>{t('了解并确认成人模式')}</button>}</div>{confirming && <div className="onboarding-dialog-backdrop"><section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="consent-title" className="onboarding-dialog"><h2 id="consent-title">{t('独立确认成人模式')}</h2><p>{t('仅限年满 18 岁的成年人自愿开启。仍会尊重禁区与拒绝；安全词一旦出现，应立即停止互动并提供安抚。')}</p><label className="check"><input type="checkbox" checked={age} onChange={e => setAge(e.target.checked)}/>{t('我确认已年满 18 岁')}</label><label className="check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>{t('我自愿开启，知道可以随时撤回同意')}</label><label>{t('安全词')}<input maxLength={40} value={safeWord} onChange={e => setSafeWord(e.target.value)}/></label><button className="primary" type="button" disabled={!age || !consent || !safeWord.trim()} onClick={() => { change({ adultEnabled: true, ageConfirmed: age, adultConsent: consent, safeWord: safeWord.trim() }); setConfirming(false) }}>{t('确认开启')}</button><button className="secondary" type="button" onClick={() => setConfirming(false)}>{t('保持关闭')}</button></section></div>}</>
}
export function OnboardingEditor({ initial, save, close }: { initial: OnboardingProfile; save: (profile: OnboardingProfile) => Promise<void>; close: () => void }) {
  useI18n()
  const [profile, setProfile] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const change = (patch: Partial<OnboardingProfile>) => setProfile(current => ({ ...current, ...patch }))
  return <main className="onboarding onboarding-flow"><LanguageSettings compact /><button className="text-button" disabled={busy} onClick={close}><ArrowLeft size={18}/>{t('返回')}</button><h1>{t('称呼与互动偏好')}</h1><p className="hint">{t('这里修改与{name}的互相称呼；互动偏好与边界用于所有角色。修改称呼不会降低关系进度。', { name: t(characters.find(role => role.id === profile.characterId)?.name || '') })}</p><fieldset disabled={busy} className="onboarding-fields"><Names profile={profile} change={change}/><Preferences profile={profile} change={change}/><Boundaries profile={profile} change={change}/>{error && <p role="alert">{t(error)}</p>}<button className="primary" disabled={busy || !profile.userName.trim() || !profile.characterName.trim()} onClick={async () => { setBusy(true); setError(''); try { await save(profile); close() } catch { setError('偏好未保存，请检查本机存储后重试。') } finally { setBusy(false) } }}>{t('保存偏好')}</button></fieldset></main>
}
export default function Onboarding({ selected, setSelected, finish, apiKey, setApiKey, onSafetyAccepted }: { onSafetyAccepted?: () => void; selected: CharacterId; setSelected: (id: CharacterId) => void; finish: (profile: OnboardingProfile, messages: ChatMessage[]) => Promise<void>; apiKey: string; setApiKey: (key: string) => void }) {
  const { locale } = useI18n()
  const [step, setStep] = useState(0)
  // Localize fresh defaults only; saved and entered values never change with locale.
  const [profile, setProfile] = useState(() => {
    const defaults = defaultOnboardingProfile(selected)
    return locale === 'en' ? { ...defaults, userName: 'You', characterName: t(defaults.characterName), safeWord: 'Stop' } : defaults
  })
  const [trial, setTrial] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showApi, setShowApi] = useState(false)
  const character = characters.find(c => c.id === profile.characterId)!
  const change = (patch: Partial<OnboardingProfile>) => { setProfile(current => ({ ...current, ...patch })); setTrial([]) }
  const next = () => { setError(''); setStep(current => current + 1) }
  const labels = ['初遇', '选择角色', '自我介绍', '你的称呼', 'TA 的称呼', '互动偏好', '边界与同意', '称呼试聊', '数据说明']
  return <main className="onboarding onboarding-flow"><div className="ambient ambient-one"/><div className="brand"><span className="brand-mark">A</span><span>Aily</span></div><p className="step-indicator" aria-live="polite">第 {step + 1} / 9 步 · {labels[step]}</p><progress max={9} value={step + 1} aria-label="首次引导进度"/>{step > 0 && <button className="text-button" disabled={busy} onClick={() => { setError(''); setStep(current => current - 1) }}><ArrowLeft size={18}/>返回</button>}
    {step === 0 && <section className="welcome"><p className="eyebrow">不只是聊天</p><h1>一段会记得、<br/><em>会生长</em>的关系</h1><p className="lead">TA 会记住你说过的小事，把每一次共同经历，写成只属于你们的故事。</p><div className="memory-preview glass"><span className="orb">✦</span><div><small>来自未来的一条回忆 · 场景示例</small><strong>“你还记得，那天我说想看海吗？”</strong></div></div><p className="disclosure">你将与 AI 角色互动 · 记录保存在当前设备，本机优先保存，外部模型另有传输</p>{hasSafetyConsent() ? <button className="primary" onClick={next}>遇见 TA <ChevronRight size={18}/></button> : <SafetyConsent onAccepted={() => { acceptSafetyConsent(); next() }} />}</section>}
    {step === 1 && <section className="choose"><p className="eyebrow">选择首位陪伴角色</p><h1>你想先认识谁？</h1><div className="character-stack">{characters.map(c => <button key={c.id} aria-pressed={profile.characterId === c.id} className={`character-card ${profile.characterId === c.id ? 'selected' : ''}`} style={{ '--accent': c.accent } as React.CSSProperties} onClick={() => { setSelected(c.id); change({ ...profile, characterId: c.id, characterName: c.name }) }}><span className="avatar" style={{ '--accent': c.accent } as React.CSSProperties}>{c.avatar}</span><div><strong>{c.name}</strong><span>{c.title}</span><p>{c.intro}</p><p>互动示例：“{c.quote}”</p></div><span className="radio">{profile.characterId === c.id ? '✓' : ''}</span></button>)}</div><p className="hint">TA 将成为首位主角色，之后可随时切换。</p><button className="primary" onClick={next}>开始我们的故事 <ChevronRight size={18}/></button></section>}
    {step === 2 && <><h1>先听听我的自我介绍</h1><article className="intro-card glass"><strong>{character.name} · AI 角色</strong><p>{introductions[profile.characterId]}</p></article><button className="primary" onClick={next}>继续</button></>}
    {step === 3 && <><h1>我该怎么称呼你？</h1><label>你的名字或昵称<input maxLength={40} value={profile.userName} onChange={e => change({ userName: e.target.value })}/></label><label className="check"><input type="checkbox" checked={profile.familiarNames} onChange={e => change({ familiarNames: e.target.checked })}/>先叫名字，熟悉后可以再商量亲密称呼</label><button className="primary" disabled={!profile.userName.trim()} onClick={next}>继续</button><button className="secondary" onClick={() => { change({ userName: '你', familiarNames: false }); next() }}>先不填写</button></>}
    {step === 4 && <><h1>你想怎么叫我？</h1><label>你想怎么称呼 TA<input maxLength={40} value={profile.characterName} onChange={e => change({ characterName: e.target.value })}/></label><p className="hint">全名、昵称或自定义称呼都可以。之后修改也不会被当作关系降级。</p><button className="primary" disabled={!profile.characterName.trim()} onClick={next}>继续</button><button className="secondary" onClick={() => { change({ characterName: character.name }); next() }}>先用全名</button></>}
    {step === 5 && <><h1>怎样陪你更舒服？</h1><Preferences profile={profile} change={change}/><button className="primary" onClick={next}>继续</button><button className="secondary" onClick={() => { const defaults = defaultOnboardingProfile(profile.characterId); change({ chatLength: defaults.chatLength, proactiveFrequency: defaults.proactiveFrequency, banter: defaults.banter, supportStyle: defaults.supportStyle }); next() }}>先用默认偏好</button></>}
    {step === 6 && <><h1>靠近，也尊重边界</h1><Boundaries profile={profile} change={change}/><button className="primary" disabled={!profile.notificationStart || !profile.notificationEnd} onClick={next}>继续</button></>}
    {step === 7 && <><h1>试着叫一声</h1><p className="hint">本机称呼预演，不会发送给模型。确认后保存第一条关系记忆。</p><article className="intro-card glass"><p>TA 叫你：{profile.userName || '你'}<br/>你叫 TA：{profile.characterName || character.name}</p>{trial.map(message => <p key={message.id} className={message.from === 'user' ? 'trial-user' : ''}>{message.text}</p>)}</article>{!trial.length ? <button className="primary" onClick={() => { const now = Date.now(); const user = profile.userName.trim(); const name = profile.characterName.trim(); const time = new Date().toLocaleTimeString('zh-CN'); const createdAt = new Date().toISOString(); setTrial([{ id: now, from: 'user', text: `${name}，我今天想先和你打个招呼。`, time, createdAt, status: 'sent' }, { id: now + 1, from: 'character', text: user === '你' ? `好，就叫我${name}。暂时不填名字也没关系，我们慢慢认识。` : `${user}，听到了。你叫我${name}就好，想换称呼时随时告诉我。`, time, createdAt, status: 'sent' }]) }}>发送试聊</button> : <button className="primary" onClick={next}>称呼没问题，继续</button>}<button className="secondary" onClick={() => { setTrial([]); setStep(3) }}>纠正称呼</button></>}
    {step === 8 && <><h1>开始前，关于你的数据</h1><article className="intro-card glass"><p>聊天、称呼、偏好与记忆保存在本机 IndexedDB，不会自动同步到其他设备。清除浏览器数据或卸载可能导致记录丢失，请在“我的”导出加密备份。</p><p>配置 API Key 后，必要的聊天片段、相关记忆与互动偏好会直发 DeepSeek（或你设置的服务地址）以生成回复。未配置时仅为本机演示。</p><p>API Key 只保留在本次浏览器会话，不包含在备份内。你可以随时在“我的”修改接口与模型。</p></article><button className="secondary" onClick={() => setShowApi(current => !current)}>设置 API Key</button>{showApi && <label>DeepSeek API Key<input type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="可留空，先体验本机演示"/></label>}{error && <p role="alert">{error}</p>}<button className="primary" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await finish(profile, trial) } catch { setError('引导未完成：本机保存失败，请检查存储权限后重试。') } finally { setBusy(false) } }}>{busy ? '正在保存…' : '完成引导'}</button></>}
  </main>
}
