import { useState } from 'react'
import type { ConfirmedMemory } from './chatService'
import { characters, type CharacterId } from './data'
import type { MemoryDraft } from './ChatPanel'

const categories = { profile: '用户偏好', relationship: '共同经历', context: '近期情境', emotion: '情绪与支持' }
export default function MemoryPanel({ memories, selected, onSave, onUpdate, onDelete, onClear }: {
  memories: ConfirmedMemory[]; selected: CharacterId
  onSave: (draft: MemoryDraft) => Promise<void>
  onUpdate: (id: string, patch: Partial<ConfirmedMemory>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClear: (id: CharacterId) => Promise<void>
}) {
  const [role, setRole] = useState<CharacterId>(selected)
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<ConfirmedMemory | null>(null)
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [newCategory, setNewCategory] = useState<MemoryDraft['category']>('profile')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const visible = memories.filter(memory => memory.characterId === role && (category === 'all' || (memory.category || 'profile') === category) && memory.text.includes(search)).sort((a, b) => (b.updatedAt || b.confirmedAt).localeCompare(a.updatedAt || a.confirmedAt))
  const run = async (task: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await task() } catch { setError('本机存储操作失败，数据未更新，请重试') } finally { setBusy(false) } }
  return <section className="screen memory-page">
    <div className="memory-intro glass"><h2>由你确认，才会被记住</h2><p>记忆按角色隔离；可纠正、暂停引用或删除。聊天前只检索少量相关内容，不上传全部历史。</p></div>
    <div className="memory-filters"><label>角色<select aria-label="记忆角色" value={role} onChange={event => setRole(event.target.value as CharacterId)}>{characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label><label>分类<select aria-label="记忆分类筛选" value={category} onChange={event => setCategory(event.target.value)}><option value="all">全部分类</option>{Object.entries(categories).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label></div>
    <input className="memory-search" aria-label="搜索记忆" placeholder="搜索这位角色的记忆" value={search} onChange={event => setSearch(event.target.value)} />
    <div className="memory-toolbar"><span>{visible.length} 条已确认记忆</span><button onClick={() => { setAdding(true); setEditing(null); setText(''); setNewCategory('profile') }}>＋ 添加记忆</button></div>
    <p className="memory-help">手动添加保存到当前主角色：{characters.find(character => character.id === selected)?.name}</p>
    {error && <p role="alert" className="chat-error">{error}</p>}
    {!visible.length && <p className="chat-empty">还没有符合条件的记忆。可在聊天中选择“记住这条”。</p>}
    {visible.map(memory => <article className="memory-card glass managed-memory" key={memory.id}>
      <div><small>{categories[memory.category || 'profile']} · {new Date(memory.confirmedAt).toLocaleDateString('zh-CN')} · {memory.enabled === false ? '已暂停引用' : '允许相关时引用'}</small><h3>{memory.text}</h3>
        <p>来源：{memory.sourceMessageId ? `用户确认聊天消息 #${memory.sourceMessageId}` : '手动确认 / 共同事件'}{memory.updatedAt && ` · 修订于 ${new Date(memory.updatedAt).toLocaleString('zh-CN')}`}</p>
        <div className="memory-actions"><button disabled={busy} onClick={() => { setEditing(memory); setAdding(false); setText(memory.text); setNewCategory(memory.category || 'profile') }}>编辑</button><button disabled={busy} onClick={() => run(() => onUpdate(memory.id, { enabled: memory.enabled === false }))}>{memory.enabled === false ? '恢复引用' : '暂停引用'}</button><button className="danger" disabled={busy} onClick={() => { if (confirm('删除这条长期记忆？原聊天消息仍保留。')) void run(() => onDelete(memory.id)) }}>删除</button></div>
      </div>
    </article>)}
    <button className="clear-memories" disabled={busy} onClick={() => { if (confirm(`仅清除${characters.find(character => character.id === role)?.name}的全部长期记忆？聊天记录不受影响。`)) void run(() => onClear(role)) }}>清除该角色的全部记忆</button>
    {(editing || adding) && <div className="memory-modal-overlay"><form className="memory-modal glass" onSubmit={event => { event.preventDefault(); if (!text.trim()) return; void run(async () => { if (editing) await onUpdate(editing.id, { text: text.trim(), category: newCategory }); else await onSave({ text: text.trim(), category: newCategory }); setEditing(null); setAdding(false) }) }}>
      <h2>{editing ? '纠正长期记忆' : '添加确认记忆'}</h2><p>修改后下次检索即使用新内容，不再引用旧结论。</p>
      <textarea aria-label="编辑记忆内容" value={text} onChange={event => setText(event.target.value)} required maxLength={1000} />
      <select aria-label="编辑记忆分类" value={newCategory} onChange={event => setNewCategory(event.target.value as MemoryDraft['category'])}>{Object.entries(categories).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
      <div className="memory-actions"><button type="submit" disabled={busy}>保存记忆</button><button type="button" onClick={() => { setEditing(null); setAdding(false) }}>取消</button></div>{error && <p role="alert">{error}</p>}
    </form></div>}
  </section>
}
