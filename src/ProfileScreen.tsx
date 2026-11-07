import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Bell, ChevronRight, Database, Globe2, Home, MemoryStick, MessageCircle, ShieldCheck, Sparkles, SunMoon, Users } from 'lucide-react'
import { useI18n } from './i18n'
import LanguageSettings from './LanguageSettings'
import DataTransferPanel from './DataTransferPanel'
import MemorySettings from './MemorySettings'
import type { MemoryPolicy } from './longMemory'
import { testDeepSeekConnection } from './chatService'
import { modelProvider, normalizeGatewayUrl, DEEPSEEK_ENDPOINT, DEEPSEEK_MODEL, MAGPIE_ENDPOINT, MAGPIE_MODEL, type ModelProvider } from './modelGateway'
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
  const [provider, setProvider] = useState<ModelProvider>(() => modelProvider(endpoint))
  const copy = (zh: string, en: string) => locale === 'en' ? en : zh
  const validGateway = (() => { try { const url = new URL(normalizeGatewayUrl(endpoint)); return url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]', '10.0.2.2'].includes(url.hostname) } catch { return false } })()
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
        <SettingRow icon={<MemoryStick />} label={t('AI 服务')} value={provider === 'magpie' ? 'Magpie' : provider === 'openai' ? copy('OpenAI 兼容网关', 'OpenAI-compatible gateway') : apiKey ? 'DeepSeek' : t('未配置')} onClick={() => setShowApi(!showApi)} expanded={showApi} controls="profile-api" />
        {showApi && <div id="profile-api" className="api-settings profile-inline-panel">
          <h3>{t('AI 服务')}</h3>
          <p>{copy('选择 OpenAI 兼容网关、DeepSeek 或 Magpie。自定义网关可填写 URL、模型名称和 API Key；Key 只保留在本次会话。', 'Choose an OpenAI-compatible gateway, DeepSeek or Magpie. Custom gateways accept a URL, model name and API Key; the Key is session-only.')}</p>
          <div className="provider-switch" role="radiogroup" aria-label={t('AI 服务')}><button role="radio" disabled={testing} aria-checked={provider === 'openai'} className={provider === 'openai' ? 'selected' : ''} onClick={() => { setProvider('openai'); setEndpoint(''); setModel(''); setApiKey(''); setResult(copy('请填写网关 URL、模型名称和 API Key', 'Enter the gateway URL, model name and API Key')) }}>{copy('OpenAI 兼容网关', 'OpenAI-compatible gateway')}</button><button role="radio" disabled={testing} aria-checked={provider === 'deepseek'} className={provider === 'deepseek' ? 'selected' : ''} onClick={() => { setProvider('deepseek'); setEndpoint(DEEPSEEK_ENDPOINT); setModel(DEEPSEEK_MODEL); setApiKey(''); setResult('请填写 DeepSeek API Key') }}>DeepSeek</button><button role="radio" disabled={testing} aria-checked={provider === 'magpie'} className={provider === 'magpie' ? 'selected' : ''} onClick={() => { setProvider('magpie'); setEndpoint(MAGPIE_ENDPOINT); setModel(MAGPIE_MODEL); setApiKey('magpie'); setResult('已切换到本地 Magpie 网关') }}>Magpie</button></div>
          {provider === 'openai' && <><label>{copy('网关 URL', 'Gateway URL')}<input type="url" aria-label={copy('网关 URL', 'Gateway URL')} value={endpoint} disabled={testing} onChange={event => { setEndpoint(event.target.value); setResult('') }} placeholder="https://gateway.example.com/v1" autoComplete="url" spellCheck={false}/></label><label>{copy('模型名称', 'Model name')}<input aria-label={copy('模型名称', 'Model name')} value={model} disabled={testing} onChange={event => { setModel(event.target.value); setResult('') }} placeholder="gpt-4o-mini" spellCheck={false}/></label><p className="api-provider-detail">{copy('支持根 URL、/v1 基础地址或完整接口地址。使用 HTTPS；本机 HTTP 可用 localhost、127.0.0.1 或 Android 模拟器的 10.0.2.2。不要把 Key 写在 URL 中。', 'Accepts a root URL, /v1 base URL or full endpoint. Use HTTPS; local HTTP can use localhost, 127.0.0.1 or Android emulator host 10.0.2.2. Do not put the Key in the URL.')}</p></>}
          {provider !== 'magpie' && <label>{provider === 'deepseek' ? 'DeepSeek API Key' : 'API Key'}<div className="secret-input"><input aria-label={provider === 'deepseek' ? 'DeepSeek API Key' : 'API Key'} type={visible ? 'text' : 'password'} value={apiKey} disabled={testing} onChange={event => { setApiKey(event.target.value); setResult('') }} placeholder="sk-…" autoComplete="off" spellCheck={false}/><button onClick={() => setVisible(!visible)}>{visible ? t('隐藏') : t('显示')}</button></div></label>}
          <p className="api-provider-detail">{provider === 'magpie' ? `${MAGPIE_MODEL} · ${MAGPIE_ENDPOINT}` : provider === 'deepseek' ? `${DEEPSEEK_MODEL} · ${DEEPSEEK_ENDPOINT}` : `${model || copy('待填写模型', 'Model required')} · ${endpoint || copy('待填写 URL', 'URL required')}`}</p>
          <div className="api-actions"><button className="test-api" onClick={() => void test()} disabled={testing || provider !== 'magpie' && !apiKey.trim() || provider === 'openai' && (!validGateway || !model.trim())}>{testing ? t('正在测试…') : t('测试连接')}</button>{provider !== 'magpie' && <button disabled={testing} onClick={() => { setApiKey(''); setResult('已删除本次会话中的 Key') }}>{t('删除 Key')}</button>}</div>
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
