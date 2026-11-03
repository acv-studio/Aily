import { useState } from 'react'
import type { ConfirmedMemory } from './chatService'
import { characters, type CharacterId } from './data'
import type { MemoryPolicy } from './longMemory'
import type { OnboardingProfile } from './onboarding'
import { getRelationship, relationshipEvents, stages } from './relationship'
import { useRelationshipMotion } from './glassMotion'
import { useI18n } from './i18n'

export default function RelationshipPanel({ role, memories, policy, profile, onSave }: {
  role: CharacterId; memories: ConfirmedMemory[]; policy: MemoryPolicy
  profile?: OnboardingProfile | null; onSave?: (profile: OnboardingProfile) => Promise<void>
}) {
  const { t } = useI18n()
  const relationship = getRelationship(role, memories, policy)
  // Track confirmations independently of enabled/category policy so restoring
  // an existing memory cannot masquerade as a newly earned upgrade.
  const confirmedIds = memories.filter(memory => memory.characterId === role && memory.state !== 'pending' && memory.state !== 'rejected').map(memory => memory.id)
  const stageSurface = useRelationshipMotion(role, relationship.stage.threshold, confirmedIds)
  const events = relationshipEvents(role, memories, policy).slice(0, 3)
  const savedName = profile?.exclusiveNames?.[role] || ''
  const [name, setName] = useState(savedName)
  const [consent, setConsent] = useState(!!savedName && profile?.familiarNames === true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const unlocked = relationship.stage.threshold >= 9
  const save = async () => {
    if (!profile || !onSave || busy) return
    setBusy(true); setResult('')
    try {
      const exclusiveNames = { ...profile.exclusiveNames }
      if (consent) exclusiveNames[role] = name.trim()
      else delete exclusiveNames[role]
      await onSave({ ...profile, exclusiveNames, familiarNames: consent ? true : profile.familiarNames })
      setResult(consent ? '称呼已保存，之后仍可随时停用。' : '称呼已停用，关系状态不受影响。')
    } catch { setResult('称呼未保存，请重试。') }
    finally { setBusy(false) }
  }
  return <section className="relationship-panel glass" aria-label={t('关系阶段')}>
    <small>{t('与{name}的相处', { name: t(characters.find(character => character.id === role)!.name) })}</small>
    <div className="relationship-stage" ref={stageSurface} aria-live="polite" aria-atomic="true"><span className="glass-glint" aria-hidden="true" /><h2>{t(relationship.stage.name)}</h2><p>{t(relationship.stage.description)}</p></div>
    <ul className="relationship-stages" aria-label={t('关系状态')}>{stages.map(stage => <li key={stage.name} aria-current={stage.name === relationship.stage.name ? 'step' : undefined}>{t(stage.name)}</li>)}</ul>
    <h3>{t('共同事件')}</h3>
    {events.length ? <ul className="relationship-events">{events.map(event => <li key={event.id}>{event.id.startsWith('onboarding:') ? t('第一次确认彼此的称呼') : event.text}</li>)}</ul> : <p>{t('还没有确认的共同回忆。按自己的节奏认识彼此就好。')}</p>}
    <p>{t('状态来自你确认并允许使用的回忆，不因暂时离开或付费改变。管理回忆后会重新呈现当前状态。')}</p>
    <div className="exclusive-name"><h3>{t('专属称呼')} · {t(unlocked ? '已解锁' : '待解锁')}</h3>
      {!unlocked ? <p>{t('亲密阶段解锁，由你决定是否使用。')}</p> : profile && onSave ? <form onSubmit={event => { event.preventDefault(); void save() }}>
        <label>{t('专属称呼')}<input aria-label={t('专属称呼')} value={name} maxLength={80} disabled={busy} onChange={event => setName(event.target.value)} placeholder={t('你希望这位角色怎么叫你')} /></label>
        <label className="nickname-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />{t('同意这位角色使用专属称呼')}</label>
        <p>{t('仅用于这位角色；不是成人互动授权。取消同意并保存即可停用。')}</p>
        <button type="submit" disabled={busy || (consent && !name.trim())}>{t(busy ? '正在保存…' : '保存专属称呼')}</button>
        {result && <p role="status">{t(result)}</p>}
      </form> : <p>{t('先在“我的”中确认称呼与互动偏好，再设置专属称呼。')}</p>}
    </div>
  </section>
}
