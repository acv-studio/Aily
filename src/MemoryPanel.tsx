import { useState } from 'react'
import { useI18n } from './i18n'
import type { ChatMessage, ConfirmedMemory } from './chatService'
import { defaultMemoryPolicy, displaySummary, semanticScore, type ConversationSummary, type MemoryPolicy } from './longMemory'
import { characters, type CharacterId } from './data'
import type { MemoryDraft } from './ChatPanel'
import RelationshipPanel from './RelationshipPanel'
import type { OnboardingProfile } from './onboarding'

const categories = { profile: '用户偏好', relationship: '共同经历', context: '近期情境', emotion: '情绪与支持' }
export default function MemoryPanel({ memories, selected, onSave, onUpdate, onDelete, onClear, summaries = [], policies = {}, onPolicy, onConfirm, conversations = {}, profile, onProfile }: {
  profile?: OnboardingProfile | null; onProfile?: (profile: OnboardingProfile) => Promise<void>
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
  const [role, setRole] = useState<CharacterId>(selected)
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<ConfirmedMemory | null>(null)
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [newCategory, setNewCategory] = useState<MemoryDraft['category']>('profile')
  const [importance, setImportance] = useState(3)
  const [expiresAt, setExpiresAt] = useState('')
  const [sourceIds, setSourceIds] = useState<number[]>([])
  const policy = policies[role] || defaultMemoryPolicy
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const visible = memories.filter(memory => memory.characterId === role && (category === 'all' || (memory.category || 'profile') === category) && memory.state !== 'rejected' && (!search || memory.text.toLowerCase().includes(search.toLowerCase()) || semanticScore(search, memory.text) > 0)).sort((a, b) => (b.updatedAt || b.confirmedAt).localeCompare(a.updatedAt || a.confirmedAt))
  const run = async (task: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await task() } catch { setError('本机存储操作失败，数据未更新，请重试') } finally { setBusy(false) } }
  return <section className="screen memory-page">
    <div className="memory-intro glass"><h2>{t('由你确认，才会被记住')}</h2><p>{t('自动识别值得记住的话，先提议再确认；敏感内容必须由你决定。支持本地中英文主题语义匹配，未知表达降级文字检索。')}</p></div>
    <div className="memory-filters"><label>{t('角色')}<select aria-label={t('记忆角色')} value={role} onChange={event => setRole(event.target.value as CharacterId)}>{characters.map(character => <option key={character.id} value={character.id}>{t(character.name)}</option>)}</select></label><label>{t('分类')}<select aria-label={t('记忆分类筛选')} value={category} onChange={event => setCategory(event.target.value)}><option value="all">{t('全部分类')}</option>{Object.entries(categories).map(([key, value]) => <option key={key} value={key}>{t(value)}</option>)}</select></label></div>
    {onPolicy && <details className="memory-card glass"><summary>{t('记忆与敏感信息控制')}</summary><label><input type="checkbox" checked={policy.extractionEnabled} disabled={busy} onChange={event => void run(() => onPolicy(role, { ...policy, extractionEnabled: event.target.checked }))} />{t('自动提议与摘要（关闭后仅保留原始聊天）')}</label>{Object.entries(categories).map(([key, value]) => <label key={key} style={{ display: 'block' }}><input type="checkbox" checked={!policy.disabledCategories.includes(key as MemoryDraft['category'])} disabled={busy} onChange={event => void run(() => onPolicy(role, { ...policy, disabledCategories: event.target.checked ? policy.disabledCategories.filter(item => item !== key) : [...policy.disabledCategories, key as MemoryDraft['category']] }))} />{t('允许{category}记忆', { category: t(value) })}</label>)}<p>{t('关闭某类会停止该类的提议、摘要及已有记忆引用；不删除原始聊天。健康、创伤、性和身份等敏感信息不会自动进入摘要。')}</p></details>}
    <input className="memory-search" aria-label={t('搜索记忆')} placeholder={t('搜索这位角色的记忆')} value={search} onChange={event => setSearch(event.target.value)} />
    <div className="memory-toolbar"><span>{t('{count} 条记忆 · {pending} 条待确认', { count: visible.filter(item => item.state !== 'pending').length, pending: visible.filter(item => item.state === 'pending').length })}</span><button onClick={() => { setAdding(true); setEditing(null); setText(''); setNewCategory('profile') }}>{t('＋ 添加记忆')}</button></div>
    <p className="memory-help">{t('手动添加保存到当前主角色：{name}', { name: t(characters.find(character => character.id === selected)?.name || '') })}</p>
    {error && <p role="alert" className="chat-error">{t(error)}</p>}
    {!visible.length && <p className="chat-empty">{t('还没有符合条件的记忆。可在聊天中选择“记住这条”。')}</p>}
    {visible.map(memory => <article className="memory-card glass managed-memory" key={memory.id}>
      <div><small>{t(categories[memory.category || 'profile'])} · {new Date(memory.confirmedAt).toLocaleDateString(locale)} · {t(memory.state === 'pending' ? '待确认 · 不会引用' : memory.state === 'archived' || !!memory.expiresAt && Date.parse(memory.expiresAt) <= Date.now() ? '已归档 / 已到期 · 不会引用' : policy.disabledCategories.includes(memory.category || 'profile') ? '该类已关闭' : memory.enabled === false ? '已暂停引用' : '允许相关时引用')} · {t('重要度 {count}', { count: memory.importance || 3 })}{memory.pinned ? ` · ${t('永远别忘')}` : ''}</small><h3>{memory.text}</h3>
        <p>{t('来源：{source}', { source: memory.sourceMessageId !== undefined ? `${t(memory.state === 'pending' ? '聊天消息（尚未确认）' : '用户确认聊天消息')} #${memory.sourceMessageId}` : t('手动确认 / 共同事件') })}{memory.updatedAt && ` · ${t('修订于 {date}', { date: new Date(memory.updatedAt).toLocaleString(locale) })}`}</p>
        {memory.sensitive && <p>{t('敏感信息：要我记住吗？确认后仅在相关时引用。')}</p>}
        {memory.state === 'pending' && !!memory.conflictIds?.length && <p role="status">{t('与已有记忆冲突：{memories}。确认新信息会归档旧信息；暂不确认时不自动覆盖。', { memories: memories.filter(item => memory.conflictIds?.includes(item.id)).map(item => item.text).join(locale === 'en' ? '; ' : '；') })}</p>}
        {memory.expiresAt && <p>{t('情境到期：{date}', { date: new Date(memory.expiresAt).toLocaleDateString(locale) })}</p>}
        {memory.originalText && <details><summary>{t('查看保存原话')}</summary><p>{memory.originalText}</p></details>}
        {memory.sourceMessageId !== undefined && <div className="memory-actions"><button disabled={busy} onClick={() => setSourceIds([memory.sourceMessageId!])}>{t('查看来源')}</button></div>}
        {memory.state === 'pending' && onConfirm && <div className="memory-actions"><button disabled={busy || policy.disabledCategories.includes(memory.category || 'profile')} onClick={() => void run(() => onConfirm(memory.id))}>{t('确认记住')}</button><button disabled={busy} onClick={() => void run(() => onUpdate(memory.id, { state: 'rejected', enabled: false }))}>{t('不记住')}</button></div>}
        {memory.state !== 'pending' && <div className="memory-actions"><button disabled={busy} onClick={() => void run(() => onUpdate(memory.id, { pinned: !memory.pinned }))}>{t(memory.pinned ? '取消固定' : '永远别忘')}</button><button disabled={busy} onClick={() => void run(() => onUpdate(memory.id, { state: memory.state === 'archived' ? 'pending' : 'archived', enabled: false }))}>{t(memory.state === 'archived' ? '恢复归档' : '归档')}</button></div>}
        <div className="memory-actions"><button disabled={busy} onClick={() => { setEditing(memory); setAdding(false); setText(memory.text); setNewCategory(memory.category || 'profile'); setImportance(memory.importance || 3); setExpiresAt(memory.expiresAt?.slice(0, 10) || '') }}>{t('编辑')}</button>{memory.state !== 'pending' && memory.state !== 'archived' && <button disabled={busy} onClick={() => run(() => onUpdate(memory.id, { enabled: memory.enabled === false }))}>{t(memory.enabled === false ? '恢复引用' : '暂停引用')}</button>}<button className="danger" disabled={busy} onClick={() => { if (confirm(t('删除这条长期记忆？原聊天消息仍保留。'))) void run(() => onDelete(memory.id)) }}>{t('删除')}</button></div>
      </div>
    </article>)}
    <details className="memory-card glass"><summary>{t('持续对话摘要（日 / 周 / 月 / 年）')}</summary><p>{t('本地按主题整理全部可整理的历史，不是模型生成的完整叙事。待确认、敏感、关闭类别、撤回及删除来源不进入摘要；摘要不是已确认事实。日期分层以 UTC 为准。')}</p>{summaries.filter(summary => summary.characterId === role).sort((a, b) => b.periodKey.localeCompare(a.periodKey)).map(summary => <article className="managed-memory" key={summary.id}><h3>{t(({ day: '日', week: '周', month: '月', year: '年' })[summary.period])} · {summary.periodKey}</h3><p>{displaySummary(summary, locale)}</p><div className="memory-actions"><button onClick={() => setSourceIds(summary.sourceMessageIds)}>{t('查看 {count} 条来源', { count: summary.sourceMessageIds.length })}</button></div></article>)}</details>
    {!!sourceIds.length && <div className="memory-card glass"><h3>{t('原始聊天来源')}</h3>{sourceIds.map(id => <p key={id}>#{id} · {conversations[role]?.find(message => message.id === id && !message.withdrawn)?.text || t('原消息已撤回或不在本机')}</p>)}<button onClick={() => setSourceIds([])}>{t('关闭来源')}</button></div>}
    <p className="memory-help">{t('删除会清除记忆及摘要引用；旧导出备份不受控制，请自行删除旧备份。')}</p>
    <button className="clear-memories" disabled={busy} onClick={() => { if (confirm(t('仅清除{name}的全部长期记忆？聊天记录不受影响。', { name: t(characters.find(character => character.id === role)?.name || '') }))) void run(() => onClear(role)) }}>{t('清除该角色的全部记忆')}</button>
    {(editing || adding) && <div className="memory-modal-overlay"><form className="memory-modal glass" onSubmit={event => { event.preventDefault(); if (!text.trim()) return; void run(async () => { if (editing) await onUpdate(editing.id, { text: text.trim(), category: newCategory, ...(importance !== (editing.importance || 3) ? { importance } : {}), ...(expiresAt !== (editing.expiresAt?.slice(0, 10) || '') ? { expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : undefined } : {}) }); else await onSave({ text: text.trim(), category: newCategory }); setEditing(null); setAdding(false) }) }}>
      <h2>{t(editing ? '纠正长期记忆' : '添加确认记忆')}</h2><p>{t('修改后下次检索即使用新内容，不再引用旧结论。')}</p>
      <textarea aria-label={t('编辑记忆内容')} value={text} onChange={event => setText(event.target.value)} required maxLength={1000} />
      <select aria-label={t('编辑记忆分类')} value={newCategory} onChange={event => setNewCategory(event.target.value as MemoryDraft['category'])}>{Object.entries(categories).map(([key, value]) => <option key={key} value={key}>{t(value)}</option>)}</select>
      {editing && <><label>{t('重要度')}<select aria-label={t('重要度')} value={importance} onChange={event => setImportance(Number(event.target.value))}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>{t('情境到期（留空长期保留）')}<input aria-label={t('情境到期')} type="date" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></label></>}
      <div className="memory-actions"><button type="submit" disabled={busy}>{t('保存记忆')}</button><button type="button" onClick={() => { setEditing(null); setAdding(false) }}>{t('取消')}</button></div>{error && <p role="alert">{t(error)}</p>}
    </form></div>}
  </section>
}
