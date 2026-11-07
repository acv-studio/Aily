import { useState } from 'react'
import type { Locale } from './i18n'
import { ingredients, defaultSettings, planMeal, chooseWasher } from './mealPlanner'
import type { MealSettings, MealPlan, Member, PantryItem, WashRecord } from './mealPlanner'
import './mealPlanner.css'

const STORAGE_KEY = 'aily.ext.meal.v1'
const uid = () => `meal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const money = (n: number) => `¥${n.toFixed(2)}`
const qty = (n: number) => Number(n.toFixed(2)).toString()
const dateValid = (text: string) => /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text)) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text

function validate(settings: MealSettings): string | null {
  if (!settings || !Array.isArray(settings.members) || settings.members.length < 1 || settings.members.length > 12) return '家庭人数须为 1–12 人。'
  const ids = new Set<string>()
  for (const m of settings.members) {
    if (!m || typeof m.id !== 'string' || !m.id.trim() || ids.has(m.id)) return '成员标识无效或重复。'
    ids.add(m.id)
    if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 40) return '请填写每位成员的名字（最多 40 字）。'
    if (![0.5, 1, 1.5].includes(m.portion)) return '请选择有效的食量。'
    if (![m.likes, m.avoids, m.allergies].every(v => typeof v === 'string' && v.length <= 1000)) return '喜好、忌口和过敏信息须为不超过 1000 字的文本。'
  }
  if (!Number.isFinite(settings.budget) || settings.budget < 0 || settings.budget > 100000) return '预算须为 0–100000 元之间的有效数字。'
  if (!Number.isInteger(settings.dishCount) || settings.dishCount < 1 || settings.dishCount > 4) return '菜数须为 1–4 道（另加主食）。'
  if (typeof settings.vegetarian !== 'boolean') return '素食设置无效。'
  if (!Array.isArray(settings.pantry) || settings.pantry.length > 1000) return '冰箱数据须为最多 1000 条的列表。'
  for (const item of settings.pantry) {
    if (!item || !ingredients.some(i => i.id === item.ingredientId) || !Number.isFinite(item.quantity) || item.quantity < 0 || item.quantity > 1000000 || (item.expiresOn !== undefined && !dateValid(item.expiresOn))) return '冰箱食材、数量或到期日期无效。'
    if (ingredients.find(i => i.id === item.ingredientId)?.unit === '个' && !Number.isInteger(item.quantity)) return '计件食材（鸡蛋）请按整数个填写库存。'
  }
  if (!settings.prices || typeof settings.prices !== 'object' || Array.isArray(settings.prices)) return '参考价格格式无效。'
  for (const [id, price] of Object.entries(settings.prices)) if (!ingredients.some(i => i.id === id) || typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 100000) return '参考价格须为不小于 0 且不超过每克 / 个 100000 元的有限数字。'
  return null
}

type Saved = { settings: MealSettings; history: WashRecord[] }
function load(): Saved & { error: string } {
  const fallback = { settings: clone(defaultSettings), history: [], error: '' }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const data = JSON.parse(raw) as Saved
    const invalid = validate(data.settings)
    if (invalid || !Array.isArray(data.history) || !data.history.every(r => r && typeof r.id === 'string' && !!r.id && typeof r.memberId === 'string' && !!r.memberId && dateValid(r.date) && (r.cookId === undefined || typeof r.cookId === 'string')) || new Set(data.history.map(r => r.id)).size !== data.history.length) throw new Error(invalid || '洗碗历史格式无效。')
    return { ...data, error: '' }
  } catch {
    return { ...fallback, error: '无法读取本地保存的数据（数据损坏或存储不可用）。当前使用默认设置；原数据未被自动覆盖。请检查并显式保存。' }
  }
}

export default function MealPlannerApp({ locale }: { locale: Locale }) {
  const [initial] = useState(load)
  const [settings, setSettings] = useState(initial.settings)
  const [draft, setDraft] = useState(() => clone(initial.settings))
  const [history, setHistory] = useState(initial.history)
  const [error, setError] = useState(initial.error)
  const [notice, setNotice] = useState('')
  const [panel, setPanel] = useState<'family' | 'pantry' | null>(null)
  const [step, setStep] = useState(0)
  const [plan, setPlan] = useState<MealPlan | null>(null)
  const [variant, setVariant] = useState(0)
  const [purchased, setPurchased] = useState<string[]>([])
  const [appliedPurchaseIds, setAppliedPurchaseIds] = useState<string[]>([])
  const purchaseApplied = !!plan && plan.shopping.filter(item => item.toBuy > 0).every(item => appliedPurchaseIds.includes(item.ingredientId))
  const [prepared, setPrepared] = useState<string[]>([])
  const [cooked, setCooked] = useState<string[]>([])
  const [cookId, setCookId] = useState('')
  const [washerId, setWasherId] = useState('')
  const [washed, setWashed] = useState(false)
  const [consumed, setConsumed] = useState(false)
  const [confirmConsume, setConfirmConsume] = useState(false)
  const [newIngredient, setNewIngredient] = useState(ingredients[0]?.id ?? '')
  const en = locale === 'en'
  const t = (zh: string, english: string) => en ? english : zh
  const tabs = [t('吃什么', 'Plan'), t('买菜', 'Shop'), t('备菜', 'Prep'), t('炒菜', 'Cook'), t('谁洗碗', 'Dishes')]
  const toggle = (list: string[], id: string) => list.includes(id) ? list.filter(x => x !== id) : [...list, id]
  const recommended = chooseWasher(settings.members, history, cookId || undefined)
  const eligible = settings.members.filter(m => settings.members.length === 1 || m.id !== cookId)
  const selectedWasher = eligible.find(m => m.id === washerId) ?? recommended

  function persist(next: MealSettings, nextHistory = history): boolean {
    const invalid = validate(next)
    if (invalid) { setError(invalid); setNotice(''); return false }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: next, history: nextHistory }))
      setSettings(next); setHistory(nextHistory); setDraft(clone(next)); setError(''); return true
    } catch { setError(t('本地保存失败，可能存储已满或被禁用。操作未生效，请重试。', 'Local save failed: storage may be full or disabled. Nothing was applied; please retry.')); setNotice(''); return false }
  }
  function invalidate() {
    setPlan(null); setStep(0); setPurchased([]); setAppliedPurchaseIds([]); setPrepared([]); setCooked([]); setWashed(false); setConsumed(false); setConfirmConsume(false); setCookId(''); setWasherId('')
  }
  function saveSettings() {
    const next = { ...draft, members: draft.members.map(m => ({ ...m, name: m.name.trim() })) }
    if (persist(next)) { invalidate(); setPanel(null); setNotice(t('设置已保存。请重新生成这餐。', 'Settings saved. Generate a new meal.')) }
  }
  function generate(change = false) {
    const invalid = validate(settings)
    if (invalid) { setError(invalid); return }
    try {
      const nextVariant = change ? variant + 1 : 0
      const nextPlan = planMeal(settings, nextVariant, today())
      invalidate(); setPlan(nextPlan); setVariant(nextVariant); setError(''); setNotice('')
    } catch (e) { setError(e instanceof Error ? e.message : t('暂时无法生成，请检查家庭设置。', 'Unable to plan. Check your settings.')) }
  }
  function updateMember(id: string, changes: Partial<Member>) { setDraft(d => ({ ...d, members: d.members.map(m => m.id === id ? { ...m, ...changes } : m) })) }
  function changeCount(count: number) {
    if (!Number.isInteger(count) || count < 1 || count > 12) return
    setDraft(d => ({ ...d, members: Array.from({ length: count }, (_, i) => d.members[i] ?? { id: uid(), name: `成员 ${i + 1}`, portion: 1, likes: '', avoids: '', allergies: '' }) }))
  }
  function editPantry(index: number, patch: Partial<PantryItem>) { setDraft(d => ({ ...d, pantry: d.pantry.map((p, i) => i === index ? { ...p, ...patch } : p) })) }
  function applyPurchases() {
    if (!plan || purchaseApplied || consumed) return
    const selected = plan.shopping.filter(s => s.toBuy > 0 && purchased.includes(s.ingredientId) && !appliedPurchaseIds.includes(s.ingredientId))
    if (!selected.length) { setError(t('请先勾选实际已购买的食材。', 'Check the ingredients you actually purchased first.')); return }
    // Purchases are new, undated stock; do not merge them into expired batches.
    const pantry = [...settings.pantry, ...selected.map(s => ({ ingredientId: s.ingredientId, quantity: s.toBuy }))]
    if (persist({ ...settings, pantry })) { setAppliedPurchaseIds([...appliedPurchaseIds, ...selected.map(item => item.ingredientId)]); setNotice(t('勾选的食材已加入冰箱，每项只入库一次；剩余食材可继续购买并入库。', 'Checked purchases were added once per ingredient. You can buy and add the remaining items later.')) }
  }
  function finishMeal() {
    if (!plan || consumed) return
    const date = today()
    const pantry = clone(settings.pantry)
    for (const need of plan.shopping) {
      let remaining = need.required
      const batches = pantry.filter(p => p.ingredientId === need.ingredientId && (!p.expiresOn || p.expiresOn >= date)).sort((a, b) => (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999'))
      if (batches.reduce((sum, p) => sum + p.quantity, 0) + 0.00001 < remaining) { setError(`${need.name}：${t('有效库存不足，不能扣减。请核实并购买或修改冰箱后重新生成。', 'not enough unexpired stock; no stock deducted. Verify inventory and replan.')}`); setConfirmConsume(false); return }
      for (const batch of batches) { const used = Math.min(remaining, batch.quantity); batch.quantity -= used; remaining -= used }
    }
    if (persist({ ...settings, pantry: pantry.filter(p => p.quantity > 0.00001) })) { setConsumed(true); setConfirmConsume(false); setNotice(t('本餐用量已从冰箱扣减一次。', 'This meal’s ingredients were deducted once.')) }
  }
  function finishWash() {
    if (!plan || washed || !selectedWasher) return
    if (!cookId) { setError(t('请先选择本餐主厨。', 'Select this meal’s cook first.')); return }
    if (settings.members.length > 1 && selectedWasher.id === cookId) { setError(t('多人家庭请由主厨以外的成员洗碗。', 'Choose someone other than the cook.')); return }
    if (persist(settings, [...history, { id: uid(), date: today(), memberId: selectedWasher.id, cookId }])) { setWasherId(selectedWasher.id); setWashed(true); setNotice(t('洗碗完成已记录，本餐不会重复计数。', 'Dishwashing recorded once for this meal.')) }
  }
  function ingredientAmounts(recipe: MealPlan['recipes'][number]) {
    return recipe.recipe.ingredients.map(item => {
      const ingredient = ingredients.find(i => i.id === item.ingredientId)
      const scaled = item.quantity * recipe.servings / 2
      return <span key={item.ingredientId}>{ingredient?.name ?? item.ingredientId} {qty(ingredient?.unit === '个' ? Math.ceil(scaled) : scaled)}{ingredient?.unit ?? ''}</span>
    })
  }

  return <section className="meal-app" aria-label={t('吃什么 · 家庭用餐助手', 'Meal planner')}>
    <div className="meal-heading"><div><p className="meal-eyebrow">AILY · {t('生活小工具', 'DAILY TOOLS')}</p><h2>{plan ? t('这餐，安排好了', 'A meal, made simple') : t('这餐，吃什么？', 'What shall we eat?')}</h2><p>{t('从吃什么到谁洗碗，一步一步来。', 'From choosing dinner to doing the dishes.')}</p></div><span className="meal-local">{t('仅保存在本机', 'Local only')}</span></div>
    <div className="meal-toolbar"><button type="button" onClick={() => { setDraft(clone(settings)); setPanel('family'); setNotice('') }}>{t('家庭 / 偏好', 'Family / preferences')}</button><button type="button" onClick={() => { setDraft(clone(settings)); setPanel('pantry'); setNotice('') }}>{t('冰箱 / 参考价', 'Pantry / prices')}</button></div>
    {error && <div className="meal-alert meal-error" role="alert">{error}</div>}
    {notice && <div className="meal-alert" role="status">{notice}</div>}
    {panel ? <div className="meal-settings">
      <div className="meal-section-title"><h3>{panel === 'family' ? t('家庭与这餐预算', 'Family & meal budget') : t('冰箱与参考价格', 'Pantry & estimated prices')}</h3><button type="button" onClick={() => setPanel(null)}>{t('取消编辑', 'Cancel')}</button></div>
      <p className="meal-muted">{t('编辑不会自动保存。保存任意设置后，当前菜单和进度会失效。', 'Edits are not saved automatically. Saving settings clears the current plan and progress.')}</p>
      {panel === 'family' ? <>
        <div className="meal-form-grid"><label>{t('家庭人数', 'Members')}<select value={draft.members.length} onChange={e => changeCount(Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label><label>{t('这餐采购预算（元）', 'Shopping budget (CNY)')}<input type="number" min="0" step="0.01" value={Number.isFinite(draft.budget) ? draft.budget : ''} onChange={e => setDraft(d => ({ ...d, budget: e.target.value === '' ? NaN : Number(e.target.value) }))} /></label><label>{t('菜数（另加一道主食）', 'Dishes (plus one staple)')}<select value={draft.dishCount} onChange={e => setDraft(d => ({ ...d, dishCount: Number(e.target.value) }))}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}</select></label></div>
        <label className="meal-check"><input type="checkbox" checked={draft.vegetarian} onChange={e => setDraft(d => ({ ...d, vegetarian: e.target.checked }))} />{t('严格素食：排除肉、鱼和蛋', 'Strict vegetarian: no meat, fish or eggs')}</label>
        {draft.members.map((m, index) => <fieldset className="meal-card" key={m.id}><legend>{t('成员', 'Member')} {index + 1}</legend><div className="meal-form-grid"><label>{t('名字', 'Name')}<input maxLength={40} value={m.name} onChange={e => updateMember(m.id, { name: e.target.value })} /></label><label>{t('食量', 'Portion')}<select value={m.portion} onChange={e => updateMember(m.id, { portion: Number(e.target.value) })}><option value={0.5}>{t('儿童 / 小份 · 0.5', 'Child / small · 0.5')}</option><option value={1}>{t('成人 / 标准 · 1', 'Adult / standard · 1')}</option><option value={1.5}>{t('大食量 · 1.5', 'Large · 1.5')}</option></select></label></div>{(['likes', 'avoids', 'allergies'] as const).map((key, i) => <label key={key}>{[t('喜欢', 'Likes'), t('忌口 / 不吃', 'Avoids'), t('过敏食材', 'Allergies')][i]}<input maxLength={1000} value={m[key]} onChange={e => updateMember(m.id, { [key]: e.target.value })} placeholder={t('食材名称，逗号分隔', 'Ingredient names, comma separated')} /></label>)}</fieldset>)}
        <p className="meal-muted">{t('过敏筛选仅匹配菜谱记录的食材，不能识别交叉污染或所有别名。严重过敏请自行核验原料、标签及做法。', 'Allergy filtering uses recorded ingredients, not cross-contamination or every alias. Verify labels and preparation for serious allergies.')}</p>
      </> : <>
        <p className="meal-muted">{t('数量单位固定；日期为本地到期日，过期库存不抵扣购物清单。无日期库存按可用处理，请自行核实。', 'Units are fixed. Expired stock is excluded; undated stock is treated as available—verify it yourself.')}</p>
        {draft.pantry.map((p, index) => { const ingredient = ingredients.find(i => i.id === p.ingredientId)!; return <div className="meal-card meal-pantry-row" key={`${p.ingredientId}-${index}`}><strong>{ingredient.name}</strong><label>{t('数量', 'Quantity')}（{ingredient.unit}）<input type="number" min="0" step="1" value={Number.isFinite(p.quantity) ? p.quantity : ''} onChange={e => editPantry(index, { quantity: e.target.value === '' ? NaN : Number(e.target.value) })} /></label><label>{t('到期日期（可选）', 'Expiry (optional)')}<input type="date" value={p.expiresOn ?? ''} onChange={e => editPantry(index, { expiresOn: e.target.value || undefined })} /></label><button type="button" onClick={() => setDraft(d => ({ ...d, pantry: d.pantry.filter((_, i) => i !== index) }))}>{t('移除此项', 'Remove item')}</button></div> })}
        <div className="meal-add-row"><label>{t('选择食材', 'Ingredient')}<select value={newIngredient} onChange={e => setNewIngredient(e.target.value)}>{ingredients.map(i => <option key={i.id} value={i.id}>{i.name}（{i.unit}）</option>)}</select></label><button type="button" onClick={() => setDraft(d => ({ ...d, pantry: [...d.pantry, { ingredientId: newIngredient, quantity: 0 }] }))}>{t('添加库存', 'Add stock')}</button></div>
        <h4>{t('编辑估算单价', 'Edit estimated unit prices')}</h4><p className="meal-muted">{t('按重量计价的食材：元 / 500g；计件食材：元 / 1 个（鸡蛋为 1 枚）。留空使用内置参考价。并非实时菜价。', 'Gram ingredients: CNY / 500g. Counted items: CNY / 1 item (one egg). Blank uses the catalog estimate. These are not live prices.')}</p>
        <div className="meal-price-grid">{ingredients.map(i => <label key={i.id}>{i.name} · {i.unit === 'g' ? t('元 / 500g', 'CNY / 500g') : t('元 / 1 个', 'CNY / item')}<input type="number" min="0" step="0.01" value={i.id in draft.prices ? Number.isFinite(draft.prices[i.id]) ? qty(draft.prices[i.id] * (i.unit === 'g' ? 500 : 1)) : '' : ''} placeholder={qty(i.pricePerUnit * (i.unit === 'g' ? 500 : 1))} onChange={e => setDraft(d => { const prices = { ...d.prices }; if (e.target.value === '') delete prices[i.id]; else prices[i.id] = Number(e.target.value) / (i.unit === 'g' ? 500 : 1); return { ...d, prices } })} /></label>)}</div>
      </>}
      <button className="meal-primary meal-save" type="button" onClick={saveSettings}>{t('保存设置', 'Save settings')}</button>
    </div> : <>
      <nav className="meal-tabs" aria-label={t('用餐步骤', 'Meal steps')}>{tabs.map((label, i) => <button key={label} type="button" aria-current={step === i ? 'step' : undefined} className={step === i ? 'active' : ''} onClick={() => setStep(i)}><span>{i + 1}</span>{label}</button>)}</nav>
      {step === 0 && <><div className="meal-card meal-summary"><div><strong>{settings.members.map(m => m.name).join('、')}</strong><p>{t('合计', 'Total')} {qty(settings.members.reduce((n, m) => n + m.portion, 0))} {t('标准份', 'standard portions')} · {settings.dishCount} {t('道菜 + 主食', 'dishes + staple')} · {t('预算', 'Budget')} {money(settings.budget)}{settings.vegetarian ? ` · ${t('严格素食', 'Strict vegetarian')}` : ''}</p></div><div className="meal-actions"><button type="button" className="meal-primary" onClick={() => generate()}>{t('生成这餐', 'Generate meal')}</button>{plan && <button type="button" onClick={() => generate(true)}>{t('换一套', 'Try another')}</button>}</div></div>{plan && <><div className="meal-budget"><strong>{t('还需采购约', 'Estimated purchases')} {money(plan.purchaseEstimate)}</strong><span>{t('食材总参考价', 'Total ingredient estimate')} {money(plan.originalEstimate)} · {plan.fitsBudget ? t('预算内', 'Within budget') : t('超出预算，请调整', 'Over budget—adjust settings')}</span></div>{plan.recipes.map(r => <article className="meal-card" key={r.recipe.id}><div className="meal-section-title"><h3>{r.recipe.title}</h3><span className="meal-tag">{r.recipe.minutes} {t('分钟', 'min')} · {qty(r.servings)} {t('份', 'portions')}</span></div><div className="meal-amounts">{ingredientAmounts(r)}</div><p className="meal-muted">{r.recipe.tags.join(' · ')}</p></article>)}</> }</>}
      {step > 0 && !plan && <div className="meal-empty"><span>🍽️</span><h3>{t('先安排这一餐', 'Plan this meal first')}</h3><p>{t('生成菜单后，购物、备菜、做菜和洗碗会使用同一份计划。', 'All five steps share one coherent meal plan.')}</p><button className="meal-primary" type="button" onClick={() => setStep(0)}>{t('去吃什么', 'Go to Plan')}</button></div>}
      {plan && plan.warnings.length > 0 && <details className="meal-alert" open={!plan.fitsBudget || plan.warnings.some(w => w.includes('已过期'))}><summary>{t('价格与食材提示', 'Prices & ingredient notes')} · {plan.warnings.length}</summary>{plan.warnings.map((w, i) => <p key={i}>{w}</p>)}</details>}
      {plan && step === 1 && <><div className="meal-budget"><strong>{t('采购估算', 'Purchase estimate')} {money(plan.purchaseEstimate)} / {t('预算', 'budget')} {money(settings.budget)}</strong><span>{t('按用量估算，非实时菜价；整包购买、损耗和地区差价可能使实际支出更高，请以商家价格为准。清单为生成时的库存快照；食材按 5g 取整、调料按 1g 取整，鸡蛋按完整个数计算。', 'Usage-based estimates, not live prices; package sizes, waste and local prices may increase the actual bill. Stock is a snapshot at generation. Food rounds to 5g, seasonings to 1g, eggs to whole units.')}</span></div>{plan.shopping.filter(s => s.toBuy > 0).map(s => <label className="meal-card meal-shopping-item" key={s.ingredientId}><input type="checkbox" disabled={appliedPurchaseIds.includes(s.ingredientId) || consumed} checked={purchased.includes(s.ingredientId)} onChange={() => setPurchased(toggle(purchased, s.ingredientId))} /><div><strong>{s.name} · {appliedPurchaseIds.includes(s.ingredientId) ? t('已入库', 'Added to pantry') : t('缺', 'Missing')} {qty(s.toBuy)}{s.unit}</strong><p>{t('需要', 'Required')} {qty(s.required)}{s.unit} · {t('已有', 'Existing')} {qty(s.available)}{s.unit}</p></div><strong>{money(s.estimatedCost)}</strong></label>)}{!plan.shopping.some(s => s.toBuy > 0) && <p className="meal-card">{t('冰箱食材已够本餐，无需购买。', 'You have enough ingredients; no shopping needed.')}</p>}<details className="meal-card"><summary>{t('查看全部用量与已有库存', 'All required ingredients & stock')}</summary>{plan.shopping.map(s => <p key={s.ingredientId}>{s.name}：{t('需要', 'required')} {qty(s.required)}{s.unit} / {t('已有', 'existing')} {qty(s.available)}{s.unit} / {t('缺少', 'missing')} {qty(s.toBuy)}{s.unit} · {money(s.estimatedCost)}</p>)}</details><button type="button" className="meal-primary" disabled={purchaseApplied || consumed || !purchased.some(id => !appliedPurchaseIds.includes(id))} onClick={applyPurchases}>{purchaseApplied ? t('本餐采购已全部入库', 'All purchases added') : t('已买好，更新冰箱', 'Purchased—update pantry')}</button><p className="meal-muted">{t('只加入勾选且确实购买的缺少数量。勾选本身不会改库存；用餐不会自动扣库存。', 'Only checked missing amounts are added. Checking alone never changes stock; cooking never silently consumes it.')}</p></>}
      {plan && step === 2 && <><h3>{t('先集中备菜，少走回头路', 'Prep together, work efficiently')}</h3><div className="meal-card">{plan.prepSteps.map((s, i) => <label className="meal-check" key={i}><input type="checkbox" checked={prepared.includes(`global-${i}`)} onChange={() => setPrepared(toggle(prepared, `global-${i}`))} /><span>{i + 1}. {s}</span></label>)}</div>{plan.recipes.map(r => <details className="meal-card" key={r.recipe.id}><summary>{r.recipe.title} · {t('备菜细节', 'Prep details')}</summary><div className="meal-amounts">{ingredientAmounts(r)}</div>{r.recipe.prep.map((s, i) => <label className="meal-check" key={i}><input type="checkbox" checked={prepared.includes(`${r.recipe.id}-${i}`)} onChange={() => setPrepared(toggle(prepared, `${r.recipe.id}-${i}`))} /><span>{s}</span></label>)}</details>)}</>}
      {plan && step === 3 && <><p className="meal-muted">{t('步骤与时间只是指引。请以真实熟度为准，不把计时或勾选当作食品安全判定。', 'Steps and times are guidance. Verify actual doneness; timers and checks cannot establish food safety.')}</p>{plan.recipes.map(r => <article className="meal-card" key={r.recipe.id}><div className="meal-section-title"><h3>{r.recipe.title}</h3><span>{r.recipe.minutes} {t('分钟', 'min')}</span></div><div className="meal-amounts">{ingredientAmounts(r)}</div><ol className="meal-cook-steps">{r.recipe.steps.map((s, i) => <li key={i}><label className="meal-check"><input type="checkbox" checked={cooked.includes(`${r.recipe.id}-${i}`)} onChange={() => setCooked(toggle(cooked, `${r.recipe.id}-${i}`))} /><span>{s}</span></label></li>)}</ol>{r.recipe.safety && <p className="meal-safety">{r.recipe.safety}</p>}</article>)}<div className="meal-card"><h4>{t('本餐结束后，手动扣减库存', 'After eating, deduct stock explicitly')}</h4><p className="meal-muted">{t('不会自动扣减。确认后按购物清单中的总需求（含向上取整）扣减一次；有效库存不足则整次不扣。', 'Never automatic. Confirmation deducts total shopping-list requirements (including rounding) once, only if all unexpired stock is sufficient.')}</p>{confirmConsume ? <div className="meal-actions"><button type="button" className="meal-primary" onClick={finishMeal}>{t('确认已使用这些食材', 'Confirm ingredients used')}</button><button type="button" onClick={() => setConfirmConsume(false)}>{t('取消', 'Cancel')}</button></div> : <button type="button" disabled={consumed} onClick={() => setConfirmConsume(true)}>{consumed ? t('本餐已扣减库存', 'Stock deducted') : t('这餐已完成', 'Meal completed')}</button>}</div></>}
      {plan && step === 4 && <><div className="meal-card"><h3>{t('一起吃饭，也一起分担', 'Share the meal, share the work')}</h3><label>{t('本餐主厨', 'This meal’s cook')}<select disabled={washed} value={cookId} onChange={e => { setCookId(e.target.value); setWasherId('') }}><option value="">{t('请选择主厨', 'Select cook')}</option>{settings.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><p className="meal-muted">{t('推荐历史完成次数最少的成员；多人时排除主厨，同次数优先更久未洗碗者，再按家庭顺序。只记录明确完成，不代表所有家务贡献。', 'Recommends the least-recorded member, excluding the cook for multiple members. Ties favor those who washed less recently, then family order. Records are not total household contributions.')}</p>{selectedWasher && <div className="meal-washer"><span>🫧</span><strong>{selectedWasher.name}</strong><p>{t('本餐洗碗人选', 'Dishwasher for this meal')}</p></div>}<label>{t('也可以手动选择', 'Or choose manually')}<select disabled={washed || !cookId} value={washerId} onChange={e => setWasherId(e.target.value)}><option value="">{t('使用推荐人选', 'Use recommendation')}</option>{eligible.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><button className="meal-primary meal-save" type="button" disabled={washed || !cookId || !selectedWasher} onClick={finishWash}>{washed ? t('本餐洗碗已记录', 'Recorded for this meal') : t('洗碗完成', 'Dishes done')}</button></div><div className="meal-card"><h4>{t('本机洗碗记录 · 只读统计', 'Local history · read-only summary')}</h4>{settings.members.map(m => <div className="meal-history-row" key={m.id}><span>{m.name}</span><strong>{history.filter(h => h.memberId === m.id).length} {t('次', 'times')}</strong></div>)}<p className="meal-muted">{t('仅统计本机明确完成记录。名字修改不影响同一成员的计数。', 'Only explicit local completions count. Renaming a member keeps their count.')}</p></div></>}
      {plan && <div className="meal-step-footer">{step > 0 && <button type="button" onClick={() => setStep(step - 1)}>{t('上一步', 'Back')}</button>}{step < 4 && <button className="meal-primary" type="button" onClick={() => setStep(step + 1)}>{t('下一步', 'Next')} · {tabs[step + 1]}</button>}</div>}
    </>}
    <p className="meal-footnote">{t('无需联网、订阅或 AI 模型。偏好、冰箱和洗碗记录仅保存在当前设备浏览器；清除浏览器数据会丢失。', 'No network, subscription or AI model. Preferences, pantry and dishwashing history stay in this browser; clearing its data removes them.')}</p>
  </section>
}
