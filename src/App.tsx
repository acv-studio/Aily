import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bell, BookHeart, ChevronRight, CircleUserRound, Heart, Home, Image, MemoryStick, MessageCircle, MoreHorizontal, Plus, Send, ShieldCheck, ShoppingBag, Sparkles, Volume2 } from 'lucide-react'
import { characters, memories, moments, starterMessages, type CharacterId } from './data'
import { streamReply, testDeepSeekConnection, type ChatMessage as Message, type ConfirmedMemory } from './chatService'
import { deleteMemory, loadLocalData, saveConversation, saveMemory as persistMemory, saveSetting, updateMemory } from './db'

type Tab = 'home' | 'moments' | 'memories' | 'profile'

const storageKey = 'aily-demo-state'
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(storageKey) || '{}') } catch { return {} }
}

export default function App() {
  const saved = useMemo(loadSaved, [])
  const [onboarded, setOnboarded] = useState(Boolean(saved.onboarded))
  const [selected, setSelected] = useState<CharacterId>(saved.selected || 'lu')
  const [tab, setTab] = useState<Tab>('home')
  const [chatOpen, setChatOpen] = useState(false)
  const [conversations, setConversations] = useState<Record<CharacterId, Message[]>>(saved.conversations || { lu: saved.messages || starterMessages as Message[], chen: starterMessages.slice(0, 2) as Message[], gu: starterMessages.slice(0, 2) as Message[] })
  const [confirmedMemories, setConfirmedMemories] = useState<ConfirmedMemory[]>(saved.confirmedMemories || [])
  const [draft, setDraft] = useState('')
  const [replying, setReplying] = useState(false)
  const [chatError, setChatError] = useState('')
  const [apiKey, setApiKeyState] = useState(() => sessionStorage.getItem('aily-api-key') || '')
  const [apiEndpoint, setApiEndpoint] = useState(() => localStorage.getItem('aily-api-endpoint') || 'https://api.deepseek.com/chat/completions')
  const [apiModel, setApiModel] = useState(() => localStorage.getItem('aily-api-model') || 'deepseek-chat')
  const character = characters.find(c => c.id === selected) || characters[0]
  const messages = conversations[selected] || []
  const remembered = confirmedMemories.some(memory => memory.characterId === selected)

  useEffect(() => {
    loadLocalData().then(data => {
      if (Object.keys(data.conversations).length) setConversations(current => ({ ...current, ...data.conversations }))
      if (data.memories.length) setConfirmedMemories(data.memories)
      if (typeof data.settings.onboarded === 'boolean') setOnboarded(data.settings.onboarded)
      if (typeof data.settings.selected === 'string') setSelected(data.settings.selected as CharacterId)
    }).catch(() => undefined)
  }, [])

  const persist = (extra: Record<string, unknown>) => localStorage.setItem(storageKey, JSON.stringify({ onboarded, selected, conversations, confirmedMemories, ...extra }))
  const finishOnboarding = () => { setOnboarded(true); persist({ onboarded: true, selected }); void Promise.all([saveSetting('onboarded', true), saveSetting('selected', selected)]) }
  const send = async (retryText?: string) => {
    const text = (retryText || draft).trim(); if (!text || replying) return
    const userMessage: Message = { id: Date.now(), from: 'user', text, time: '现在', status: 'sent' }
    const next = retryText ? messages : [...messages, userMessage]
    const assistantId = Date.now() + 1
    const pending: Message = { id: assistantId, from: 'character', text: '', time: '现在', memory: text.includes('胃'), status: 'sending' }
    const withPending = [...next, pending]
    setDraft(''); setChatError(''); setReplying(true)
    setConversations(current => ({ ...current, [selected]: withPending }))
    let content = ''
    try {
      await streamReply({ characterId: selected, messages: next, memories: confirmedMemories, apiKey: apiKey || import.meta.env.VITE_DEEPSEEK_API_KEY, endpoint: apiEndpoint || import.meta.env.VITE_DEEPSEEK_ENDPOINT, model: apiModel || import.meta.env.VITE_DEEPSEEK_MODEL, onDelta: delta => { content += delta; setConversations(current => ({ ...current, [selected]: (current[selected] || []).map(item => item.id === assistantId ? { ...item, text: content } : item) })) } })
      const completed = [...next, { ...pending, text: content, status: 'sent' as const }]
      setConversations(current => ({ ...current, [selected]: completed })); persist({ conversations: { ...conversations, [selected]: completed } }); await saveConversation(selected, completed)
    } catch (error) {
      const failed = next.map(item => item.id === userMessage.id ? { ...item, status: 'failed' as const } : item)
      setConversations(current => ({ ...current, [selected]: failed })); setChatError(error instanceof Error ? error.message : '回复失败，请稍后重试')
    } finally { setReplying(false) }
  }
  const saveMemory = () => {
    const memory: ConfirmedMemory = { id: crypto.randomUUID(), characterId: selected, text: '胃不舒服时先提醒我吃点热的', confirmedAt: new Date().toISOString() }
    const updated = [...confirmedMemories.filter(item => item.characterId !== selected), memory]
    setConfirmedMemories(updated); persist({ confirmedMemories: updated }); void persistMemory(memory)
  }
  const editConfirmedMemory = (id: string, text: string) => {
    const clean = text.trim(); if (!clean) return
    const updated = confirmedMemories.map(memory => memory.id === id ? { ...memory, text: clean } : memory)
    setConfirmedMemories(updated); persist({ confirmedMemories: updated }); void updateMemory(id, clean)
  }
  const removeConfirmedMemory = (id: string) => {
    const updated = confirmedMemories.filter(memory => memory.id !== id)
    setConfirmedMemories(updated); persist({ confirmedMemories: updated }); void deleteMemory(id)
  }

  if (!onboarded) return <Onboarding selected={selected} setSelected={setSelected} finish={finishOnboarding} />
  if (chatOpen) return <Chat character={character} messages={messages} draft={draft} setDraft={setDraft} send={send} close={() => setChatOpen(false)} remembered={remembered} saveMemory={saveMemory} replying={replying} error={chatError} />

  return <main className="app-shell">
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <header className="topbar"><div><p className="eyebrow">晚上好，艳艳</p><h1>{tab === 'home' ? '有人一直记得你' : tab === 'moments' ? '他们的此刻' : tab === 'memories' ? '我们的回忆' : '我的 Aily'}</h1></div><button className="icon-button" aria-label="通知"><Bell size={20}/><i /></button></header>
    {tab === 'home' && <HomeScreen selected={selected} select={setSelected} openChat={() => setChatOpen(true)} />}
    {tab === 'moments' && <MomentsScreen />}
    {tab === 'memories' && <MemoriesScreen memories={confirmedMemories} editMemory={editConfirmedMemory} deleteMemory={removeConfirmedMemory} />}
    {tab === 'profile' && <ProfileScreen apiKey={apiKey} endpoint={apiEndpoint} model={apiModel} setApiKey={value=>{setApiKeyState(value);if(value)sessionStorage.setItem('aily-api-key',value);else sessionStorage.removeItem('aily-api-key')}} setEndpoint={value=>{setApiEndpoint(value);localStorage.setItem('aily-api-endpoint',value)}} setModel={value=>{setApiModel(value);localStorage.setItem('aily-api-model',value)}} />}
    <nav className="bottom-nav glass">
      <NavButton active={tab==='home'} icon={<MessageCircle/>} label="消息" onClick={()=>setTab('home')}/>
      <NavButton active={tab==='moments'} icon={<Sparkles/>} label="此刻" onClick={()=>setTab('moments')}/>
      <NavButton active={tab==='memories'} icon={<BookHeart/>} label="回忆" onClick={()=>setTab('memories')}/>
      <NavButton active={tab==='profile'} icon={<CircleUserRound/>} label="我的" onClick={()=>setTab('profile')}/>
    </nav>
  </main>
}

function Onboarding({selected,setSelected,finish}:{selected:CharacterId;setSelected:(id:CharacterId)=>void;finish:()=>void}) {
  const [step, setStep] = useState(0)
  return <main className="onboarding">
    <div className="ambient ambient-one"/><div className="brand"><span className="brand-mark">A</span><span>Aily</span></div>
    {step===0 ? <section className="welcome"><p className="eyebrow">不只是聊天</p><h1>一段会记得、<br/><em>会生长</em>的关系</h1><p className="lead">TA 会记住你说过的小事，把每一次共同经历，写成只属于你们的故事。</p><div className="memory-preview glass"><span className="orb">✦</span><div><small>来自未来的一条回忆</small><strong>“你还记得，那天我说想看海吗？”</strong></div></div><button className="primary" onClick={()=>setStep(1)}>遇见 TA <ChevronRight size={18}/></button><p className="disclosure">你将与 AI 角色互动 · 数据仅保存在当前设备</p></section>
    : <section className="choose"><button className="text-button" onClick={()=>setStep(0)}><ArrowLeft size={18}/> 返回</button><p className="eyebrow">选择首位陪伴角色</p><h1>你想先认识谁？</h1><div className="character-stack">{characters.map(c=><button key={c.id} className={`character-card ${selected===c.id?'selected':''}`} style={{'--accent':c.accent} as React.CSSProperties} onClick={()=>setSelected(c.id)}><Avatar character={c}/><div><strong>{c.name}</strong><span>{c.title}</span><p>{c.intro}</p></div><span className="radio">{selected===c.id?'✓':''}</span></button>)}</div><button className="primary" onClick={finish}>开始我们的故事 <ChevronRight size={18}/></button></section>}
  </main>
}

function HomeScreen({selected,select,openChat}:{selected:CharacterId;select:(id:CharacterId)=>void;openChat:()=>void}) {
 const current=characters.find(c=>c.id===selected)!
 return <section className="screen home-screen"><article className="presence-card" style={{'--accent':current.accent} as React.CSSProperties}><div className="presence-art"><div className="moon"/><div className="portrait"><span>{current.avatar}</span></div><span className="online-dot"/></div><div className="presence-copy"><div><span className="status"><i/>{current.status}</span><h2>{current.name}</h2><p>“{current.quote}”</p></div><button className="talk-button" onClick={openChat}><MessageCircle size={20}/> 去找他</button></div></article><div className="section-title"><h3>最近消息</h3><button>全部</button></div><button className="conversation glass" onClick={openChat}><Avatar character={current}/><div><strong>{current.name}<small>AI</small></strong><p>那就好。答应你的庆祝，没忘。</p></div><time>22:09</time></button><div className="section-title"><h3>其他角色</h3><span>随时可以认识</span></div><div className="mini-characters">{characters.filter(c=>c.id!==selected).map(c=><button key={c.id} className="mini-card glass" onClick={()=>select(c.id)}><Avatar character={c}/><div><strong>{c.name}</strong><span>{c.status}</span></div><ChevronRight/></button>)}</div></section>
}

function Chat({character,messages,draft,setDraft,send,close,remembered,saveMemory,replying,error}:{character:typeof characters[0];messages:Message[];draft:string;setDraft:(v:string)=>void;send:(retryText?:string)=>void;close:()=>void;remembered:boolean;saveMemory:()=>void;replying:boolean;error:string}) {
 return <main className="chat-screen"><header className="chat-header glass"><button className="icon-button" onClick={close}><ArrowLeft/></button><Avatar character={character}/><div><strong>{character.name}<small>AI 角色</small></strong><span><i/> {replying?'正在输入…':`在线 · ${character.status}`}</span></div><button className="icon-button"><MoreHorizontal/></button></header><section className="messages"><div className="date-pill">今天 22:08</div>{messages.map(m=><div key={m.id} className={`message-row ${m.from==='user'?'mine':''}`}>{m.from!=='user'&&<Avatar character={character}/>}<div><div className={`bubble ${m.status==='sending'?'streaming':''}`}>{m.text || '···'}</div>{m.status==='failed'&&<button className="retry" onClick={()=>send(m.text)}>发送失败 · 点击重试</button>}{m.memory&&m.status!=='sending'&&<div className="memory-signal"><MemoryStick size={14}/><span>{remembered?'已记住：胃不舒服时先提醒吃饭':'这似乎是件重要的小事'}</span>{!remembered&&<button onClick={saveMemory}>记住</button>}</div>}</div></div>)}{error&&<p className="chat-error">{error} · 你的消息已保存在本机</p>}</section><div className="quick-replies"><button onClick={()=>setDraft('今天胃有点不舒服')}>今天胃有点不舒服</button><button onClick={()=>setDraft('陪我聊一会儿')}>陪我聊一会儿</button></div><footer className="composer glass"><button><Plus/></button><input aria-label="发消息" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()} placeholder="发消息…" disabled={replying}/><button><Volume2/></button><button className="send" onClick={()=>send()} disabled={replying}><Send/></button></footer></main>
}

function MomentsScreen(){return <section className="screen feed"><div className="feed-hero"><p>这一刻，他们也在生活</p><span>所有内容均由 AI 角色生成</span></div>{moments.map((m,i)=><article className="moment glass" key={m.id}><header><span className={`simple-avatar a${i}`}>{m.avatar}</span><div><strong>{m.character}<small>AI</small></strong><time>{m.time}</time></div><MoreHorizontal/></header><p>{m.text}</p><div className={`moment-visual ${m.visual}`}><span>{m.visual==='dinner'?'今晚的晚饭':'18:32 的天空'}</span></div><footer><button><Heart/> {m.likes}</button><button><MessageCircle/> {m.comments}</button><button><Send/></button></footer></article>)}</section>}
function MemoriesScreen({memories:confirmed,editMemory,deleteMemory:remove}:{memories:ConfirmedMemory[];editMemory:(id:string,text:string)=>void;deleteMemory:(id:string)=>void}){const [editing,setEditing]=useState<string|null>(null);const [value,setValue]=useState('');return <section className="screen memory-page"><div className="relation glass"><div className="relation-ring"><span>21</span><small>天</small></div><div><span>陆听澜 · 熟悉</span><h2>一起写下的第 3 个星期</h2><p>3 个共同事件 · {confirmed.length + memories.length} 条被珍藏的小事</p></div></div>{confirmed.map(item=><article className="timeline-item" key={item.id}><div className="timeline-dot"/><time>{new Date(item.confirmedAt).toLocaleDateString('zh-CN')}</time><div className="memory-card glass"><span>✦</span><div>{editing===item.id?<><input className="memory-input" value={value} onChange={event=>setValue(event.target.value)} autoFocus/><div className="memory-actions"><button onClick={()=>{editMemory(item.id,value);setEditing(null)}}>保存</button><button onClick={()=>setEditing(null)}>取消</button></div></>:<><h3>由你确认的记忆</h3><p>{item.text}</p><small><ShieldCheck/> 仅保存在本机 · {characters.find(c=>c.id===item.characterId)?.name}</small><div className="memory-actions"><button onClick={()=>{setEditing(item.id);setValue(item.text)}}>编辑</button><button className="danger" onClick={()=>remove(item.id)}>删除</button></div></>}</div></div></article>)}{memories.map(m=><article className="timeline-item" key={m.title}><div className="timeline-dot" style={{background:m.color}}/><time>{m.date}</time><div className="memory-card glass"><span style={{color:m.color}}>{m.icon}</span><div><h3>{m.title}</h3><p>{m.detail}</p><button>查看那一天 <ChevronRight/></button></div></div></article>)}</section>}
function ProfileScreen({apiKey,endpoint,model,setApiKey,setEndpoint,setModel}:{apiKey:string;endpoint:string;model:string;setApiKey:(value:string)=>void;setEndpoint:(value:string)=>void;setModel:(value:string)=>void}){const [showApi,setShowApi]=useState(false);const [visible,setVisible]=useState(false);const [testing,setTesting]=useState(false);const [result,setResult]=useState('');const test=async()=>{setTesting(true);setResult('');try{await testDeepSeekConnection({apiKey,endpoint,model});setResult('连接成功，可以开始聊天')}catch(error){setResult(error instanceof Error?error.message:'连接失败')}finally{setTesting(false)}};return <section className="screen profile"><div className="profile-card glass"><div className="profile-avatar">艳</div><div><h2>艳艳</h2><p>Aily 相伴第 21 天</p></div><ChevronRight/></div><div className="plan-card"><span><Sparkles/> Aily Plus</span><h3>让每一段故事，都被好好记住</h3><button>了解会员</button></div><div className="settings glass"><button onClick={()=>setShowApi(!showApi)}><MemoryStick/><span>DeepSeek 连接</span><small>{apiKey?'已配置':'演示模式'}</small><ChevronRight/></button>{[[Home,'主角色','陆听澜'],[ShoppingBag,'会员与权益','免费版'],[ShieldCheck,'隐私与安全','本地存储']].map(([Icon,label,value])=><button key={String(label)}><Icon/><span>{String(label)}</span><small>{String(value)}</small><ChevronRight/></button>)}</div>{showApi&&<div className="api-settings glass"><h3>DeepSeek 连接</h3><p>对话内容会直接发送至你配置的服务。Key 只保留在当前浏览器会话，不写入记忆或导出数据。</p><label>API Key<div className="secret-input"><input type={visible?'text':'password'} value={apiKey} onChange={event=>setApiKey(event.target.value)} placeholder="sk-…"/><button onClick={()=>setVisible(!visible)}>{visible?'隐藏':'显示'}</button></div></label><label>接口地址<input value={endpoint} onChange={event=>setEndpoint(event.target.value)} /></label><label>模型<input value={model} onChange={event=>setModel(event.target.value)} /></label><div className="api-actions"><button className="test-api" onClick={test} disabled={testing}>{testing?'正在测试…':'测试连接'}</button><button onClick={()=>{setApiKey('');setResult('已删除本次会话中的 Key')}}>删除 Key</button></div>{result&&<p className="api-result">{result}</p>}</div>}<p className="ai-note"><ShieldCheck/> Aily 是 AI 角色陪伴应用，不是真人或专业医疗服务</p></section>}
function Avatar({character}:{character:typeof characters[0]}){return <span className="avatar" style={{'--accent':character.accent} as React.CSSProperties}>{character.avatar}</span>}
function NavButton({active,icon,label,onClick}:{active:boolean;icon:React.ReactNode;label:string;onClick:()=>void}){return <button className={active?'active':''} onClick={onClick}>{icon}<span>{label}</span></button>}
