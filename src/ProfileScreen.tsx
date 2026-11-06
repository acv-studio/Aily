import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Bell, ChevronRight, Database, Globe2, Home, MemoryStick, MessageCircle, ShieldCheck, Sparkles, SunMoon, Users } from 'lucide-react'
import { useI18n } from './i18n'
import LanguageSettings from './LanguageSettings'
import DataTransferPanel from './DataTransferPanel'
import MemorySettings from './MemorySettings'
import type { MemoryPolicy } from './longMemory'
import { testDeepSeekConnection } from './chatService'
import type { loadLocalData } from './db'
import { characters, type CharacterId } from './data'
import { useTheme, type ThemePreference } from './theme'
import './profile.css'
import BillingPanel from './BillingPanel'
import { useBilling } from './billing'

type Props = {
  userName: string
  primaryName: string
  primaryId: CharacterId
  setPrimary: (id: CharacterId) => Promise<void>
  policies?: Partial<Record<CharacterId, MemoryPolicy>>
  onPolicy?: (role: CharacterId, policy: MemoryPolicy) => Promise<void>
  apiKey: string
  endpoint: string
  model: string
  setApiKey: (value: string) => void
  setEndpoint: (value: string) => void
  setModel: (value: string) => void
  onImported: (data: Awaited<ReturnType<typeof loadLocalData>>) => void
  onCleared: () => void
  beforeDataChange: () => Promise<void>
  openPreferences: () => void
  openProactive: () => void
  openReminders?: () => void
  openInvite: () => void
  openPrivacy: () => void
}

function SettingRow({ icon, label, value, onClick, expanded, controls }: {
  icon: ReactNode; label: string; value?: string; onClick: () => void; expanded?: boolean; controls?: string
}) {
  return <button className="profile-setting-row" onClick={onClick} aria-label={value ? `${label} ${value}` : label} aria-expanded={expanded} aria-controls={controls}>
    {icon}<span>{label}</span>{value && <small>{value}</small>}<ChevronRight className="profile-chevron" aria-hidden="true" />
  </button>
}

export default function ProfileScreen(props: Props) {
  const { t, locale } = useI18n()
  const theme = useTheme()
  const billing = useBilling()
  const { primaryName, apiKey, endpoint, model, setApiKey, setEndpoint, setModel } = props
  const [showPrimary, setShowPrimary] = useState(false)
  const [savingPrimary, setSavingPrimary] = useState(false)
  const primarySavePending = useRef(false)
  const [primaryResult, setPrimaryResult] = useState<'success' | 'error' | null>(null)
  const choosePrimary = async (id: CharacterId) => {
    if (primarySavePending.current || id === props.primaryId) return
    primarySavePending.current = true
    setSavingPrimary(true)
    setPrimaryResult(null)
    try {
      await props.setPrimary(id)
      setPrimaryResult('success')
    } catch {
      setPrimaryResult('error')
    } finally {
      primarySavePending.current = false
      setSavingPrimary(false)
    }
  }
  const [showApi, setShowApi] = useState(false)
  const [provider, setProvider] = useState<'magpie' | 'deepseek'>(() => endpoint.includes('magpie') ? 'magpie' : 'deepseek')
  const [showLanguage, setShowLanguage] = useState(false)
  const [showAppearance, setShowAppearance] = useState(false)
  const [showLocalData, setShowLocalData] = useState(false)
  const [showMembership, setShowMembership] = useState(false)
  const [visible, setVisible] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState('')
  const test = async () => {
    setTesting(true); setResult('')
    try { await testDeepSeekConnection({ apiKey, endpoint, model }); setResult('连接成功，可以开始聊天') }
    catch (error) { setResult(error instanceof Error ? error.message : '连接失败') }
    finally { setTesting(false) }
  }

  if (showMembership) return <BillingPanel close={() => setShowMembership(false)} openPrivacy={props.openPrivacy} />
  return <section className="screen profile profile-screen">
    <article className="plan-card">
      <div className="profile-plan-top"><span><Sparkles aria-hidden="true" /> Aily Plus</span><small>{billing.entitlement.productId ? `${billing.entitlement.multiplier}× ${locale === 'en' ? 'Monthly pass' : '月卡'}` : t('免费版')}</small></div>
      <h3>{t('让每一段故事，都被好好记住')}</h3>
      <p className="profile-membership-note">{locale === 'en' ? `Available: ${billing.balance} points · Daily quota ${billing.dailyQuota}` : `可用 ${billing.balance} 积分 · 每日额度 ${billing.dailyQuota}`}</p>
      <button onClick={() => setShowMembership(true)}>{locale === 'en' ? 'Check in & monthly passes' : '签到与月卡'}<ChevronRight size={14} aria-hidden="true" /></button>
    </article>

    <section className="profile-group" aria-labelledby="profile-companion-heading">
      <h3 id="profile-companion-heading">{t('陪伴与互动')}</h3>
      <div className="profile-settings glass">
        <SettingRow icon={<Home />} label={t('主角色')} value={t(primaryName)} onClick={() => setShowPrimary(!showPrimary)} expanded={showPrimary} controls="profile-primary" />
        {showPrimary && <div id="profile-primary" className="profile-inline-panel profile-primary-panel">
          <p id="profile-primary-help">{t('选择后自动保存，不会改变各角色的聊天与记忆。')}</p>
          <div className="profile-primary-options" role="radiogroup" aria-label={t('主角色')} aria-describedby="profile-primary-help" aria-busy={savingPrimary}>
            {characters.map(character => <label key={character.id} className="profile-primary-option" style={{ '--accent': character.accent } as CSSProperties}>
              <input type="radio" name="profile-primary-character" aria-label={`${t(character.name)} ${t(character.title)}`} value={character.id} checked={props.primaryId === character.id} disabled={savingPrimary} onChange={() => void choosePrimary(character.id)} />
              <span className="profile-primary-avatar" aria-hidden="true">{t(character.avatar)}</span>
              <span className="profile-primary-copy"><strong>{t(character.name)}</strong><small>{t(character.title)}</small></span>
            </label>)}
          </div>
          {savingPrimary && <p className="profile-primary-feedback" role="status">{t('正在保存主角色…')}</p>}
          {primaryResult === 'success' && <p className="profile-primary-feedback" role="status">{t('主角色已更新')}</p>}
          {primaryResult === 'error' && <p className="profile-primary-feedback profile-primary-error" role="alert">{t('主角色保存失败，请重新选择以重试。')}</p>}
        </div>}
        <SettingRow icon={<Users />} label={t('修改称呼与互动偏好')} onClick={props.openPreferences} />
        {props.openReminders && <SettingRow icon={<Bell />} label={t('智能提醒')} onClick={props.openReminders} />}
        <SettingRow icon={<MessageCircle />} label={t('主动提醒设置')} onClick={props.openProactive} />
      </div>
      {props.onPolicy && <MemorySettings policies={props.policies || {}} onPolicy={props.onPolicy} />}
    </section>

    <section className="profile-group" aria-labelledby="profile-general-heading">
      <h3 id="profile-general-heading">{t('通用设置')}</h3>
      <div className="profile-settings glass">
        <SettingRow icon={<MemoryStick />} label={t('AI 服务')} value={provider === 'magpie' ? 'Magpie' : apiKey ? 'DeepSeek' : t('未配置')} onClick={() => setShowApi(!showApi)} expanded={showApi} controls="profile-api" />
        {showApi && <div id="profile-api" className="api-settings profile-inline-panel">
          <h3>{t('AI 服务')}</h3>
          <p>{t('选择 DeepSeek 或本地 Magpie 网关。DeepSeek 需要你填写自己的 Key；Magpie 使用本机默认网关。')}</p>
          <div className="provider-switch" role="radiogroup" aria-label={t('AI 服务')}><button role="radio" aria-checked={provider === 'magpie'} className={provider === 'magpie' ? 'selected' : ''} onClick={() => { setProvider('magpie'); setEndpoint('/api/magpie/v1/messages'); setModel('ferry/claude-gpt-5-6-luna'); setApiKey('magpie'); setResult('已切换到本地 Magpie 网关') }}>Magpie</button><button role="radio" aria-checked={provider === 'deepseek'} className={provider === 'deepseek' ? 'selected' : ''} onClick={() => { setProvider('deepseek'); setEndpoint('https://api.deepseek.com/chat/completions'); setModel('deepseek-chat'); setApiKey(''); setResult('请填写 DeepSeek API Key') }}>DeepSeek</button></div>
          {provider === 'deepseek' && <label>DeepSeek API Key<div className="secret-input"><input aria-label="DeepSeek API Key" type={visible ? 'text' : 'password'} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="sk-…" /><button onClick={() => setVisible(!visible)}>{visible ? t('隐藏') : t('显示')}</button></div></label>}
          <p className="api-provider-detail">{provider === 'magpie' ? 'ferry/claude-gpt-5-6-luna · /api/magpie/v1/messages' : 'deepseek-chat · https://api.deepseek.com/chat/completions'}</p>
          <div className="api-actions"><button className="test-api" onClick={() => void test()} disabled={testing || provider === 'deepseek' && !apiKey.trim()}>{testing ? t('正在测试…') : t('测试连接')}</button>{provider === 'deepseek' && <button onClick={() => { setApiKey(''); setResult('已删除本次会话中的 Key') }}>{t('删除 Key')}</button>}</div>
          {result && <p className="api-result" role="status">{t(result)}</p>}
        </div>}
        <SettingRow icon={<SunMoon />} label={locale === 'en' ? 'Appearance' : '外观模式'} value={theme.preference === 'system' ? (locale === 'en' ? 'System' : '跟随系统') : theme.preference === 'light' ? (locale === 'en' ? 'Light' : '浅色') : (locale === 'en' ? 'Dark' : '深色')} onClick={() => setShowAppearance(!showAppearance)} expanded={showAppearance} controls="profile-appearance" />
        {showAppearance && <div id="profile-appearance" className="profile-inline-panel appearance-settings" role="radiogroup" aria-label={locale === 'en' ? 'Appearance' : '外观模式'}>{([['system', locale === 'en' ? 'Follow system' : '跟随系统'], ['light', locale === 'en' ? 'Light' : '浅色'], ['dark', locale === 'en' ? 'Dark' : '深色']] as [ThemePreference,string][]).map(([value,label]) => <button key={value} role="radio" aria-checked={theme.preference === value} className={theme.preference === value ? 'selected' : ''} onClick={() => theme.setTheme(value)}>{label}</button>)}</div>}
        <SettingRow icon={<Globe2 />} label={t('语言设置')} value={locale === 'zh-CN' ? '简体中文' : 'English'} onClick={() => setShowLanguage(!showLanguage)} expanded={showLanguage} controls="profile-language" />
        {showLanguage && <div id="profile-language" className="profile-inline-panel"><LanguageSettings /></div>}
        <SettingRow icon={<Users />} label={t('邀请朋友')} onClick={props.openInvite} />
        <SettingRow icon={<ShieldCheck />} label={t('安全与隐私')} onClick={props.openPrivacy} />
      </div>
    </section>

    <section className="profile-group" aria-labelledby="profile-data-heading">
      <h3 id="profile-data-heading">{t('本机数据')}</h3>
      <div className="profile-settings glass"><SettingRow icon={<Database />} label={t('本机聊天与记忆')} value={showLocalData ? t('收起') : t('已隐藏')} onClick={() => setShowLocalData(!showLocalData)} expanded={showLocalData} controls="profile-local-data" /></div>
      {showLocalData && <div id="profile-local-data"><DataTransferPanel beforeDataChange={props.beforeDataChange} onImported={props.onImported} onCleared={props.onCleared} /></div>}
    </section>
    <p className="ai-note"><ShieldCheck aria-hidden="true" />{t('Aily 是 AI 角色陪伴应用，不是真人或专业医疗服务')}</p>
  </section>
}
