import { useEffect, useRef, useState } from 'react'
import { t, useI18n } from './i18n'
import ProfileScreen from './ProfileScreen'
import HomeScreen from './HomeScreen'
import { flushSync } from 'react-dom'
import SafetyPrivacyPanel, { SafetyConsent } from './SafetyPrivacyPanel'
import { acceptSafetyConsent, acquireUsageLease, deleteLocalProfile, hasSafetyConsent } from './privacy'
import { ArrowLeft, Bell, BookHeart, CircleUserRound, MessageCircle } from 'lucide-react'
import { characters, type CharacterId } from './data'
import MomentsScreen from './MomentsScreen'
import RemindersScreen from './RemindersScreen'
import { db } from './db'
import RockPaperScissors from './RockPaperScissors'
import InteractiveStory from './InteractiveStory'
import SevenDayStory from './SevenDayStoryPanel'
import ChatPanel from './ChatPanel'
import MemoryPanel from './MemoryPanel'
import useLocalChat from './useLocalChat'
import ProactiveSettingsPanel from './ProactiveSettingsPanel'
import SmartReminderPanel, { SmartReminderBanner } from './SmartReminderPanel'
import useSmartReminders from './useSmartReminders'
import Onboarding, { OnboardingEditor } from './OnboardingFlow'
import { defaultOnboardingProfile } from './onboarding'
import { getRelationship } from './relationship'
import { InviteLanding, InvitePanel } from './SharingPanel'
import { invitedRole } from './sharing'
import CallScreen from './CallScreen'
import BillingPanel from './BillingPanel'

type Tab = 'home' | 'reminders' | 'memories' | 'profile'

function greetingAt(hour: number) {
  if (hour < 6) return '夜深了，{name}'
  if (hour < 12) return '早上好，{name}'
  if (hour < 14) return '中午好，{name}'
  if (hour < 18) return '下午好，{name}'
  return '晚上好，{name}'
}

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
  const [memoryBusy, setMemoryBusy] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [gameOpen, setGameOpen] = useState(false)
  const [storyOpen, setStoryOpen] = useState(false)
  const [callOpen, setCallOpen] = useState(false)
  const [billingOpen, setBillingOpen] = useState(false)
  const [momentsOpen, setMomentsOpen] = useState(false)
  const [proactiveOpen, setProactiveOpen] = useState(false)
  const [remindersOpen, setRemindersOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [invitation, setInvitation] = useState(() => invitedRole(window.location.hash))
  useEffect(() => {
    const changed = () => setInvitation(invitedRole(window.location.hash))
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  const dismissInvitation = () => { window.history.replaceState(null, '', window.location.pathname + window.location.search); setInvitation(null) }
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [consented, setConsented] = useState(hasSafetyConsent)
  const reminders = useSmartReminders(chat.ready && onboarded && (consented || hasSafetyConsent()) && !invitation)
  const deleteProfile = async () => { await reminders.pauseAndDrain(); await chat.prepareForDeletion(); await onDelete() }
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const userName = chat.onboardingProfile?.userName && chat.onboardingProfile.userName !== '你' ? chat.onboardingProfile.userName : t('我')
  const primaryId = chat.onboardingProfile?.characterId || selected
  const primaryName = characters.find(role => role.id === primaryId)!.name
  const setPrimary = () => chat.setPrimary(selected)
  const character = characters.find(item => item.id === selected) || characters[0]
  const setSelected = chat.setSelected
  const finishOnboarding = chat.finishOnboarding
  const relationshipStage = getRelationship(selected, chat.memories, chat.policies[selected]).stage.name
  const saveGameMemory = (text: string) => { void (async () => { try { await chat.saveConfirmed({ text, category: 'relationship' }); await chat.recordActivity(text) } catch { alert('回忆保存失败，请重试') } })() }
  const sendWithLocalActions: typeof chat.send = async (options = {}) => {
    if (options.giftId || options.appDataTicket) { await chat.send(options); return }
    const text = options.text?.trim() ?? draft.trim()
    let localActionNote = options.localActionNote
    if (!options.retryId && text && !chat.temporary) {
      const reminder = parseReminder(text)
      if (reminder) {
        await reminders.add({ kind: 'plan', title: reminder.title, enabled: true, scheduledAt: reminder.at.toISOString(), repeatMinutes: null, temperatureBelow: null, station: '', exit: '', leadMinutes: 0 })
        localActionNote = `已创建提醒“${reminder.title}”，时间为${reminder.at.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
      } else {
        const memory = parseExplicitMemory(text)
        if (memory) {
          await chat.saveConfirmed({ text: memory, category: 'profile' })
          localActionNote = `已将“${memory}”保存为本机长期记忆`
        }
      }
    }
    await chat.send({ ...options, localActionNote })
  }
  if (!chat.ready) return <main className="app-shell loading-screen"><p>{chat.loadError || '正在读取本机聊天与记忆…'}</p>{chat.loadError && <button onClick={chat.reload}>{t('重试读取')}</button>}</main>
  if (invitation) return <InviteLanding role={invitation} start={() => { setSelected(invitation); dismissInvitation() }} dismiss={dismissInvitation} />
  if (onboarded && !consented && !hasSafetyConsent()) return <main className="onboarding"><SafetyConsent returning onAccepted={() => { acceptSafetyConsent(); setConsented(true) }} /></main>
  if (!onboarded) return <Onboarding selected={selected} setSelected={setSelected} finish={finishOnboarding} apiKey={chat.apiKey} setApiKey={chat.setApiKey} setEndpoint={chat.setEndpoint} setModel={chat.setModel} />
  if (inviteOpen) return <main className="app-shell"><InvitePanel role={selected} close={() => setInviteOpen(false)} /></main>
  if (privacyOpen) return <main className="app-shell"><SafetyPrivacyPanel close={() => setPrivacyOpen(false)} onDelete={deleteProfile} /></main>
  if (remindersOpen) return <main className="app-shell"><SmartReminderPanel controller={reminders} close={() => setRemindersOpen(false)} /></main>
  if (preferencesOpen) return <OnboardingEditor initial={chat.onboardingProfile || defaultOnboardingProfile(selected)} save={chat.updateOnboarding} close={() => setPreferencesOpen(false)} />
  if (billingOpen) return <BillingPanel close={() => setBillingOpen(false)} openPrivacy={() => setPrivacyOpen(true)} />
  if (callOpen) return <CallScreen character={character} messages={chat.chatMessages} replying={replying} send={options => sendWithLocalActions({ ...options, billingCost: 5 })} close={() => { if (!replying) setCallOpen(false) }} />
  if (chatOpen) return <><div inert={momentsOpen}><ChatPanel appDataIdentity={chat.appDataIdentity} isPrimary={selected === primaryId} setPrimary={setPrimary} replyMode={chat.replyMode} setReplyMode={chat.setReplyMode} modeSaving={chat.modeSaving} character={character} messages={chat.chatMessages} summaries={chat.summaries.filter(summary => summary.characterId === selected)} temporary={chat.temporary} pendingCount={chat.memories.filter(memory => memory.characterId === selected && memory.state === 'pending').length} draft={draft} setDraft={setDraft} send={sendWithLocalActions} close={() => setChatOpen(false)} saveMemory={chat.saveConfirmed} withdraw={chat.withdraw} stop={chat.stop} replying={replying} error={chatError} demo={!chat.apiKey} openGame={() => setGameOpen(true)} openStory={() => setStoryOpen(true)} openCall={() => setCallOpen(true)} openBilling={() => setBillingOpen(true)} openPreferences={() => setPreferencesOpen(true)} recordActivity={chat.recordActivity} recordActivityFor={chat.recordActivityFor} relationshipStage={relationshipStage} openMoments={() => setMomentsOpen(true)} /></div>{reminders.due.length > 0 && !momentsOpen && !gameOpen && !storyOpen && <div className="reminder-chat-overlay"><SmartReminderBanner controller={reminders} disabled={replying} open={() => setRemindersOpen(true)} /></div>}{gameOpen && <RockPaperScissors characterName={character.name} temporary={chat.temporary} onComplete={async text => { await chat.saveConfirmed({ text, category: 'relationship' }); await chat.recordActivity(text).catch(() => { /* Memory is already saved; do not offer a duplicate save for a chat-log failure. */ }) }} onClose={() => setGameOpen(false)} />}{storyOpen && (selected === 'lu' ? <SevenDayStory temporary={chat.temporary} onSaved={() => { void db.memories.toArray().then(chat.setMemories).catch(() => alert('故事已保存，回忆列表暂未刷新；重新打开应用可读取')) }} onClose={() => setStoryOpen(false)} /> : <InteractiveStory characterName={character.name} onComplete={saveGameMemory} onClose={() => setStoryOpen(false)} />)}{momentsOpen && <section className="character-moments-page" aria-label={t('角色朋友圈')}><header className="character-moments-header"><button className="icon-button" aria-label={t('返回聊天')} onClick={() => setMomentsOpen(false)}><ArrowLeft size={20} /></button><h1>{t('朋友圈')}</h1></header><MomentsScreen userName={userName} selected={selected} config={{ apiKey: chat.apiKey, endpoint: chat.endpoint, model: chat.model, onboardingProfile: chat.onboardingProfile }} onChat={(characterId, text) => { setSelected(characterId); setDraft(text); setMomentsOpen(false) }} /></section>}</>

  return <main className="app-shell">
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    {chat.loadError && <div className="chat-error" role="alert">{chat.loadError}<button onClick={() => void chat.reload()}>{t('重试读取')}</button></div>}
    <header className="topbar"><div><p className="eyebrow">{t(greetingAt(new Date().getHours()), { name: chat.onboardingProfile?.userName && chat.onboardingProfile.userName !== '你' ? chat.onboardingProfile.userName : t('欢迎回来') })}</p><h1>{tab === 'home' ? t("有人一直记得你") : tab === 'reminders' ? t("提醒") : tab === 'memories' ? t("我们的回忆")  : t("我的 Aily")}</h1></div></header>
    <SmartReminderBanner controller={reminders} disabled={memoryBusy} open={() => setRemindersOpen(true)} />
    {tab === 'home' && <HomeScreen selected={selected} primaryId={chat.onboardingProfile?.characterId || selected} primaryName={chat.onboardingProfile?.characterName || undefined} conversations={conversations} modelConfig={{ apiKey: chat.apiKey, endpoint: chat.endpoint, model: chat.model }} openChat={id => { setSelected(id); setChatOpen(true) }} />}
    {tab === 'reminders' && !proactiveOpen && <RemindersScreen openSmartReminders={() => setRemindersOpen(true)} reminders={reminders.state?.reminders} controller={reminders} dueCount={reminders.due.length} />}
    {tab === 'memories' && <MemoryPanel privateNames={[chat.onboardingProfile?.userName || '', chat.onboardingProfile?.characterName || '']} profile={chat.onboardingProfile} onProfile={chat.updateOnboarding} onBusyChange={setMemoryBusy} memories={chat.memories} selected={selected} onSave={chat.saveConfirmed} onUpdate={chat.editMemory} onDelete={chat.removeMemory} onClear={chat.clearMemories} summaries={chat.summaries} policies={chat.policies} onPolicy={chat.changePolicy} onConfirm={chat.approveProposal} conversations={chat.conversations} />}
    {(tab === 'profile' || tab === 'reminders') && proactiveOpen && <ProactiveSettingsPanel selected={selected} closeLabel={tab === 'reminders' ? '← 返回提醒' : undefined} close={() => setProactiveOpen(false)} />}
    {tab === 'profile' && !proactiveOpen && <ProfileScreen userName={userName} primaryName={primaryName} primaryId={primaryId} setPrimary={chat.setPrimary} policies={chat.policies} onPolicy={chat.changePolicy} openPreferences={() => setPreferencesOpen(true)} openProactive={() => setProactiveOpen(true)} openReminders={() => setRemindersOpen(true)} openInvite={() => setInviteOpen(true)} openPrivacy={() => setPrivacyOpen(true)} beforeDataChange={chat.beforeDataChange} apiKey={chat.apiKey} endpoint={chat.endpoint} model={chat.model} setApiKey={chat.setApiKey} setEndpoint={chat.setEndpoint} setModel={chat.setModel} onImported={() => { void chat.reload() }} onCleared={() => { void chat.reload() }} />}
    {!((tab === 'profile' || tab === 'reminders') && proactiveOpen) && <nav className="bottom-nav glass">
      <NavButton disabled={memoryBusy} active={tab==='home'} icon={<MessageCircle/>} label={t("消息")} onClick={()=>setTab('home')}/>
      <NavButton disabled={memoryBusy} active={tab==='memories'} icon={<BookHeart/>} label={t("记忆")} onClick={()=>setTab('memories')}/>
      <NavButton disabled={memoryBusy} active={tab==='reminders'} icon={<Bell/>} label={t("提醒")} onClick={()=>setTab('reminders')}/>
      <NavButton disabled={memoryBusy} active={tab==='profile'} icon={<CircleUserRound/>} label={t("我的")} onClick={()=>setTab('profile')}/>
    </nav>}
  </main>
}

function NavButton({active,icon,label,onClick,disabled = false}:{active:boolean;icon:React.ReactNode;label:string;onClick:()=>void;disabled?:boolean}){return <button disabled={disabled} aria-current={active ? 'page' : undefined} className={active?'active':''} onClick={onClick}>{icon}<span>{label}</span></button>}

export function parseReminder(text: string, now = new Date()) {
  if (!/(提醒我|提醒一下|设个提醒)/.test(text)) return null
  const relative = text.match(/(\d{1,3})\s*(?:h|小时|时)\s*(?:后|之后)/i) || text.match(/(\d{1,4})\s*(?:分钟|分)\s*(?:后|之后)/)
  const clock = text.match(/(\d{1,2})(?:点|[:：])(\d{1,2})?分?/)
  let at: Date, matched: string
  if (relative) {
    const amount = Number(relative[1])
    const minutes = /h|小时|时/i.test(relative[0]) ? amount * 60 : amount
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 7 * 24 * 60) return null
    at = new Date(now.getTime() + minutes * 60_000)
    matched = relative[0]
  } else if (clock) {
    const hour = Number(clock[1]), minute = Number(clock[2] || 0)
    if (hour > 23 || minute > 59) return null
    at = new Date(now); at.setHours(hour, minute, 0, 0)
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1)
    matched = clock[0]
  } else return null
  const title = text.replace(/提醒我|提醒一下|设个提醒/g, '').replace(matched, '').replace(/[，,。.!！]/g, '').trim() || '提醒'
  return { title, at }
}

function parseExplicitMemory(text: string) {
  const match = text.match(/^(?:请|麻烦)?(?:帮我)?(?:记住|记下|记一下|记一笔)(?:我说的)?[：:，,]?\s*(.+)$/)
  return match?.[1]?.trim() || null
}
