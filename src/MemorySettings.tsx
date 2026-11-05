import { useState } from 'react'
import { Brain, ChevronRight } from 'lucide-react'
import { characters, type CharacterId } from './data'
import { useI18n } from './i18n'
import { defaultMemoryPolicy, type MemoryPolicy } from './longMemory'
import type { MemoryDraft } from './ChatPanel'

const categories: Record<MemoryDraft['category'], string> = { profile: '用户偏好', relationship: '共同经历', context: '近期情境', emotion: '情绪与支持' }

export default function MemorySettings({ policies, onPolicy }: { policies: Partial<Record<CharacterId, MemoryPolicy>>; onPolicy: (role: CharacterId, policy: MemoryPolicy) => Promise<void> }) {
  const { t } = useI18n()
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const all=characters.map(character=>policies[character.id]||defaultMemoryPolicy)
  const update=async(change:(policy:MemoryPolicy)=>MemoryPolicy)=>{if(busy)return;setBusy(true);setError('');try{for(const character of characters)await onPolicy(character.id,change(policies[character.id]||defaultMemoryPolicy))}catch{setError('记忆设置未全部保存，请重试')}finally{setBusy(false)}}
  return <div className="profile-settings glass memory-settings-profile">
    <button className="profile-setting-row" aria-expanded={open} aria-controls="profile-memory-settings" onClick={()=>setOpen(value=>!value)}><Brain/><span>{t('记忆设置')}</span><small>{t('自动保存')}</small><ChevronRight className="profile-chevron"/></button>
    {open&&<div id="profile-memory-settings" className="profile-inline-panel"><p>{t('选择哪些信息可以被记住和在聊天中引用')}</p><label className="policy-master"><span><strong>{t('自动保存聊天中的记忆')}</strong><small>{t('关闭后仅保留原始聊天')}</small></span><input type="checkbox" checked={all.every(item=>item.extractionEnabled)} disabled={busy} onChange={event=>{const checked=event.target.checked;void update(item=>({...item,extractionEnabled:checked}))}}/></label><div className="policy-categories">{Object.entries(categories).map(([key,value])=><label key={key}><input type="checkbox" aria-label={t('允许{category}记忆',{category:t(value)})} checked={all.every(item=>!item.disabledCategories.includes(key as MemoryDraft['category']))} disabled={busy} onChange={event=>{const checked=event.target.checked;void update(item=>({...item,disabledCategories:checked?item.disabledCategories.filter(category=>category!==key):[...new Set([...item.disabledCategories,key as MemoryDraft['category']])]}))}}/><span>{t(value)}</span></label>)}</div>{error&&<p role="alert" className="profile-primary-error">{t(error)}</p>}</div>}
  </div>
}
