import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import SafetyPrivacyPanel, { SafetyConsent } from './SafetyPrivacyPanel'
import { acceptSafetyConsent, acquireUsageLease, deleteLocalProfile, hasSafetyConsent } from './privacy'
import { t, useI18n } from './i18n'
import LanguageSettings from './LanguageSettings'
import { ArrowLeft, Bell, BookHeart, ChevronRight, CircleUserRound, Heart, Home, Image, MemoryStick, MessageCircle, MoreHorizontal, Plus, Send, ShieldCheck, ShoppingBag, Sparkles, Volume2 } from 'lucide-react'
import { characters, moments, type CharacterId } from './data'
import { testDeepSeekConnection } from './chatService'
import { db, loadLocalData } from './db'
import RockPaperScissors from './RockPaperScissors'
import InteractiveStory from './InteractiveStory'
import SevenDayStory from './SevenDayStoryPanel'
import DataTransferPanel from './DataTransferPanel'
import ChatPanel from './ChatPanel'
import MemoryPanel from './MemoryPanel'
import useLocalChat from './useLocalChat'
import GiftStorePanel from './GiftStorePanel'
import ProactiveSettingsPanel from './ProactiveSettingsPanel'
import Onboarding, { OnboardingEditor } from './OnboardingFlow'
import { defaultOnboardingProfile, normalizeOnboardingProfile, type OnboardingProfile } from './onboarding'
import type { ChatMessage } from './chatService'
import CharacterSplash from './CharacterSplash'
import CharacterSplashSettings from './CharacterSplashSettings'
import { defaultSplashSettings, getCharacterActivity, loadSplashSettings, saveSplashSettings, type SplashSettings } from './characterPresence'

type Tab = 'home' | 'moments' | 'memories' | 'store' | 'profile'

export default function App() {
  useI18n()
  const [phase, setPhase] = useState<'loading' | 'active' | 'deleting' | 'deleted' | 'error'>('loading')
  const [error, setError] = useState('')
  const release = useRef<(() => Promise<void>) | null>(null)
  useEffect(() => {
    let disposed = false
    void acquireUsageLease().then(lease => { if (disposed) void lease(); else { release.current = lease; setPhase('active') } }).catch(() => { setError('无法保护本机数据，请重新打开页面'); setPhase('error') })
    return () => { disposed = true; void release.current?.() }
  }, [])
  const deleteProfile = async () => {
    flushSync(() => setPhase('deleting')) // Unmount data consumers before releasing this tab's lease.
    try { await release.current?.(); release.current = null; await deleteLocalProfile(); setPhase('deleted') }
    catch (failure) { setError(failure instanceof Error ? failure.message : '删除未完成，部分资料可能已删除。请重试。'); setPhase('error') }
  }
  if (phase === 'active') return <AilyApp onDelete={deleteProfile} />
  return <main className="app-shell loading-screen"><h1>{phase === 'deleted' ? t('本机使用资料已删除') : phase === 'error' ? t('操作未完成') : phase === 'deleting' ? t('正在删除本机资料…') : t('正在保护本机数据…')}</h1>{phase === 'error' && <><p role="alert">{t(error)}</p><p>{t('删除失败时可能已有部分资料被清除；尚未确认全部完成。')}</p><button onClick={() => void deleteProfile()}>{t('重试删除')}</button></>}{(phase === 'deleted' || phase === 'error') && <button onClick={() => window.location.reload()}>{phase === 'deleted' ? t('重新开始') : t('重新打开应用')}</button>}</main>
}

function AilyApp({ onDelete }: { onDelete: () => Promise<void> }) {
  useI18n()
  const chat = useLocalChat()
  const { onboarded, selected, conversations, draft, setDraft, replying, error: chatError } = chat
  const [tab, setTab] = useState<Tab>('home')
  const [chatOpen, setChatOpen] = useState(false)
  const [gameOpen, setGameOpen] = useState(false)
  const [storyOpen, setStoryOpen] = useState(false)
  const [proactiveOpen, setProactiveOpen] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [consented, setConsented] = useState(hasSafetyConsent)
  const deleteProfile = async () => { await chat.prepareForDeletion(); await onDelete() }
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const userName = chat.onboardingProfile?.userName && chat.onboardingProfile.userName !== '你' ? chat.onboardingProfile.userName : '我'
  const character = characters.find(item => item.id === selected) || characters[0]
  const messages = conversations[selected]
  const setSelected = chat.setSelected
  const [splashSettings, setSplashSettings] = useState<SplashSettings>(defaultSplashSettings('lu'))
  const primaryName = characters.find(role => role.id === splashSettings.primary)!.name
  const [entryReady, setEntryReady] = useState(false)
  const [splashOpen, setSplashOpen] = useState(false)
  const [entryTime, setEntryTime] = useState(() => new Date())
  const entryStarted = useRef(false)
  const selectForEntry = useRef(setSelected); selectForEntry.current = setSelected
  useEffect(() => {
    if (!chat.ready || entryStarted.current) return
    if (!onboarded) { entryStarted.current = true; setEntryReady(true); return }
    let active = true
    const finishEntry = (settings: SplashSettings) => {
      if (!active) return
      active = false; entryStarted.current = true
      setSplashSettings(settings); setEntryTime(new Date())
      selectForEntry.current(settings.primary); setSplashOpen(settings.enabled); setEntryReady(true)
    }
    // Local settings must not hold the startup page indefinitely.
    const initialPrimary = chat.onboardingProfile?.characterId || selected
    const fallback = { ...defaultSplashSettings(initialPrimary), enabled: false, personalized: false, staticScene: true }
    const timeout = window.setTimeout(() => finishEntry(fallback), 1500)
    void loadSplashSettings(initialPrimary).then(finishEntry, () => finishEntry(fallback))
    return () => { active = false; window.clearTimeout(timeout) }
  }, [chat.ready, onboarded, selected, chat.onboardingProfile?.characterId])
  const finishOnboarding = async (profile: OnboardingProfile, messages: ChatMessage[]) => {
    const settings = defaultSplashSettings(profile.characterId)
    await saveSplashSettings(settings)
    await chat.finishOnboarding(profile, messages)
    setSplashSettings(settings)
  }
  const updateSplashSettings = async (settings: SplashSettings) => {
    await saveSplashSettings(settings); setSplashSettings(settings)
  }
  const hiddenAt = useRef<number | null>(null)
  useEffect(() => {
    if (!chat.ready || !entryReady || !onboarded) return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenAt.current = Date.now(); return }
      const away = hiddenAt.current === null ? 0 : Date.now() - hiddenAt.current
      hiddenAt.current = null
      setEntryTime(new Date())
      // Never replace active chat (including attachments/recording), settings or games.
      if (away < 60_000 || tab !== 'home' || chatOpen || replying || splashOpen || !splashSettings.enabled) return
      selectForEntry.current(splashSettings.primary); setSplashOpen(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    const clock = window.setInterval(() => { if (document.visibilityState === 'visible') setEntryTime(new Date()) }, 60_000)
    return () => { document.removeEventListener('visibilitychange', onVisibility); window.clearInterval(clock) }
  }, [chat.ready, entryReady, onboarded, tab, chatOpen, replying, splashOpen, splashSettings])
  const reloadLocalState = async () => {
    await chat.reload()
    const data = await loadLocalData()
    const fallback = normalizeOnboardingProfile(data.settings.onboardingProfile)?.characterId || characters.find(role => role.id === data.settings.selected)?.id || 'lu'
    setSplashSettings(await loadSplashSettings(fallback)); setEntryTime(new Date())
  }
  const activity = getCharacterActivity(selected, entryTime, splashSettings.personalized)
  const saveGameMemory = (text: string) => { void chat.saveConfirmed({ text, category: 'relationship' }).catch(() => alert('回忆保存失败，请重试')) }
  if (!chat.ready || !entryReady) return <main className="app-shell loading-screen"><p>{chat.loadError || '正在读取本机聊天与记忆…'}</p>{chat.loadError && <button onClick={chat.reload}>重试读取</button>}</main>
  if (onboarded && !consented && !hasSafetyConsent()) return <main className="onboarding"><SafetyConsent returning onAccepted={() => { acceptSafetyConsent(); setConsented(true); setEntryTime(new Date()) }} /></main>
  if (privacyOpen) return <main className="app-shell"><SafetyPrivacyPanel close={() => setPrivacyOpen(false)} onDelete={deleteProfile} /></main>
  if (splashOpen) return <CharacterSplash character={character} activity={activity} staticScene={splashSettings.staticScene} onHome={() => { setSplashOpen(false); setTab('home') }} onChat={() => { setSplashOpen(false); setChatOpen(true) }} />
  if (chatOpen) return <><ChatPanel character={character} messages={chat.chatMessages} temporary={chat.temporary} toggleTemporary={chat.toggleTemporary} pendingCount={chat.memories.filter(memory => memory.characterId === selected && memory.state === 'pending').length} draft={draft} setDraft={setDraft} send={chat.send} close={() => { if (!replying) setChatOpen(false) }} saveMemory={chat.saveConfirmed} withdraw={chat.withdraw} stop={chat.stop} replying={replying} error={chatError} demo={!chat.apiKey} openGame={() => setGameOpen(true)} openStory={() => setStoryOpen(true)} />{gameOpen && <RockPaperScissors characterName={character.name} onComplete={saveGameMemory} onClose={() => setGameOpen(false)} />}{storyOpen && (selected === 'lu' ? <SevenDayStory temporary={chat.temporary} onSaved={() => { void db.memories.toArray().then(chat.setMemories).catch(() => alert('故事已保存，回忆列表暂未刷新；重新打开应用可读取')) }} onClose={() => setStoryOpen(false)} /> : <InteractiveStory characterName={character.name} onComplete={saveGameMemory} onClose={() => setStoryOpen(false)} />)}</>
  if (!onboarded) return <Onboarding selected={selected} setSelected={setSelected} finish={finishOnboarding} apiKey={chat.apiKey} setApiKey={chat.setApiKey} />
  if (preferencesOpen) return <OnboardingEditor initial={chat.onboardingProfile || defaultOnboardingProfile(selected)} save={chat.updateOnboarding} close={() => setPreferencesOpen(false)} />

  return <main className="app-shell">
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <header className="topbar"><div><p className="eyebrow">晚上好，{chat.onboardingProfile?.userName === '你' ? '欢迎回来' : chat.onboardingProfile?.userName || '欢迎回来'}</p><h1>{tab === 'home' ? '有人一直记得你' : tab === 'moments' ? '他们的此刻' : tab === 'memories' ? '我们的回忆' : tab === 'store' ? '一份小心意' : '我的 Aily'}</h1></div><button className="icon-button" aria-label="通知"><Bell size={20}/><i /></button></header>
    {tab === 'home' && <HomeScreen selected={selected} select={setSelected} activity={activity} lastMessage={messages.filter(item => !item.withdrawn).at(-1)?.text || '还没有聊天记录，先打个招呼吧'} openChat={() => setChatOpen(true)} />}
    {tab === 'moments' && <MomentsScreen userName={userName} onChat={(text)=>{setSelected('lu');setDraft(text);setChatOpen(true)}} />}
    {tab === 'memories' && <MemoryPanel memories={chat.memories} selected={selected} onSave={chat.saveConfirmed} onUpdate={chat.editMemory} onDelete={chat.removeMemory} onClear={chat.clearMemories} summaries={chat.summaries} policies={chat.policies} onPolicy={chat.changePolicy} onConfirm={chat.approveProposal} conversations={chat.conversations} />}
    {tab === 'profile' && proactiveOpen && <ProactiveSettingsPanel selected={selected} close={() => setProactiveOpen(false)} />}
    {tab === 'profile' && !proactiveOpen && <section className="screen" style={{ paddingBottom: 0 }}><CharacterSplashSettings settings={splashSettings} onSave={updateSplashSettings} /><button className="proactive-entry glass" aria-label="角色主动消息设置" onClick={() => setProactiveOpen(true)}>角色主动消息设置 <ChevronRight size={18} /></button><button className="proactive-entry glass" aria-label="安全与隐私" onClick={() => setPrivacyOpen(true)}>安全与隐私 <ShieldCheck size={18} /></button></section>}
    {tab === 'profile' && !proactiveOpen && <><button className="secondary" style={{ margin: '0 20px 16px' }} onClick={() => setPreferencesOpen(true)}>修改称呼与互动偏好</button><ProfileScreen userName={userName} primaryName={primaryName} beforeDataChange={chat.beforeDataChange} apiKey={chat.apiKey} endpoint={chat.endpoint} model={chat.model} setApiKey={chat.setApiKey} setEndpoint={chat.setEndpoint} setModel={chat.setModel} onImported={() => { void reloadLocalState().catch(() => alert('主角色设置读取失败，请重新打开应用')) }} onCleared={() => { void reloadLocalState().catch(() => alert('主角色设置读取失败，请重新打开应用')) }} /></>}
    {tab === 'store' && <GiftStorePanel selected={selected} />}
    {!(tab === 'profile' && proactiveOpen) && <nav className="bottom-nav glass">
      <NavButton active={tab==='home'} icon={<MessageCircle/>} label={t("消息")} onClick={()=>setTab('home')}/>
      <NavButton active={tab==='moments'} icon={<Sparkles/>} label={t("此刻")} onClick={()=>setTab('moments')}/>
      <NavButton active={tab==='memories'} icon={<BookHeart/>} label={t("回忆")} onClick={()=>setTab('memories')}/>
      <NavButton active={tab==='store'} icon={<ShoppingBag/>} label={t("商城")} onClick={()=>setTab('store')}/>
      <NavButton active={tab==='profile'} icon={<CircleUserRound/>} label={t("我的")} onClick={()=>setTab('profile')}/>
    </nav>}
  </main>
}

function HomeScreen({selected,select,openChat,lastMessage,activity}:{selected:CharacterId;select:(id:CharacterId)=>void;openChat:()=>void;lastMessage:string;activity:ReturnType<typeof getCharacterActivity>}) {
 const current=characters.find(c=>c.id===selected)!
 return <section className="screen home-screen"><article className="presence-card" style={{'--accent':current.accent} as React.CSSProperties}><div className="presence-art"><div className="moon"/><div className="portrait"><span>{current.avatar}</span></div><span className="online-dot"/></div><div className="presence-copy"><div><span className="status"><i/>{activity.status}</span><h2>{current.name}</h2><p>“{activity.quote}”</p></div><button className="talk-button" onClick={openChat}><MessageCircle size={20}/> 去找他</button></div></article><div className="section-title"><h3>最近消息</h3><button>全部</button></div><button className="conversation glass" onClick={openChat}><Avatar character={current}/><div><strong>{current.name}<small>AI</small></strong><p>{lastMessage}</p></div></button><div className="section-title"><h3>其他角色</h3><span>随时可以认识</span></div><div className="mini-characters">{characters.filter(c=>c.id!==selected).map(c=><button key={c.id} className="mini-card glass" onClick={()=>select(c.id)}><Avatar character={c}/><div><strong>{c.name}</strong><span>{c.status}</span></div><ChevronRight/></button>)}</div></section>
}

function MomentsScreen({userName,onChat}:{userName:string;onChat:(text:string)=>void}){const [liked,setLiked]=useState<number[]>([]);const [commenting,setCommenting]=useState<number|null>(null);const [draft,setDraft]=useState('');const [comments,setComments]=useState<Record<number,string[]>>({});const submit=(id:number)=>{if(!draft.trim())return;setComments(current=>({...current,[id]:[...(current[id]||[]),draft.trim()]}));setDraft('');setCommenting(null)};return <section className="screen feed"><div className="feed-hero"><p>{t("这一刻，他们也在生活")}</p><span>{t("所有内容均由 AI 角色生成")}</span></div>{moments.map((m,i)=><article className="moment glass" key={m.id}><header><span className={`simple-avatar a${i}`}>{t(m.avatar)}</span><div><strong>{t(m.character)}<small>AI</small></strong><time>{t(m.time)}</time></div><MoreHorizontal/></header><p>{t(m.text)}</p><div className={`moment-visual ${m.visual}`}><span>{m.visual==='dinner'?t("今晚的晚饭"):t("18:32 的天空")}</span></div>{(comments[m.id]||[]).map((comment,index)=><div className="moment-comment" key={index}><strong>{userName}</strong> {comment}<p><strong>{t(m.character)}</strong> {i===0?t("给你留着，回来趁热吃。"):t("拍给你看的，勉强还行吧。")}</p><button onClick={()=>onChat(t('回复你刚才的动态：“{text}”', { text: t(m.text) }))}>{t("私聊回应")}</button></div>)}{commenting===m.id&&<div className="comment-box"><input aria-label={t("评论内容")} value={draft} onChange={event=>setDraft(event.target.value)} placeholder={t("写下评论…")}/><button onClick={()=>submit(m.id)}>{t("发送")}</button></div>}<footer><button className={liked.includes(m.id)?'liked':''} onClick={()=>setLiked(current=>current.includes(m.id)?current.filter(id=>id!==m.id):[...current,m.id])}><Heart fill={liked.includes(m.id)?'currentColor':'none'}/> {m.likes+(liked.includes(m.id)?1:0)}</button><button onClick={()=>setCommenting(m.id)}><MessageCircle/> {m.comments+(comments[m.id]?.length||0)}</button><button aria-label={t('回应动态')} onClick={()=>onChat(t('我看到你的动态了：“{text}”', { text: t(m.text) }))}><Send/></button></footer></article>)}</section>}
function ProfileScreen({userName,primaryName,apiKey,endpoint,model,setApiKey,setEndpoint,setModel,onImported,onCleared,beforeDataChange}:{userName:string;primaryName:string;beforeDataChange:()=>Promise<void>;apiKey:string;endpoint:string;model:string;setApiKey:(value:string)=>void;setEndpoint:(value:string)=>void;setModel:(value:string)=>void;onImported:(data:Awaited<ReturnType<typeof loadLocalData>>)=>void;onCleared:()=>void}){const [showApi,setShowApi]=useState(false);const [visible,setVisible]=useState(false);const [testing,setTesting]=useState(false);const [result,setResult]=useState('');const [backupPassword,setBackupPassword]=useState('');const test=async()=>{setTesting(true);setResult('');try{await testDeepSeekConnection({apiKey,endpoint,model});setResult("连接成功，可以开始聊天")}catch(error){setResult(error instanceof Error?error.message:"连接失败")}finally{setTesting(false)}};const download=async()=>{try{await beforeDataChange();const encrypted=await encryptBackup(await exportData(),backupPassword);const blob=new Blob([encrypted],{type:'application/json'});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=`aily-backup-${new Date().toISOString().slice(0,10)}.json`;anchor.click();URL.revokeObjectURL(url);setResult("加密备份已导出，API Key 不包含在文件中")}catch(error){setResult(error instanceof Error?error.message:"导出失败")}};const upload=async(file?:File)=>{if(!file)return;if(!window.confirm(t("导入会替换本机全部聊天和记忆。确认已备份当前数据并继续？")))return;try{await beforeDataChange();const data=await importData(await decryptBackup(await file.text(),backupPassword));onImported(data);setResult("备份导入成功")}catch(error){setResult(error instanceof Error?error.message:"导入失败")}};const clear=async()=>{if(!window.confirm(t("确定清空本机全部聊天和记忆吗？此操作无法撤销。")))return;try{await beforeDataChange();await clearAllData();onCleared();setResult("本机聊天和记忆已清空")}catch(error){setResult(error instanceof Error?error.message:"清空失败")}};return <section className="screen profile"><LanguageSettings /><div className="profile-card glass"><div className="profile-avatar">{Array.from(userName)[0]}</div><div><h2>{userName}</h2><p>{t("本机陪伴档案")}</p></div><ChevronRight/></div><div className="plan-card"><span><Sparkles/> Aily Plus</span><h3>{t("让每一段故事，都被好好记住")}</h3><button>{t("了解会员")}</button></div><div className="settings glass"><button onClick={()=>setShowApi(!showApi)}><MemoryStick/><span>{t("DeepSeek 连接")}</span><small>{apiKey?t("已配置"):t("演示模式")}</small><ChevronRight/></button>{[[Home,t("主角色"),t(primaryName)],[ShoppingBag,t("会员与权益"),t("免费版")],[ShieldCheck,t("隐私与安全"),t("本地存储")]].map(([Icon,label,value])=><button key={t(String(label))}><Icon/><span>{String(label)}</span><small>{String(value)}</small><ChevronRight/></button>)}</div>{showApi&&<div className="api-settings glass"><h3>{t("DeepSeek 连接")}</h3><p>{t("对话内容会直接发送至你配置的服务。Key 只保留在当前浏览器会话，不写入记忆或导出数据。")}</p><label>API Key<div className="secret-input"><input type={visible?'text':'password'} value={apiKey} onChange={event=>setApiKey(event.target.value)} placeholder="sk-…"/><button onClick={()=>setVisible(!visible)}>{visible?t("隐藏"):t("显示")}</button></div></label><label>{t("接口地址")}<input value={endpoint} onChange={event=>setEndpoint(event.target.value)} /></label><label>{t("模型")}<input value={model} onChange={event=>setModel(event.target.value)} /></label><div className="api-actions"><button className="test-api" onClick={test} disabled={testing}>{testing?t("正在测试…"):t("测试连接")}</button><button onClick={()=>{setApiKey('');setResult("已删除本次会话中的 Key")}}>{t("删除 Key")}</button></div>{result&&<p className="api-result">{t(result)}</p>}</div>}<div className="data-tools glass"><h3>{t("本机数据")}</h3><p>{t("聊天和记忆保存在当前设备。换机前请导出备份。")}</p><input className="backup-password" type="password" value={backupPassword} onChange={event=>setBackupPassword(event.target.value)} placeholder={t("设置或输入备份密码（至少 6 位）")}/><div><button onClick={download}>{t("导出备份")}</button><label>{t("导入备份")}<input type="file" accept="application/json" onChange={event=>upload(event.target.files?.[0])}/></label><button className="danger" onClick={clear}>{t("清空全部")}</button></div>{result&&<small>{t(result)}</small>}</div><p className="ai-note"><ShieldCheck/>{t("Aily 是 AI 角色陪伴应用，不是真人或专业医疗服务")}</p></section>}
function Avatar({character}:{character:typeof characters[0]}){return <span className="avatar" style={{'--accent':character.accent} as React.CSSProperties}>{t(character.avatar)}</span>}
function NavButton({active,icon,label,onClick}:{active:boolean;icon:React.ReactNode;label:string;onClick:()=>void}){return <button className={active?'active':''} onClick={onClick}>{icon}<span>{label}</span></button>}
