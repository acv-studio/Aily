/** Offline reference prices only: RMB per gram or per egg, not live quotes.
 * Quantities in the catalog are for TWO standard servings. No nutrition or
 * exhaustive allergen-safety guarantee; check packaging and cross-contact.
 */
export interface Ingredient { id: string; name: string; unit: 'g' | '个'; pricePerUnit: number }
export interface Member { id: string; name: string; portion: number; likes: string; avoids: string; allergies: string }
export interface PantryItem { ingredientId: string; quantity: number; expiresOn?: string }
export interface MealSettings { members: Member[]; budget: number; dishCount: number; vegetarian: boolean; pantry: PantryItem[]; prices: Record<string, number> }
export interface Recipe { id: string; title: string; category: 'meat' | 'veg' | 'staple' | 'soup'; ingredients: { ingredientId: string; quantity: number }[]; prep: string[]; steps: string[]; minutes: number; tags: string[]; safety?: string }
export interface PlannedRecipe { recipe: Recipe; servings: number }
export interface ShoppingItem { ingredientId: string; name: string; unit: 'g' | '个'; required: number; available: number; toBuy: number; estimatedCost: number }
export interface MealPlan { id: string; recipes: PlannedRecipe[]; servingUnits: number; shopping: ShoppingItem[]; purchaseEstimate: number; originalEstimate: number; fitsBudget: boolean; warnings: string[]; prepSteps: string[] }
export interface WashRecord { id: string; date: string; memberId: string; cookId?: string }

export const ingredients: Ingredient[] = [
  { id: 'rice', name: '大米', unit: 'g', pricePerUnit: 0.006 },
  { id: 'noodles', name: '小麦面条', unit: 'g', pricePerUnit: 0.012 },
  { id: 'potato', name: '土豆', unit: 'g', pricePerUnit: 0.005 },
  { id: 'tomato', name: '番茄', unit: 'g', pricePerUnit: 0.008 },
  { id: 'egg', name: '鸡蛋', unit: '个', pricePerUnit: 1.2 },
  { id: 'pork', name: '猪肉', unit: 'g', pricePerUnit: 0.035 },
  { id: 'chicken', name: '鸡肉', unit: 'g', pricePerUnit: 0.025 },
  { id: 'shrimp', name: '虾仁', unit: 'g', pricePerUnit: 0.06 },
  { id: 'tofu', name: '豆腐', unit: 'g', pricePerUnit: 0.009 },
  { id: 'cabbage', name: '白菜', unit: 'g', pricePerUnit: 0.004 },
  { id: 'bok-choy', name: '青菜', unit: 'g', pricePerUnit: 0.006 },
  { id: 'cucumber', name: '黄瓜', unit: 'g', pricePerUnit: 0.006 },
  { id: 'carrot', name: '胡萝卜', unit: 'g', pricePerUnit: 0.005 },
  { id: 'broccoli', name: '西兰花', unit: 'g', pricePerUnit: 0.012 },
  { id: 'mushroom', name: '香菇', unit: 'g', pricePerUnit: 0.018 },
  { id: 'garlic', name: '大蒜', unit: 'g', pricePerUnit: 0.015 },
  { id: 'ginger', name: '生姜', unit: 'g', pricePerUnit: 0.012 },
  { id: 'oil', name: '菜籽油', unit: 'g', pricePerUnit: 0.015 },
  { id: 'salt', name: '盐', unit: 'g', pricePerUnit: 0.003 },
  { id: 'soy-sauce', name: '生抽（含大豆、小麦）', unit: 'g', pricePerUnit: 0.012 },
]
const parts = (...entries: [string, number][]): Recipe['ingredients'] => entries.map(([ingredientId, quantity]) => ({ ingredientId, quantity }))
export const recipes: Recipe[] = [
  { id: 'rice', title: '电饭煲米饭', category: 'staple', ingredients: parts(['rice', 160]), prep: ['主食：淘米，加水，先启动电饭煲。'], steps: ['按电饭煲刻度加水，运行煮饭程序；完成后焖 10 分钟再盛出。'], minutes: 35, tags: ['纯植物', '主食'] },
  { id: 'noodles', title: '清汤面', category: 'staple', ingredients: parts(['noodles', 180], ['salt', 2]), prep: ['主食：准备面条，烧一锅水。'], steps: ['水开后下入面条，按包装建议煮至熟透，少量盐调味。'], minutes: 12, tags: ['纯植物', '主食', '小麦'] },
  { id: 'steamed-potato', title: '蒸土豆', category: 'staple', ingredients: parts(['potato', 400]), prep: ['主食：土豆洗净切块，准备蒸锅。'], steps: ['水开后上锅蒸约 20 分钟，筷子能轻松穿透后取出。'], minutes: 25, tags: ['纯植物', '主食'] },
  { id: 'tomato-eggs', title: '番茄炒蛋', category: 'veg', ingredients: parts(['tomato', 300], ['egg', 3], ['oil', 10], ['salt', 2]), prep: ['蔬菜：洗净番茄切块。', '生蛋：鸡蛋打入专用碗，打散后洗手。'], steps: ['热锅加油，蛋液炒至完全凝固盛出。', '番茄炒软出汁，加入熟鸡蛋和盐翻炒至热透。'], minutes: 12, tags: ['家常', '鸡蛋'], safety: '鸡蛋须完全凝固；接触蛋壳后洗手，勿让生蛋接触即食食品。' },
  { id: 'pork-cabbage', title: '白菜炒肉片', category: 'meat', ingredients: parts(['pork', 180], ['cabbage', 300], ['ginger', 10], ['oil', 10], ['soy-sauce', 10]), prep: ['蔬菜：白菜洗净切段，姜切片。', '生肉：用专用砧板切猪肉片。'], steps: ['热锅加油，姜片和猪肉翻炒至肉片熟透。', '加入白菜和生抽，炒至菜软、肉片彻底熟透再出锅。'], minutes: 18, tags: ['家常', '猪肉'], safety: '猪肉中心至少 75°C；不要只凭颜色判断熟度，生熟分开。' },
  { id: 'chicken-potato', title: '土豆炖鸡', category: 'meat', ingredients: parts(['chicken', 250], ['potato', 250], ['carrot', 100], ['ginger', 10], ['oil', 10], ['salt', 2]), prep: ['蔬菜：土豆、胡萝卜洗净切块，姜切片。', '生肉：用专用砧板处理鸡肉，不冲洗生鸡肉以免飞溅。'], steps: ['炒香姜片，加入鸡肉翻炒，加水烧开。', '加土豆和胡萝卜，盖锅小火炖约 25 分钟；确保鸡肉彻底熟透、中心至少 75°C，土豆软熟再调味。'], minutes: 40, tags: ['家常', '鸡肉', '炖煮'], safety: '鸡肉中心至少 75°C；生鸡肉工具单独清洗消毒，炖煮时间以实际熟度为准。' },
  { id: 'shrimp-broccoli', title: '西兰花炒虾仁', category: 'meat', ingredients: parts(['shrimp', 180], ['broccoli', 250], ['garlic', 10], ['oil', 10], ['salt', 2]), prep: ['蔬菜：西兰花洗净切小朵，蒜切末。', '生肉：用专用工具处理虾仁，随后洗手。'], steps: ['西兰花在沸水中焯至熟，沥水。', '加油炒香蒜末，下虾仁炒至彻底熟透，再加入西兰花炒匀调味。'], minutes: 18, tags: ['虾', '海鲜'], safety: '虾仁中心至少 75°C、肉质不透明；海鲜过敏者不可食用。' },
  { id: 'garlic-greens', title: '蒜蓉青菜', category: 'veg', ingredients: parts(['bok-choy', 350], ['garlic', 10], ['oil', 10], ['salt', 2]), prep: ['蔬菜：青菜逐叶洗净，蒜切末。'], steps: ['热锅加油炒香蒜末，加入青菜炒至熟软，盐调味。'], minutes: 8, tags: ['纯植物', '清淡'] },
  { id: 'potato-carrot', title: '土豆胡萝卜丝', category: 'veg', ingredients: parts(['potato', 250], ['carrot', 100], ['oil', 10], ['salt', 2]), prep: ['蔬菜：土豆、胡萝卜洗净切丝，土豆丝漂洗沥干。'], steps: ['热锅加油，下土豆丝和胡萝卜丝翻炒，加少量水炒至熟透，盐调味。'], minutes: 15, tags: ['纯植物', '家常'] },
  { id: 'cucumber', title: '蒜香拍黄瓜', category: 'veg', ingredients: parts(['cucumber', 300], ['garlic', 10], ['salt', 2]), prep: ['蔬菜：黄瓜用流动清水洗净，使用干净的即食专用刀板拍切，蒜切末。'], steps: ['用干净容器将黄瓜、蒜末和盐拌匀，即做即食。'], minutes: 8, tags: ['纯植物', '凉菜'], safety: '凉菜使用即食专用工具；免疫力较弱者可改选熟菜，勿与生肉交叉污染。' },
  { id: 'mushroom-tofu', title: '香菇烧豆腐', category: 'veg', ingredients: parts(['mushroom', 150], ['tofu', 300], ['oil', 10], ['soy-sauce', 10]), prep: ['蔬菜：香菇洗净切片，豆腐切块。'], steps: ['热锅加油炒香菇，加豆腐、生抽和少量水。', '小火煮约 8 分钟，确保香菇和豆腐热透。'], minutes: 18, tags: ['纯植物', '大豆'] },
  { id: 'broccoli-carrot', title: '清炒西兰花胡萝卜', category: 'veg', ingredients: parts(['broccoli', 250], ['carrot', 100], ['oil', 10], ['salt', 2]), prep: ['蔬菜：西兰花洗净切小朵，胡萝卜切片。'], steps: ['西兰花和胡萝卜沸水焯熟，沥水。', '热锅加油，蔬菜翻炒至热透，加盐调味。'], minutes: 12, tags: ['纯植物', '清淡'] },
  { id: 'cabbage', title: '清炒白菜', category: 'veg', ingredients: parts(['cabbage', 350], ['oil', 10], ['salt', 2]), prep: ['蔬菜：白菜逐叶洗净，菜帮与菜叶分开切。'], steps: ['热锅加油先炒菜帮，再下菜叶，炒至熟软后加盐。'], minutes: 10, tags: ['纯植物', '家常'] },
  { id: 'tomato-tofu-soup', title: '番茄豆腐汤', category: 'soup', ingredients: parts(['tomato', 200], ['tofu', 200], ['salt', 2]), prep: ['蔬菜：番茄洗净切块，豆腐切块。'], steps: ['番茄加水煮开，下豆腐，小火煮约 8 分钟至热透，加盐。'], minutes: 15, tags: ['纯植物', '汤', '大豆'] },
  { id: 'cabbage-mushroom-soup', title: '白菜香菇汤', category: 'soup', ingredients: parts(['cabbage', 200], ['mushroom', 100], ['salt', 2]), prep: ['蔬菜：白菜、香菇洗净切片。'], steps: ['香菇加水煮开煮约 8 分钟，放入白菜煮熟，加盐。'], minutes: 15, tags: ['纯植物', '汤'] },
]

export const defaultSettings: MealSettings = {
  members: [
    { id: 'member-1', name: '我', portion: 1, likes: '', avoids: '', allergies: '' },
    { id: 'member-2', name: '一起吃饭的人', portion: 1, likes: '', avoids: '', allergies: '' },
  ], budget: 40, dishCount: 3, vegetarian: false, pantry: [], prices: {},
}
const catalog = new Map(ingredients.map(item => [item.id, item]))
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const tokens = (s: string) => s.toLowerCase().split(/[\s,，、;；/|。]+/u).map(t => t.trim()).filter(Boolean)
// Conservative common aliases, not an exhaustive allergen database.
const aliasGroups = [
  ['花生', '花生油', 'peanut'], ['豆', '大豆', '黄豆', '豆腐', '豆浆', '生抽', '酱油', 'soy', 'soybean'],
  ['蛋', '鸡蛋', '蛋清', '蛋黄', 'egg'], ['虾', '虾仁', '虾米', 'shrimp', '甲壳类'],
  ['鱼', '鱼肉', '鱼露', 'fish'], ['小麦', '面粉', '面条', '麸质', 'wheat', 'gluten'],
  ['牛奶', '奶', '乳', '乳制品', '奶酪', '黄油', 'milk', 'dairy'],
]
function matches(token: string, recipe: Recipe): boolean {
  const haystack = [recipe.title, ...recipe.tags, ...recipe.ingredients.map(i => `${i.ingredientId} ${catalog.get(i.ingredientId)?.name ?? ''}`)].join(' ').toLowerCase()
  const aliases = aliasGroups.find(group => group.includes(token))
  return haystack.includes(token) || Boolean(aliases?.some(alias => alias !== '豆' && haystack.includes(alias))) ||
    (['海鲜', '海产品', 'seafood'].includes(token) && recipe.ingredients.some(i => ['shrimp', 'fish'].includes(i.ingredientId)))
}
function safe(recipe: Recipe, settings: MealSettings): boolean {
  if (settings.vegetarian && (recipe.category === 'meat' || recipe.ingredients.some(i => ['egg', 'pork', 'chicken', 'shrimp', 'fish', 'milk'].includes(i.ingredientId)))) return false
  return settings.members.every(member => !tokens(member.avoids).some(t => matches(t, recipe)) && !tokens(member.allergies).some(t => matches(t, recipe)))
}
function numeric(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label}须为 ${min}–${max} 之间的有效数字。`)
}
function dateOnly(value?: string): string {
  if (value === undefined) {
    const now = new Date()
    value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error('日期须为真实有效的 YYYY-MM-DD 日期。')
  return value
}
function validate(settings: MealSettings): number {
  if (!settings || !Array.isArray(settings.members) || settings.members.length < 1 || settings.members.length > 20) throw new Error('请设置 1–20 位用餐成员。')
  const ids = new Set<string>()
  for (const member of settings.members) {
    if (!member || typeof member.id !== 'string' || !member.id.trim() || ids.has(member.id) || typeof member.name !== 'string' || !member.name.trim()) throw new Error('成员需要唯一编号和姓名。')
    ids.add(member.id)
    numeric(member.portion, 0.25, 5, '成员食量')
    for (const value of [member.likes, member.avoids, member.allergies]) if (typeof value !== 'string' || value.length > 1000) throw new Error('喜好、忌口和过敏信息须为不超过 1000 字的文本。')
  }
  numeric(settings.budget, 0, 100000, '预算')
  numeric(settings.dishCount, 1, 4, '菜数')
  if (!Number.isInteger(settings.dishCount)) throw new Error('菜数须为 1–4 的整数（另加主食）。')
  if (typeof settings.vegetarian !== 'boolean') throw new Error('纯素选项须为布尔值。')
  if (!Array.isArray(settings.pantry) || settings.pantry.length > 1000) throw new Error('库存须为有效列表（最多 1000 条）。')
  for (const item of settings.pantry) {
    if (!item || !catalog.has(item.ingredientId)) throw new Error('库存包含未知食材，请重新选择。')
    numeric(item.quantity, 0, 1000000, '库存数量')
    if (catalog.get(item.ingredientId)?.unit === '个' && !Number.isInteger(item.quantity)) throw new Error('鸡蛋库存须按整数个填写。')
    if (item.expiresOn !== undefined) dateOnly(item.expiresOn)
  }
  if (!settings.prices || typeof settings.prices !== 'object' || Array.isArray(settings.prices)) throw new Error('食材单价须为有效价格表。')
  for (const [id, value] of Object.entries(settings.prices)) {
    if (!catalog.has(id)) throw new Error('价格表包含未知食材，请重新选择。')
    numeric(value, 0, 100000, '食材单价')
  }
  return settings.members.reduce((total, member) => total + member.portion, 0)
}
function validateSelected(selected: Recipe[], settings: MealSettings): void {
  if (!Array.isArray(selected) || selected.length > 20) throw new Error('请选择有效菜谱列表。')
  for (const recipe of selected) {
    if (!recipe || typeof recipe.title !== 'string' || !Array.isArray(recipe.ingredients) || !recipe.ingredients.length) throw new Error('菜谱格式无效。')
    for (const item of recipe.ingredients) {
      if (!catalog.has(item.ingredientId)) throw new Error('菜谱包含未知食材。')
      numeric(item.quantity, 0.001, 1000000, '菜谱食材数量')
    }
    if (!safe(recipe, settings)) throw new Error(`「${recipe.title}」不符合当前忌口、过敏或纯素限制，请换一道安全菜谱。`)
  }
}
function shoppingFor(selected: Recipe[], settings: MealSettings, today: string, portions: number): ShoppingItem[] {
  const required = new Map<string, number>()
  for (const recipe of selected) for (const item of recipe.ingredients) required.set(item.ingredientId, (required.get(item.ingredientId) ?? 0) + item.quantity * portions / 2)
  const stock = new Map<string, number>()
  for (const item of settings.pantry) if (!item.expiresOn || item.expiresOn >= today) stock.set(item.ingredientId, (stock.get(item.ingredientId) ?? 0) + item.quantity)
  return [...required].map(([ingredientId, amount]) => {
    const ingredient = catalog.get(ingredientId)!
    // Merge before rounding: whole eggs, 5 g produce/meat, 1 g seasonings
    // to avoid inflating small salt/oil portions for a small household.
    const increment = ['salt', 'oil', 'soy-sauce', 'garlic', 'ginger'].includes(ingredientId) ? 1 : 5
    const required = ingredient.unit === '个' ? Math.ceil(amount) : Math.ceil(amount / increment) * increment
    const available = stock.get(ingredientId) ?? 0
    const toBuy = Math.max(0, Math.round((required - available) * 1000000) / 1000000)
    return { ingredientId, name: ingredient.name, unit: ingredient.unit, required, available, toBuy, estimatedCost: money(toBuy * (settings.prices[ingredientId] ?? ingredient.pricePerUnit)) }
  }).sort((a, b) => a.ingredientId.localeCompare(b.ingredientId))
}
export function getShoppingList(selected: Recipe[], settings: MealSettings, today?: string): ShoppingItem[] {
  const portions = validate(settings)
  validateSelected(selected, settings)
  return shoppingFor(selected, settings, dateOnly(today), portions)
}
export function getPrepSteps(selected: Recipe[]): string[] {
  const result = ['先洗手，清洁台面；准备生熟分开的刀、砧板和容器。']
  const staples = selected.filter(r => r.category === 'staple').sort((a, b) => b.minutes - a.minutes)
  for (const recipe of staples) result.push(...recipe.prep)
  result.push('先洗净并切好所有蔬菜；凉菜用即食专用工具先做好并加盖，之后再接触生肉或生蛋。')
  for (const recipe of selected.filter(r => r.category !== 'staple')) result.push(...recipe.prep.filter(p => !p.startsWith('生肉：') && !p.startsWith('生蛋：')))
  for (const recipe of selected) result.push(...recipe.prep.filter(p => p.startsWith('生肉：') || p.startsWith('生蛋：')))
  if (selected.some(r => r.category === 'meat' || r.ingredients.some(i => i.ingredientId === 'egg'))) result.push('处理生肉、生虾或生蛋后立刻洗手，清洗消毒刀板；生肉不冲洗，生熟工具不可混用。')
  for (const recipe of selected.filter(r => r.tags.includes('炖煮') || r.category === 'soup').sort((a, b) => b.minutes - a.minutes)) result.push(`先开始「${recipe.title}」；有空余灶眼时，在炖煮等待中并行炒蔬菜；只有一个灶眼就顺序完成。注意火候，不离开开火的厨房。`)
  result.push('米饭或蒸煮等待期间完成快手菜；生肉彻底熟透（中心至少 75°C），鸡蛋完全凝固，熟食用干净餐具盛放。')
  return [...new Set(result)]
}
function combinations<T>(items: T[], count: number): T[][] {
  const result: T[][] = []
  function visit(start: number, chosen: T[]) {
    if (chosen.length === count) { result.push(chosen); return }
    for (let i = start; i <= items.length - (count - chosen.length); i++) visit(i + 1, [...chosen, items[i]])
  }
  visit(0, [])
  return result
}
export function planMeal(settings: MealSettings, variant = 0, today?: string): MealPlan {
  const servingUnits = validate(settings)
  numeric(variant, 0, Number.MAX_SAFE_INTEGER, '换一组编号')
  if (!Number.isSafeInteger(variant)) throw new Error('换一组编号须为非负整数。')
  const day = dateOnly(today)
  const eligible = recipes.filter(recipe => safe(recipe, settings))
  const staples = eligible.filter(recipe => recipe.category === 'staple')
  if (!staples.length) throw new Error('当前忌口或过敏限制下没有可用主食，请补充确认安全的主食菜谱；不会自动放宽限制。')
  const mains = eligible.filter(recipe => recipe.category !== 'staple')
  if (mains.length < settings.dishCount) throw new Error(`当前限制下只有 ${mains.length} 道可用菜，无法安排 ${settings.dishCount} 道；请减少菜数或补充安全菜谱，不会自动放宽忌口。`)
  const candidates = staples.flatMap(staple => combinations(mains, settings.dishCount).map(mainRecipes => {
    const selected = [staple, ...mainRecipes]
    const shopping = shoppingFor(selected, settings, day, servingUnits)
    const cost = money(shopping.reduce((sum, item) => sum + item.estimatedCost, 0))
    const likes = mainRecipes.reduce((sum, recipe) => sum + settings.members.reduce((score, member) => score + tokens(member.likes).filter(t => matches(t, recipe)).length, 0), 0)
    const balanced = mainRecipes.some(r => r.category === 'meat') && mainRecipes.some(r => r.category === 'veg')
    return { selected, shopping, cost, likes, balanced, key: selected.map(r => r.id).join('-') }
  }))
  const affordable = candidates.filter(c => c.cost <= settings.budget)
  const balanced = affordable.filter(c => c.balanced)
  // Never require balance at the expense of a feasible budget or hard restriction.
  const pool = !settings.vegetarian && balanced.length ? balanced : affordable.length ? affordable : candidates
  // Preferences rank only already-affordable safe menus; purchase cost breaks
  // equal preference scores. An impossible budget still means absolute cheapest.
  pool.sort((a, b) => (affordable.length ? b.likes - a.likes || a.cost - b.cost : a.cost - b.cost || b.likes - a.likes) || a.key.localeCompare(b.key))
  // With an impossible budget always return the cheapest safe plan, not a costlier variant.
  const chosen = pool[affordable.length ? variant % pool.length : 0]
  const fitsBudget = chosen.cost <= settings.budget
  const warnings = ['价格为离线人民币估算（克或个），仅供参考，不是实时售价；未承诺营养达标。', '过敏筛选仅覆盖菜谱食材与常见别名，不能保证穷尽过敏原；请核对包装、调料和交叉接触风险。']
  for (const item of settings.pantry) if (item.quantity > 0 && item.expiresOn && item.expiresOn < day) warnings.push(`「${catalog.get(item.ingredientId)!.name}」库存 ${item.quantity}${catalog.get(item.ingredientId)!.unit} 已过期（${item.expiresOn}），未计入可用库存，请勿食用。`)
  if (!fitsBudget) warnings.push(`安全菜单的最低采购估算为 ¥${chosen.cost.toFixed(2)}，超出预算 ¥${money(chosen.cost - settings.budget).toFixed(2)}；请调整预算或增加可用库存。`)
  if (!settings.vegetarian && !chosen.balanced) warnings.push('当前菜数、限制或预算下未安排荤素各一道；没有放宽任何忌口或过敏限制。')
  if (settings.vegetarian) warnings.push('严格纯素：此菜单不含肉、鱼、虾、蛋或奶；调料仍须核对包装。')
  const originalEstimate = money(chosen.shopping.reduce((sum, item) => sum + money(item.required * (settings.prices[item.ingredientId] ?? catalog.get(item.ingredientId)!.pricePerUnit)), 0))
  return { id: `meal-${day}-${servingUnits}-${chosen.key}`, recipes: chosen.selected.map(recipe => ({ recipe, servings: servingUnits })), servingUnits, shopping: chosen.shopping, purchaseEstimate: chosen.cost, originalEstimate, fitsBudget, warnings, prepSteps: getPrepSteps(chosen.selected) }
}
export function chooseWasher(members: Member[], history: WashRecord[], cookId?: string): Member | undefined {
  if (!members.length) return undefined
  const candidates = members.length > 1 ? members.filter(member => member.id !== cookId) : members
  const counts = new Map<string, number>()
  const last = new Map<string, number>()
  // Stable chronological ordering; input order breaks equal-date ties.
  const ordered = history.map((record, index) => ({ record, index })).sort((a, b) => a.record.date.localeCompare(b.record.date) || a.index - b.index)
  ordered.forEach(({ record }, index) => {
    counts.set(record.memberId, (counts.get(record.memberId) ?? 0) + 1)
    last.set(record.memberId, index)
  })
  return [...candidates].sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0) || (last.get(a.id) ?? -1) - (last.get(b.id) ?? -1) || members.indexOf(a) - members.indexOf(b))[0]
}
