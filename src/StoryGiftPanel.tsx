import { useEffect, useRef, useState } from 'react'
import { completeDemoStoryEvent, type DemoStoryEvent } from './giftDemo'
import { storyGiftEvents } from './storyGifts'
import { characters } from './data'

/** A gift event is a fixed fictional scene, not a claim about the user's life. */
export default function StoryGiftPanel({ record, close }: { record: DemoStoryEvent; close: () => void }) {
  const event = storyGiftEvents.find(item => item.id === record.eventId)!
  const character = characters.find(item => item.id === record.characterId)!
  const [choiceId, setChoiceId] = useState(record.choiceId || '')
  const [saved, setSaved] = useState(record)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; heading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); return () => { mounted.current = false } }, [])
  useEffect(() => { setSaved(record); if (record.choiceId) setChoiceId(record.choiceId) }, [record])
  const choice = event.choices.find(item => item.id === (saved.choiceId || choiceId))
  const confirm = async () => {
    if (!choice || busyRef.current || saved.choiceId) return
    busyRef.current = true; setBusy(true); setError('')
    try {
      const result = await completeDemoStoryEvent(record.characterId, record.eventId, choice.id)
      if (mounted.current) { setSaved(result); setChoiceId(result.choiceId!) }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : '保存失败，请重试。')
    } finally { busyRef.current = false; if (mounted.current) setBusy(false) }
  }
  return <section className="screen gift-store story-gift-panel" aria-label="剧情礼物互动">
    <button className="secondary" disabled={busy} onClick={close}>返回商城</button>
    <p className="gift-description">与{character.name}的共同事件 · 固定本机剧情，非 AI 生成</p>
    <h2 ref={heading} tabIndex={-1}>{event.title}</h2>
    <div className="story-gift-scene glass"><p>{event.intro}</p><p>{character.name}在你身旁，等你决定如何度过这一刻。</p></div>
    {!saved.choiceId && <div className="story-gift-choices" aria-label="事件选择">{event.choices.map(item => <button key={item.id} aria-pressed={choiceId === item.id} disabled={busy} onClick={() => { setChoiceId(item.id); setError('') }}>{item.label}</button>)}</div>}
    {choice && <div className="gift-feedback"><p>你的选择：{choice.label}</p><p>{character.name}：{choice.response}</p>{!saved.choiceId && <small>仅预览，尚未保存。可以重选或返回，演示币不会再次扣除。</small>}</div>}
    {error && <p className="store-error" role="alert">{error}</p>}
    {saved.choiceId ? <p role="status">事件已完成，可随时回看；不重复扣币，也不重选结局。</p> : <button className="primary" disabled={!choice || busy} onClick={() => void confirm()}>{busy ? '正在保存…' : '确认保存事件选择'}</button>}
    <p className="gift-description">剧情选择仅保存到本机商城，不自动写入聊天或长期记忆。关闭页面可稍后继续；聊天主线与基本回应仍免费可用。</p>
  </section>
}
