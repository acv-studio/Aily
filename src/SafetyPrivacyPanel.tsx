import { useState } from 'react'
import { t, useI18n } from './i18n'
import './safetyPrivacy.css'

export function SafetyConsent({ onAccepted, returning = false }: { onAccepted: () => void; returning?: boolean }) {
  useI18n()
  const [adult, setAdult] = useState(false)
  const [understood, setUnderstood] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState('')
  return <section className="safety-consent glass" aria-label={t("年龄与 AI 身份确认")}>
    <h2>{t("先了解彼此的边界")}</h2>
    <p>{t("Aily 是虚构的 AI 角色，不是真人，也不提供专业诊疗。请保持现实中的关系与支持；不付费也不会影响基本回应。")}</p>
    <p>{t("本原型仅限 18 周岁及以上使用，不开放露骨色情内容。年龄为自我声明，不是身份核验。")}</p>
    <p>{t("聊天与附件保存在本机，未加密的本机记录依赖设备保护。配置模型后，文字、近期上下文及相关确认记忆会发送给你选择的服务；临时会话文字也会发送。附件不发送。")}</p>
    <p>{t("应用没有训练上传功能，不要求训练授权；外部模型的数据留存及训练使用遵循其政策，请先核查。没有 Key 时使用固定本地演示。")}</p>
    <label><input type="checkbox" checked={adult} onChange={event => { setAdult(event.target.checked); setBlocked(false) }} />{t("我已年满 18 周岁")}</label>
    <label><input type="checkbox" checked={understood} onChange={event => setUnderstood(event.target.checked)} />{t("我理解 AI 身份与数据说明")}</label>
    <button className="text-button" onClick={() => { setAdult(false); setBlocked(true) }}>{t("我未满 18 周岁")}</button>
    {blocked && <p role="alert">{t("暂不能使用本原型。需要支持时，请联系可信任的成年人。")}</p>}
    {error && <p role="alert">{t(error)}</p>}
    {returning && <button className="primary" disabled={!adult || !understood || blocked} onClick={() => { try { onAccepted() } catch { setError("无法保存确认，请允许浏览器存储后重试") } }}>{t("确认并继续")}</button>}
    {!returning && <button className="primary" disabled={!adult || !understood || blocked} onClick={() => { try { onAccepted() } catch { setError("无法保存确认，请允许浏览器存储后重试") } }}>{t("遇见 TA")}</button>}
  </section>
}

export default function SafetyPrivacyPanel({ close, onDelete }: { close: () => void; onDelete: () => Promise<void> }) {
  const { locale } = useI18n()
  const deletionWord = locale === 'en' ? 'DELETE' : '删除'
  const [confirming, setConfirming] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <section className="screen safety-panel">
    <button className="text-button" onClick={close} disabled={busy}>{t("返回我的")}</button>
    <h2>{t("安全与隐私")}</h2>
    <article className="glass"><h3>{t("你始终在与 AI 互动")}</h3><p>{t("角色是虚构的，不能替代现实关系、医生或紧急服务。不通过依赖、羞辱或断联要求你消费。")}</p><p>{t("自伤或暴力风险会触发本机支持性回复。中国大陆紧急危险可拨打 110 / 120；其他地区请联系当地紧急服务，并寻找可信任的人陪伴。")}</p><p>{t("本机规则与模型提示不能识别所有风险，也可能误判；不是经过认证的内容审核服务。")}</p></article>
    <article className="glass"><h3>{t("数据由你掌握")}</h3><p>{t("聊天、记忆、附件、主动消息设置与演示钱包保存在本机；记录本身未加密，加密备份需你设置密码。API Key 仅在当前浏览器会话保存。")}</p><p>{t("配置外部模型后，文字与相关上下文会直发该服务，临时会话也不例外。请核查服务方的留存与训练政策。应用没有训练上传功能，不以训练授权换取基础使用。")}</p><p>{t("在“回忆”管理记忆类型，在“角色主动消息设置”管理主动消息；“本机聊天与记忆”提供加密导出、导入及仅清空聊天。暂无个性化推荐服务。")}</p></article>
    <article className="glass"><h3>{t("举报与求助")}</h3><p>{t("本原型尚无人工客服、举报提交或申诉处理服务，也没有真实扣费。遇到不适内容请停止回复；不要在模型聊天中提交投诉或更多敏感资料。本机规则不能替代人工处置。")}</p></article>
    <article className="glass"><h3>{t("删除本机使用资料")}</h3><p>{t("没有服务器账户，因此不是线上账户注销。此操作删除本机全部聊天、记忆、附件、设置、成年确认、当前会话 Key，以及演示币和交易记录，并退出体验。")}</p><p>{t("无法撤回已发给模型服务的数据，也不会删除下载的备份、其他设备或其他浏览器资料；它们需你另行删除。请先导出需要保留的记录，并关闭其他 Aily 标签页。")}</p>
      {!confirming ? <button className="danger-action" onClick={() => setConfirming(true)}>{t("删除本机使用资料")}</button> : <div role="group" aria-label={t("确认删除本机资料")}><p>{t('不可撤销。输入“{word}”后确认。', { word: deletionWord })}</p><label>{t('输入“{word}”确认', { word: deletionWord })}<input value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label><button className="danger-action" disabled={confirmation !== deletionWord || busy} onClick={async () => { setBusy(true); setError(''); try { await onDelete() } catch (failure) { setError(failure instanceof Error ? failure.message : t("删除失败，请重试")); setBusy(false) } }}>{t("永久删除并退出")}</button><button className="text-button" disabled={busy} onClick={() => { setConfirming(false); setConfirmation('') }}>{t("取消删除")}</button></div>}
      {error && <p role="alert">{t(error)}</p>}
    </article>
  </section>
}
