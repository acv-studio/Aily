import { useState } from 'react'
import type { ChatMessage, ConfirmedMemory } from './chatService'
import type { MemoryDraft } from './ChatPanel'
import { characters, type CharacterId } from './data'
import type { MemoryPolicy } from './longMemory'
import { isJournal, journalDrafts, journalLabel, memoryDate, memoryImage, relationshipEvents, type JournalPeriod } from './relationshipMemories'
import './relationshipMemories.css'

export type RelationshipView = 'cards' | 'journals' | 'timeline'
function CardArt({ memory, messages }: { memory: ConfirmedMemory; messages: ChatMessage[] }) {
  const image = memoryImage(memory, messages)
  const [failed, setFailed] = useState(false)
  if (image && !failed) return <img className="recollection-photo" src={image.dataUrl} alt={`回忆照片：${image.name}`} onError={() => setFailed(true)} />
  return <div className="recollection-art"><svg viewBox="0 0 320 130" aria-hidden="true"><circle cx="245" cy="38" r="19" fill="#f9dfb0" /><path d="M0 100 Q80 50 160 100 T320 100 V130 H0Z" fill="#8875b1" /><path d="M0 116 Q90 78 190 115 T320 110 V130 H0Z" fill="#4b7187" /><path d="M146 70 C130 52 111 76 146 96 C181 76 162 52 146 70Z" fill="#f4b6c3" /></svg><small>{failed ? '照片暂不可用 · 回忆插画' : '回忆插画 · 非实拍照片'}</small></div>
}
export default function RelationshipMemoriesView({ view, memories, role, selected, policy, messages, search, category, onSave, onManage, onBusyChange, externalBusy = false }: {
  view: RelationshipView; memories: ConfirmedMemory[]; role: CharacterId; selected: CharacterId; policy: MemoryPolicy
  messages: ChatMessage[]; search: string; category: string; onSave: (draft: MemoryDraft) => Promise<void>; onManage: () => void; onBusyChange?: (busy: boolean) => void; externalBusy?: boolean
}) {
  const [period, setPeriod] = useState<JournalPeriod>('week')
  const [preview, setPreview] = useState<{ key: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [savedText, setSavedText] = useState('')
  const events = relationshipEvents(memories, role, policy, messages)
  const match = (text: string) => text.toLowerCase().includes(search.trim().toLowerCase())
  const visible = events.filter(event => match(event.text) && (category === 'all' || category === 'relationship'))
  const drafts = policy.extractionEnabled ? journalDrafts(events, period).filter(draft => match(draft.text) && (category === 'all' || category === 'relationship')) : []
  const saved = memories.filter(memory => memory.characterId === role && isJournal(memory) && memory.state !== 'pending' && memory.state !== 'rejected' && match(memory.text) && (category === 'all' || category === 'relationship'))
  const name = characters.find(character => character.id === role)!.name
  return <div className="relationship-memories">
    <div className="recollection-intro"><h2>{view === 'cards' ? `和${name}，一起记得` : view === 'timeline' ? '把共同经历串成故事' : '写下这一段日子'}</h2><p>只展示已确认、允许引用的共同经历；不以消息数量替代关系。日期按确认时间（UTC）排列。</p></div>
    {view === 'cards' && <><p className="recollection-note">照片来自本机原聊天附件；没有照片时使用明确标注的插画。</p>{[...visible].reverse().map(memory => <article className="recollection-card glass" key={memory.id}><CardArt key={`${memory.id}:${memory.sourceMessageId}`} memory={memory} messages={messages} /><div className="recollection-copy"><time dateTime={memory.confirmedAt}>{memoryDate(memory.confirmedAt)}</time><h3>{memory.text}</h3><span>{memory.sourceMessageId === undefined ? '你确认的共同事件' : `聊天来源 #${memory.sourceMessageId}`}</span></div></article>)}</>}
    {view === 'timeline' && <ol className="recollection-timeline">{visible.map(memory => <li key={memory.id}><time dateTime={memory.confirmedAt}>{memoryDate(memory.confirmedAt)}</time><article className="glass"><h3>{memory.text}</h3><small>{memory.sourceMessageId === undefined ? '共同事件 · 已确认' : `聊天来源 #${memory.sourceMessageId} · 已确认`}</small></article></li>)}</ol>}
    {view !== 'journals' && !visible.length && <p className="chat-empty">还没有符合条件的共同经历。在聊天、小游戏或故事中确认保存后，这里就会出现回忆。</p>}
    {view === 'journals' && <>
      <div className="journal-period" role="group" aria-label="周记月记切换">{(['week', 'month'] as const).map(value => <button key={value} aria-pressed={period === value} onClick={() => { setPeriod(value); setPreview(null); setError('') }}>{journalLabel[value]}</button>)}</div>
      <p className="recollection-note">本机按 UTC 自然月 / ISO 周整理共同经历摘录，不是 AI 叙事。敏感记忆不自动整理；预览不保存，确认后作为独立回忆快照，可在记忆管理中编辑或删除。原事件变动不会改写已保存快照。</p>
      {!policy.extractionEnabled && <p role="status">自动整理已关闭，周记月记不再生成新草稿。</p>}
      {drafts.map(draft => {
        const alreadySaved = savedText === draft.text || saved.some(memory => memory.text === draft.text)
        return <article className="journal-card glass" key={draft.key}><small>{journalLabel[period]} · {draft.key}</small><h3>{draft.sources.length} 件一起经历的小事</h3><p>{draft.sources[0].text.slice(0, 90)}</p><button disabled={busy || externalBusy || alreadySaved || role !== selected} onClick={() => { setPreview({ key: draft.key, text: draft.text }); setError('') }}>{alreadySaved ? '已保存这份摘录' : '预览并确认'}</button><details><summary>回看 {draft.sources.length} 件来源</summary>{draft.sources.map(source => <p key={source.id}>{memoryDate(source.confirmedAt)} · {source.text}</p>)}</details></article>
      })}
      {role !== selected && <p role="status">只能为当前主角色保存周记月记；请先在消息页切换到{name}。</p>}
      {!drafts.length && policy.extractionEnabled && <p className="chat-empty">还没有可整理的共同经历。确认一条非敏感共同事件后，会在对应周／月出现草稿。</p>}
      {!!saved.length && <section className="saved-journals"><h3>已确认保存</h3>{saved.sort((a, b) => Date.parse(b.confirmedAt) - Date.parse(a.confirmedAt)).map(memory => <article className="journal-card glass" key={memory.id}><time>{memoryDate(memory.confirmedAt)}</time><p>{memory.text}</p>{(memory.state === 'archived' || memory.enabled === false) && <small>已归档或暂停引用</small>}</article>)}</section>}
      {preview && <form className="journal-preview glass" onSubmit={event => { event.preventDefault(); if (busy || externalBusy || role !== selected) return; if (!drafts.some(draft => draft.key === preview.key && draft.text === preview.text)) { setPreview(null); setError('共同经历或整理设置已变化，请重新预览后保存'); return } setBusy(true); onBusyChange?.(true); setError(''); const text = preview.text; void onSave({ text, category: 'relationship' }).then(() => { setSavedText(text); setPreview(null) }).catch(() => setError('摘录未保存，请检查本机存储或记忆类别设置后重试')).finally(() => { setBusy(false); onBusyChange?.(false) }) }}><h3>确认保存这份{journalLabel[period]}？</h3><p>{preview.text}</p><div><button type="submit" disabled={busy || externalBusy || role !== selected || policy.disabledCategories.includes('relationship')}>确认保存{journalLabel[period]}</button><button type="button" disabled={busy || externalBusy} onClick={() => { setPreview(null); setError('') }}>取消</button></div></form>}
      {error && <p role="alert">{error}</p>}
    </>}
    <button className="recollection-manage" disabled={busy || externalBusy} onClick={onManage}>管理、编辑或删除记忆</button>
  </div>
}
