import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import SafetyPrivacyPanel, { SafetyConsent } from './SafetyPrivacyPanel'
import { acceptSafetyConsent, acquireUsageLease, deleteLocalProfile, hasSafetyConsent } from './privacy'
import { Bell, BookHeart, ChevronRight, CircleUserRound, Home, MemoryStick, MessageCircle, ShieldCheck, ShoppingBag, Sparkles } from 'lucide-react'
import { characters, type CharacterId } from './data'
import MomentsScreen from './MomentsScreen'
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
import { defaultOnboardingProfile } from './onboarding'

type Tab = 'home' | 'moments' | 'memories' | 'store' | 'profile'

export default function App() {
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
  return <main className="app-shell loading-screen"><h1>{phase === 'deleted' ? '本机使用资料已删除' : phase === 'error' ? '操作未完成' : phase === 'deleting' ? '正在删除本机资料…' : '正在保护本机数据…'}</h1>{phase === 'error' && <><p role="alert">{error}</p><p>删除失败时可能已有部分资料被清除；尚未确认全部完成。</p><button onClick={() => void deleteProfile()}>重试删除</button></>}{(phase === 'deleted' || phase === 'error') && <button onClick={() => window.location.reload()}>{phase === 'deleted' ? '重新开始' : '重新打开应用'}</button>}</main>
}

function AilyApp({ onDelete }: { onDelete: () => Promise<void> }) {
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
  const primaryName = characters.find(role => role.id === (chat.onboardingProfile?.characterId || selected))!.name
  const character = characters.find(item => item.id === selected) || characters[0]
  const messages = conversations[selected]
  const setSelected = chat.setSelected
  const finishOnboarding = chat.finishOnboarding
  const saveGameMemory = (text: string) => { void chat.saveConfirmed({ text, category: 'relationship' }).catch(() => alert('回忆保存失败，请重试')) }
  if (!chat.ready) return <main className="app-shell loading-screen"><p>{chat.loadError || '正在读取本机聊天与记忆…'}</p>{chat.loadError && <button onClick={chat.reload}>重试读取</button>}</main>
  if (onboarded && !consented && !hasSafetyConsent()) return <main className="onboarding"><SafetyConsent returning onAccepted={() => { acceptSafetyConsent(); setConsented(true) }} /></main>
  if (!onboarded) return <Onboarding selected={selected} setSelected={setSelected} finish={finishOnboarding} apiKey={chat.apiKey} setApiKey={chat.setApiKey} />
  if (privacyOpen) return <main className="app-shell"><SafetyPrivacyPanel close={() => setPrivacyOpen(false)} onDelete={deleteProfile} /></main>
  if (chatOpen) return <><ChatPanel character={character} messages={chat.chatMessages} temporary={chat.temporary} toggleTemporary={chat.toggleTemporary} pendingCount={chat.memories.filter(memory => memory.characterId === selected && memory.state === 'pending').length} draft={draft} setDraft={setDraft} send={chat.send} close={() => { if (!replying) setChatOpen(false) }} saveMemory={chat.saveConfirmed} withdraw={chat.withdraw} stop={chat.stop} replying={replying} error={chatError} demo={!chat.apiKey} openGame={() => setGameOpen(true)} openStory={() => setStoryOpen(true)} />{gameOpen && <RockPaperScissors characterName={character.name} onComplete={saveGameMemory} onClose={() => setGameOpen(false)} />}{storyOpen && (selected === 'lu' ? <SevenDayStory temporary={chat.temporary} onSaved={() => { void db.memories.toArray().then(chat.setMemories).catch(() => alert('故事已保存，回忆列表暂未刷新；重新打开应用可读取')) }} onClose={() => setStoryOpen(false)} /> : <InteractiveStory characterName={character.name} onComplete={saveGameMemory} onClose={() => setStoryOpen(false)} />)}</>
  if (preferencesOpen) return <OnboardingEditor initial={chat.onboardingProfile || defaultOnboardingProfile(selected)} save={chat.updateOnboarding} close={() => setPreferencesOpen(false)} />

  return <main className="app-shell">
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    {chat.loadError && <div className="chat-error" role="alert">{chat.loadError}<button onClick={() => void chat.reload()}>重试读取</button></div>}
    <header className="topbar"><div><p className="eyebrow">晚上好，{chat.onboardingProfile?.userName === '你' ? '欢迎回来' : chat.onboardingProfile?.userName || '欢迎回来'}</p><h1>{tab === 'home' ? '有人一直记得你' : tab === 'moments' ? '他们的此刻' : tab === 'memories' ? '我们的回忆' : tab === 'store' ? '一份小心意' : '我的 Aily'}</h1></div><button className="icon-button" aria-label="通知"><Bell size={20}/><i /></button></header>
    {tab === 'home' && <HomeScreen selected={selected} select={setSelected} lastMessage={messages.filter(item => !item.withdrawn).at(-1)?.text || '还没有聊天记录，先打个招呼吧'} openChat={() => setChatOpen(true)} />}
    {tab === 'moments' && <MomentsScreen userName={userName} selected={selected} config={{ apiKey: chat.apiKey, endpoint: chat.endpoint, model: chat.model, onboardingProfile: chat.onboardingProfile }} onChat={(characterId,text)=>{setSelected(characterId);setDraft(text);setChatOpen(true)}} />}
    {tab === 'memories' && <MemoryPanel memories={chat.memories} selected={selected} onSave={chat.saveConfirmed} onUpdate={chat.editMemory} onDelete={chat.removeMemory} onClear={chat.clearMemories} summaries={chat.summaries} policies={chat.policies} onPolicy={chat.changePolicy} onConfirm={chat.approveProposal} conversations={chat.conversations} profile={chat.onboardingProfile} onProfile={chat.updateOnboarding} />}
    {tab === 'profile' && proactiveOpen && <ProactiveSettingsPanel selected={selected} close={() => setProactiveOpen(false)} />}
    {tab === 'profile' && !proactiveOpen && <section className="screen" style={{ paddingBottom: 0 }}><button className="proactive-entry glass" aria-label="角色主动消息设置" onClick={() => setProactiveOpen(true)}>角色主动消息设置 <ChevronRight size={18} /></button><button className="proactive-entry glass" aria-label="安全与隐私" onClick={() => setPrivacyOpen(true)}>安全与隐私 <ShieldCheck size={18} /></button></section>}
    {tab === 'profile' && !proactiveOpen && <><button className="secondary" style={{ margin: '0 20px 16px' }} onClick={() => setPreferencesOpen(true)}>修改称呼与互动偏好</button><ProfileScreen userName={userName} primaryName={primaryName} beforeDataChange={chat.beforeDataChange} apiKey={chat.apiKey} endpoint={chat.endpoint} model={chat.model} setApiKey={chat.setApiKey} setEndpoint={chat.setEndpoint} setModel={chat.setModel} onImported={() => { void chat.reload() }} onCleared={() => { void chat.reload() }} /></>}
    {tab === 'store' && <GiftStorePanel selected={selected} />}
    {!(tab === 'profile' && proactiveOpen) && <nav className="bottom-nav glass">
      <NavButton active={tab==='home'} icon={<MessageCircle/>} label="消息" onClick={()=>setTab('home')}/>
      <NavButton active={tab==='moments'} icon={<Sparkles/>} label="此刻" onClick={()=>setTab('moments')}/>
      <NavButton active={tab==='memories'} icon={<BookHeart/>} label="回忆" onClick={()=>setTab('memories')}/>
      <NavButton active={tab==='store'} icon={<ShoppingBag/>} label="商城" onClick={()=>setTab('store')}/>
      <NavButton active={tab==='profile'} icon={<CircleUserRound/>} label="我的" onClick={()=>setTab('profile')}/>
    </nav>}
  </main>
}

function HomeScreen({selected,select,openChat,lastMessage}:{selected:CharacterId;select:(id:CharacterId)=>void;openChat:()=>void;lastMessage:string}) {
 const current=characters.find(c=>c.id===selected)!
 return <section className="screen home-screen"><article className="presence-card" style={{'--accent':current.accent} as React.CSSProperties}><div className="presence-art"><div className="moon"/><div className="portrait"><span>{current.avatar}</span></div><span className="online-dot"/></div><div className="presence-copy"><div><span className="status"><i/>{current.status}</span><h2>{current.name}</h2><p>“{current.quote}”</p></div><button className="talk-button" onClick={openChat}><MessageCircle size={20}/> 去找他</button></div></article><div className="section-title"><h3>最近消息</h3><button>全部</button></div><button className="conversation glass" onClick={openChat}><Avatar character={current}/><div><strong>{current.name}<small>AI</small></strong><p>{lastMessage}</p></div></button><div className="section-title"><h3>其他角色</h3><span>随时可以认识</span></div><div className="mini-characters">{characters.filter(c=>c.id!==selected).map(c=><button key={c.id} className="mini-card glass" onClick={()=>select(c.id)}><Avatar character={c}/><div><strong>{c.name}</strong><span>{c.status}</span></div><ChevronRight/></button>)}</div></section>
}

function ProfileScreen({userName,primaryName,apiKey,endpoint,model,setApiKey,setEndpoint,setModel,onImported,onCleared,beforeDataChange}:{userName:string;primaryName:string;beforeDataChange:()=>Promise<void>;apiKey:string;endpoint:string;model:string;setApiKey:(value:string)=>void;setEndpoint:(value:string)=>void;setModel:(value:string)=>void;onImported:(data:Awaited<ReturnType<typeof loadLocalData>>)=>void;onCleared:()=>void}){const [showApi,setShowApi]=useState(false);const [visible,setVisible]=useState(false);const [testing,setTesting]=useState(false);const [result,setResult]=useState('');const test=async()=>{setTesting(true);setResult('');try{await testDeepSeekConnection({apiKey,endpoint,model});setResult('连接成功，可以开始聊天')}catch(error){setResult(error instanceof Error?error.message:'连接失败')}finally{setTesting(false)}};return <section className="screen profile">
<div className="profile-card glass">
<div className="profile-avatar">{Array.from(userName)[0]}</div>
<div>
<h2>{userName}</h2>
<p>本机陪伴档案</p>
</div>
<ChevronRight/>
</div>
<div className="plan-card">
<span>
<Sparkles/> Aily Plus</span>
<h3>让每一段故事，都被好好记住</h3>
<button>了解会员</button>
</div>
<div className="settings glass">
<button onClick={()=>setShowApi(!showApi)}>
<MemoryStick/>
<span>DeepSeek 连接</span>
<small>{apiKey?'已配置':'演示模式'}</small>
<ChevronRight/>
</button>{[[Home,'主角色',primaryName],[ShoppingBag,'会员与权益','免费版'],[ShieldCheck,'隐私与安全','本地存储']].map(([Icon,label,value])=>
<button key={String(label)}>
<Icon/>
<span>{String(label)}</span>
<small>{String(value)}</small>
<ChevronRight/>
</button>)}</div>{showApi&&<div className="api-settings glass">
<h3>DeepSeek 连接</h3>
<p>对话内容会直接发送至你配置的服务。Key 只保留在当前浏览器会话，不写入记忆或导出数据。</p>
<label>API Key<div className="secret-input">
<input type={visible?'text':'password'} value={apiKey} onChange={event=>setApiKey(event.target.value)} placeholder="sk-…"/>
<button onClick={()=>setVisible(!visible)}>{visible?'隐藏':'显示'}</button>
</div>
</label>
<label>接口地址<input value={endpoint} onChange={event=>setEndpoint(event.target.value)} />
</label>
<label>模型<input value={model} onChange={event=>setModel(event.target.value)} />
</label>
<div className="api-actions">
<button className="test-api" onClick={test} disabled={testing}>{testing?'正在测试…':'测试连接'}</button>
<button onClick={()=>{setApiKey('');setResult('已删除本次会话中的 Key')}}>删除 Key</button>
</div>{result&&<p className="api-result">{result}</p>}</div>}<DataTransferPanel beforeDataChange={beforeDataChange} onImported={onImported} onCleared={onCleared} />
<p className="ai-note">
<ShieldCheck/> Aily 是 AI 角色陪伴应用，不是真人或专业医疗服务</p>
</section>}
function Avatar({character}:{character:typeof characters[0]}){return <span className="avatar" style={{'--accent':character.accent} as React.CSSProperties}>{character.avatar}</span>}
function NavButton({active,icon,label,onClick}:{active:boolean;icon:React.ReactNode;label:string;onClick:()=>void}){return <button className={active?'active':''} onClick={onClick}>{icon}<span>{label}</span></button>}
