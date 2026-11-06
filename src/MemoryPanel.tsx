import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useI18n } from './i18n'
import type { ChatMessage, ConfirmedMemory } from './chatService'
import { defaultMemoryPolicy, semanticScore, type ConversationSummary, type MemoryPolicy } from './longMemory'
import type { CharacterId } from './data'
import type { MemoryDraft } from './ChatPanel'
import type { OnboardingProfile } from './onboarding'
import { shareableMemory } from './sharing'
import { MemoryShareDialog } from './SharingPanel'
import './memory.css'

const categories = { profile: '用户偏好', relationship: '共同经历', context: '近期情境', emotion: '情绪与支持' }
export default function MemoryPanel({ memories, selected, onSave, onUpdate, onDelete, onClear, summaries = [], policies = {}, onPolicy, onConfirm, conversations = {}, onBusyChange, privateNames = [], profile, onProfile }: {
  profile?: OnboardingProfile | null
  onProfile?: (profile: OnboardingProfile) => Promise<void>
  onBusyChange?: (busy: boolean) => void
  privateNames?: string[]
  summaries?: ConversationSummary[]; policies?: Partial<Record<CharacterId, MemoryPolicy>>
  onPolicy?: (role: CharacterId, policy: MemoryPolicy) => Promise<void>
  onConfirm?: (id: string) => Promise<void>
  conversations?: Partial<Record<CharacterId, ChatMessage[]>>
  memories: ConfirmedMemory[]; selected: CharacterId
  onSave: (draft: MemoryDraft) => Promise<void>
  onUpdate: (id: string, patch: Partial<ConfirmedMemory>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClear: (id: CharacterId) => Promise<void>
}) {
  const { t, locale } = useI18n()
  const role = selected
  const [status, setStatus] = useState('all')
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<ConfirmedMemory | null>(null)
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [newCategory, setNewCategory] = useState<MemoryDraft['category']>('profile')
  const [importance, setImportance] = useState(3)
  const [expiresAt, setExpiresAt] = useState('')
  const [sourceIds, setSourceIds] = useState<number[]>([])
  const [sourceRole, setSourceRole] = useState<CharacterId>(selected)
  const [shareId, setShareId] = useState<string | null>(null)
  const shareMemory = memories.find(memory => memory.id === shareId && shareableMemory(memory, policies[memory.characterId] || defaultMemoryPolicy, conversations[memory.characterId]))
  useEffect(() => { if (shareId && !shareMemory) setShareId(null) }, [shareId, shareMemory])
  const [error, setError] = useState('')
  const [busy, setBusyState] = useState(false)
  const setBusy = (value: boolean) => { setBusyState(value); onBusyChange?.(value) }
  const visible = memories.filter(memory => (status === 'all' || (status === 'confirmed' ? !memory.state || memory.state === 'confirmed' : memory.state === status)) && (category === 'all' || (memory.category || 'profile') === category) && memory.state !== 'rejected' && (!search || memory.text.toLowerCase().includes(search.toLowerCase()) || semanticScore(search, memory.text) > 0)).sort((a, b) => (b.updatedAt || b.confirmedAt).localeCompare(a.updatedAt || a.confirmedAt))
  const run = async (task: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await task() } catch { setError('本机操作未全部完成，部分更改可能已保存，请检查当前状态后重试。') } finally { setBusy(false) } }
  const confirmedCount = visible.filter(item => item.state !== 'pending').length
  return <section className="screen memory-page">
    <div className="memory-intro"><p>{locale === 'en' ? 'Little things worth remembering, all in one place.' : '把值得记住的小事，留在这里。'}</p></div>
    <div className="memory-toolbar"><div><strong>{t('{count} 条记忆', { count: confirmedCount })}</strong></div><button disabled={busy} onClick={() => { setAdding(true); setEditing(null); setText(''); setNewCategory('profile') }}>{t('＋ 添加记忆')}</button></div>
    <div className="memory-controls glass"><div className="memory-filters"><label>{t('分类')}<select aria-label={t('记忆分类筛选')} value={category} onChange={event => setCategory(event.target.value)}><option value="all">{t('全部分类')}</option>{Object.entries(categories).map(([key, value]) => <option key={key} value={key}>{t(value)}</option>)}</select></label><label>{t('状态')}<select aria-label={t('记忆状态筛选')} value={status} onChange={event => setStatus(event.target.value)}>{[['all', '全部状态'], ['confirmed', '已记住'], ['archived', '已归档']].map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</select></label></div><input className="memory-search" aria-label={t('搜索记忆')} placeholder={t('搜索全部记忆')} value={search} onChange={event => setSearch(event.target.value)} /></div>
    <>
    {error && <p role="alert" className="chat-error">{t(error)}</p>}
    {!visible.length && <p className="chat-empty">{t('还没有符合条件的记忆。可在聊天中选择“记住这条”。')}</p>}
    {visible.map(memory => { const memoryPolicy = policies[memory.characterId] || defaultMemoryPolicy; return <article className="memory-card glass managed-memory" key={memory.id}>
      <div><div className="memory-entry-meta"><span className="memory-category-tag">{t(categories[memory.category || 'profile'])}</span><time>{new Date(memory.confirmedAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}</time>{memory.pinned && <span className="memory-pin-label">{locale === 'en' ? 'Pinned' : '已固定'}</span>}{(memory.state === 'archived' || memory.enabled === false) && <span className="memory-muted-label">{t(memory.state === 'archived' ? '已归档' : '已暂停引用')}</span>}</div><h3>{memory.id.startsWith('onboarding:') && profile ? (locale === 'en' ? `You go by “${profile.userName}” and call your companion “${profile.characterName}”.` : `你希望被叫作「${profile.userName}」，称呼 TA 为「${profile.characterName}」。`) : memory.text}</h3>
        <details className="memory-details"><summary><span>{locale === 'en' ? 'Manage this memory' : '管理这条记忆'}</span><span aria-hidden="true">⌄</span></summary><p>{t('来源：{source}', { source: memory.sourceMessageId !== undefined ? `${t(memory.state === 'pending' ? '聊天消息（尚未确认）' : '用户确认聊天消息')} #${memory.sourceMessageId}` : t('手动确认 / 共同事件') })}{memory.updatedAt && ` · ${t('修订于 {date}', { date: new Date(memory.updatedAt).toLocaleString(locale) })}`}</p>
        {memory.sensitive && <p>{t('敏感信息：要我记住吗？确认后仅在相关时引用。')}</p>}
        {memory.state === 'pending' && !!memory.conflictIds?.length && <p role="status">{t('与已有记忆冲突：{memories}。确认新信息会归档旧信息；暂不确认时不自动覆盖。', { memories: memories.filter(item => memory.conflictIds?.includes(item.id)).map(item => item.text).join(locale === 'en' ? '; ' : '；') })}</p>}
        {memory.expiresAt && <p>{t('情境到期：{date}', { date: new Date(memory.expiresAt).toLocaleDateString(locale) })}</p>}
        {memory.originalText && <details><summary>{t('查看保存原话')}</summary><p>{memory.originalText}</p></details>}
        {shareableMemory(memory, memoryPolicy, conversations[memory.characterId]) && <div className="memory-actions"><button disabled={busy} onClick={() => setShareId(memory.id)}>{t('分享回忆卡')}</button></div>}
        {memory.sourceMessageId !== undefined && <div className="memory-actions"><button disabled={busy} onClick={() => { setSourceRole(memory.characterId); setSourceIds([memory.sourceMessageId!]) }}>{t('查看来源')}</button></div>}
        {memory.state === 'pending' && onConfirm && <div className="memory-actions"><button disabled={busy || memoryPolicy.disabledCategories.includes(memory.category || 'profile')} onClick={() => void run(() => onConfirm(memory.id))}>{t('确认记住')}</button><button disabled={busy} onClick={() => void run(() => onUpdate(memory.id, { state: 'rejected', enabled: false }))}>{t('不记住')}</button></div>}
        {memory.state !== 'pending' && <div className="memory-actions"><button disabled={busy} onClick={() => void run(() => onUpdate(memory.id, { pinned: !memory.pinned }))}>{t(memory.pinned ? '取消固定' : '永远别忘')}</button><button disabled={busy} onClick={() => void run(() => onUpdate(memory.id, { state: memory.state === 'archived' ? 'pending' : 'archived', enabled: false }))}>{t(memory.state === 'archived' ? '恢复归档' : '归档')}</button></div>}
        <div className="memory-actions"><button disabled={busy} onClick={() => { setEditing(memory); setAdding(false); setText(memory.text); setNewCategory(memory.category || 'profile'); setImportance(memory.importance || 3); setExpiresAt(memory.expiresAt?.slice(0, 10) || '') }}>{t('编辑')}</button>{memory.state !== 'pending' && memory.state !== 'archived' && <button disabled={busy} onClick={() => run(() => onUpdate(memory.id, { enabled: memory.enabled === false }))}>{t(memory.enabled === false ? '恢复引用' : '暂停引用')}</button>}<button className="danger" disabled={busy} onClick={() => { if (confirm(t('删除这条长期记忆？原聊天消息仍保留。'))) void run(() => onDelete(memory.id)) }}>{t('删除')}</button></div>
      </details></div>
    </article> })}
    {!!sourceIds.length && <div className="memory-card glass"><h3>{t('原始聊天来源')}</h3>{sourceIds.map(id => <p key={id}>#{id} · {conversations[sourceRole]?.find(message => message.id === id && !message.withdrawn)?.text || t('原消息已撤回或不在本机')}</p>)}<button onClick={() => setSourceIds([])}>{t('关闭来源')}</button></div>}
    <p className="memory-help">{t('删除会清除记忆及摘要引用；旧导出备份不受控制，请自行删除旧备份。')}</p>
    </>
    {shareMemory && <MemoryShareDialog key={shareMemory.id} memory={shareMemory} close={() => setShareId(null)} canExport={() => shareableMemory(shareMemory, policies[shareMemory.characterId] || defaultMemoryPolicy, conversations[shareMemory.characterId])} />}
    {(editing || adding) && <div className="memory-modal-overlay"><form className="memory-modal glass" onSubmit={event => { event.preventDefault(); if (!text.trim()) return; void run(async () => { if (editing) await onUpdate(editing.id, { text: text.trim(), category: newCategory, ...(importance !== (editing.importance || 3) ? { importance } : {}), ...(expiresAt !== (editing.expiresAt?.slice(0, 10) || '') ? { expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : undefined } : {}) }); else await onSave({ text: text.trim(), category: newCategory }); setEditing(null); setAdding(false) }) }}>
      <header className="memory-modal-header"><h2>{t(editing ? '纠正长期记忆' : '添加确认记忆')}</h2><button type="button" className="memory-modal-close" aria-label={t('关闭编辑')} disabled={busy} onClick={() => { setEditing(null); setAdding(false) }}><X size={20} /></button></header><p>{t('修改后下次检索即使用新内容，不再引用旧结论。')}</p>
      <textarea aria-label={t('编辑记忆内容')} value={text} onChange={event => setText(event.target.value)} required maxLength={1000} />
      <select aria-label={t('编辑记忆分类')} value={newCategory} onChange={event => setNewCategory(event.target.value as MemoryDraft['category'])}>{Object.entries(categories).map(([key, value]) => <option key={key} value={key}>{t(value)}</option>)}</select>
      {editing && <><label>{t('重要度')}<select aria-label={t('重要度')} value={importance} onChange={event => setImportance(Number(event.target.value))}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>{t('情境到期（留空长期保留）')}<input aria-label={t('情境到期')} type="date" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></label></>}
      <div className="memory-actions memory-modal-actions"><button type="submit" disabled={busy}>{t('保存记忆')}</button><button type="button" disabled={busy} onClick={() => { setEditing(null); setAdding(false) }}>{t('取消')}</button></div>{error && <p role="alert">{t(error)}</p>}
    </form></div>}
  </section>
}
