import { useEffect, useState, type CSSProperties } from 'react'
import { BookOpen, ChevronRight, ContactRound, Image, MessageCircle, Music2, ShoppingBag, Sparkles, Wallet, type LucideIcon } from 'lucide-react'
import { characters, type Character, type CharacterId } from './data'
import type { ChatMessage } from './chatService'
import { useI18n } from './i18n'
import ClockWidget from './ClockWidget'
import WeatherWidget from './WeatherWidget'
import DesktopTools, { type DesktopTool } from './DesktopTools'
import { extensionApps, installedExtensionIds, type ExtensionAppId } from './extensionApps'
import './home.css'
import { ensureDefaultExtensionsInstalled } from './defaultExtensions'

type Props = {
  selected: CharacterId
  primaryId?: CharacterId
  primaryName?: string
  conversations: Partial<Record<CharacterId, ChatMessage[]>>
  modelConfig?: { apiKey: string; endpoint: string; model: string }
  openChat: (id: CharacterId) => void
}
const tools: { id: DesktopTool; label: string; english: string; icon: LucideIcon; color: string }[] = [
  { id: 'ledger', label: '记账', english: 'Expenses', icon: Wallet, color: '#9ee7c6' },
  { id: 'album', label: '相册', english: 'Photos', icon: Image, color: '#f6bbcc' },
  { id: 'contacts', label: '通讯录', english: 'Contacts', icon: ContactRound, color: '#abc8ff' },
  { id: 'music', label: '音乐', english: 'Music', icon: Music2, color: '#c2b1ff' },
  { id: 'diary', label: '日记', english: 'Journal', icon: BookOpen, color: '#f4d5a3' },
  { id: 'app-store', label: '应用商店', english: 'App Store', icon: ShoppingBag, color: '#b8a6ff' },
  { id: 'divination', label: '梅花易数', english: 'Meihua', icon: Sparkles, color: '#e6b4fa' },
]
function Avatar({ character }: { character: Character }) {
  const { t } = useI18n()
  return <span className="avatar" aria-hidden="true" style={{ '--accent': character.accent } as CSSProperties}>{t(character.avatar)}</span>
}

export default function HomeScreen({ selected, primaryId = selected, primaryName, conversations, modelConfig, openChat }: Props) {
  const { t, locale } = useI18n()
  const [tool, setTool] = useState<DesktopTool | null>(null)
  const [installedExtensions,setInstalledExtensions]=useState<ExtensionAppId[]>(installedExtensionIds)
  const [defaultInstallFailed, setDefaultInstallFailed] = useState(false)
  const retryDefaultInstall = () => { try { ensureDefaultExtensionsInstalled(); setInstalledExtensions(installedExtensionIds()); setDefaultInstallFailed(false) } catch { setDefaultInstallFailed(true) } }
  useEffect(()=>{retryDefaultInstall();const refresh=()=>setInstalledExtensions(installedExtensionIds());window.addEventListener('aily-extension-apps',refresh);window.addEventListener('storage',refresh);return()=>{window.removeEventListener('aily-extension-apps',refresh);window.removeEventListener('storage',refresh)}},[])
  const [partnersOpen, setPartnersOpen] = useState(false)
  const primary = characters.find(character => character.id === primaryId) || characters[0]
  const name = primaryName || t(primary.name)
  const latest = conversations[primary.id]?.filter(message => !message.withdrawn).at(-1)
  const preview = !latest ? (locale === 'en' ? 'Your everyday companion. Say hello.' : '日常的碎碎念，都可以说给我听。')
    : latest.kind === 'image' ? t('图片消息') : latest.kind === 'audio' ? t('语音消息') : latest.kind === 'video' ? (locale === 'en' ? 'Video message' : '视频消息') : latest.text
  const installedApps=extensionApps.filter(app=>installedExtensions.includes(app.id))
  const appPages=Array.from({length:Math.ceil((tools.length+installedApps.length)/6)},(_,page)=>[...tools.map(item=>({kind:'built' as const,...item})),...installedApps.map(item=>({kind:'extension' as const,...item}))].slice(page*6,page*6+6))
  return <section className="screen home-screen message-home desktop-home">
    <div inert={tool !== null}>
      <section className="dashboard-widget glass" aria-label={locale === 'en' ? 'Time and weather' : '时间与天气'}><div className="desktop-widgets"><ClockWidget /><WeatherWidget /></div></section>
      <div className="desktop-section-heading"><span>{locale === 'en' ? 'YOUR COMPANION' : '专属陪伴'}</span><span className="desktop-section-line" /></div>
      <button className="desktop-bot glass" style={{ '--accent': primary.accent } as CSSProperties} onClick={() => openChat(primary.id)} aria-label={t('与{name}聊天', { name })}>
        <Avatar character={primary} />
        <div className="desktop-bot-copy"><div className="desktop-bot-title"><strong>{name}</strong><span>{locale === 'en' ? 'Main Bot' : '主 Bot'}</span></div><p>{preview}</p><small><MessageCircle size={12} />{locale === 'en' ? 'Tap to chat' : '点一下，开始聊天'}</small></div>
        <ChevronRight size={18} className="desktop-bot-chevron" />
      </button>
      <div className="desktop-section-heading desktop-tools-heading"><span>{locale === 'en' ? 'LITTLE THINGS, EVERY DAY' : '把日子过成喜欢的样子'}</span><span className="desktop-section-line" /></div>
      {defaultInstallFailed && <p role="alert">{locale === 'en' ? 'Default apps could not be added. Existing data is unchanged.' : '默认应用添加失败，原有应用数据未更改。'} <button onClick={retryDefaultInstall}>{locale === 'en' ? 'Retry' : '重试'}</button></p>}
      <div className="desktop-app-pages" role="group" aria-label={locale === 'en' ? 'Everyday apps' : '日常小应用'}>{appPages.map((page,index)=><div className="desktop-app-grid" key={index}>{page.map(app=>{if(app.kind==='built'){const Icon=app.icon;return <button key={app.id} className="desktop-app" onClick={()=>setTool(app.id)}><span className={`desktop-app-icon desktop-icon-${app.id}`} style={{'--tool-color':app.color} as CSSProperties}><Icon size={27} strokeWidth={1.65}/></span><span>{locale==='en'?app.english:app.label}</span></button>}return <button key={app.id} className="desktop-app" onClick={()=>setTool(app.id)}><span className="desktop-app-icon extension-installed-icon" style={{'--tool-color':app.color} as CSSProperties}>{app.icon}</span><span>{locale==='en'?app.english:app.name}</span></button>})}</div>)}</div>
      <button className="desktop-partners-toggle" aria-expanded={partnersOpen} aria-controls="desktop-partners" onClick={() => setPartnersOpen(value => !value)}>{locale === 'en' ? 'Find chat companions' : '寻找聊天伙伴'}<ChevronRight size={14} className={partnersOpen ? 'expanded' : ''} /></button>
      {partnersOpen && <div id="desktop-partners" className="companion-strip" role="group" aria-label={t('聊天伙伴')}>
        {characters.map(character => <button key={character.id} className={`companion-tile glass ${selected === character.id ? 'selected' : ''}`} style={{ '--accent': character.accent } as CSSProperties} aria-label={t('打开{name}的会话', { name: t(character.name) })} aria-pressed={selected === character.id} onClick={() => openChat(character.id)}><Avatar character={character} /><strong>{t(character.name)}</strong><small>{t(character.title)}</small></button>)}
      </div>}
      <p className="desktop-home-note">{locale === 'en' ? 'A small corner for you and your everyday life.' : '你的生活，你的小小宇宙。'}</p>
    </div>
    {tool && <DesktopTools tool={tool} modelConfig={modelConfig} onOpenTool={setTool} onClose={() => setTool(null)} />}
  </section>
}
