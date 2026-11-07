import { describe, expect, it } from 'vitest'
import { chooseWasher, defaultSettings, getPrepSteps, getShoppingList, ingredients, planMeal, recipes } from './mealPlanner'
import type { MealSettings, Member, Recipe, WashRecord } from './mealPlanner'

const TODAY = '2026-11-07'
const settings = (overrides: Partial<MealSettings> = {}): MealSettings => ({ ...structuredClone(defaultSettings), ...overrides })
const recipe = (id: string) => recipes.find(r => r.id === id)!
const member = (overrides: Partial<Member> = {}): Member => ({ ...defaultSettings.members[0], ...overrides })
const cost = (selected: Recipe[], config: MealSettings) => Math.round(getShoppingList(selected, config, TODAY).reduce((sum, i) => sum + i.estimatedCost, 0) * 100) / 100
function enumerate(config: MealSettings): Recipe[][] {
  const mains = recipes.filter(r => r.category !== 'staple')
  const result: Recipe[][] = []
  const visit = (start: number, chosen: Recipe[]) => {
    if (chosen.length === config.dishCount) {
      for (const staple of recipes.filter(r => r.category === 'staple')) result.push([staple, ...chosen])
      return
    }
    for (let i = start; i < mains.length; i++) visit(i + 1, [...chosen, mains[i]])
  }
  visit(0, [])
  return result
}

describe('offline meal catalog and contracts', () => {
  it('has practical two-serving recipes, known unit prices, and exact defaults', () => {
    expect(recipes.length).toBeGreaterThanOrEqual(10)
    expect(recipes.length).toBeLessThanOrEqual(16)
    expect(new Set(recipes.map(r => r.id)).size).toBe(recipes.length)
    expect(defaultSettings).toMatchObject({ budget: 40, dishCount: 3, vegetarian: false, pantry: [], prices: {} })
    expect(defaultSettings.members.map(m => m.portion)).toEqual([1, 1])
    for (const r of recipes) {
      expect(r.steps.length).toBeGreaterThan(0)
      expect(r.prep.length).toBeGreaterThan(0)
      expect(r.minutes).toBeGreaterThan(0)
      for (const part of r.ingredients) {
        expect(ingredients.some(i => i.id === part.ingredientId)).toBe(true)
        expect(part.quantity).toBeGreaterThan(0)
      }
      if (r.category === 'meat') {
        expect(r.safety).toContain('75°C')
        expect(r.steps.join('')).toContain('熟透')
      }
    }
    expect(ingredients.find(i => i.id === 'egg')).toMatchObject({ unit: '个', pricePerUnit: 1.2 })
    expect(ingredients.find(i => i.id === 'rice')!.pricePerUnit * 500).toBe(3)
  })
  it('returns the agreed plan shape without mutating settings or catalog', () => {
    const config = settings()
    const before = JSON.stringify(config)
    const catalogBefore = JSON.stringify(recipes)
    const plan = planMeal(config, 0, TODAY)
    expect(plan.recipes).toHaveLength(4)
    expect(plan.recipes.filter(r => r.recipe.category === 'staple')).toHaveLength(1)
    expect(plan.servingUnits).toBe(2)
    expect(plan.recipes.every(r => r.servings === 2)).toBe(true)
    expect(plan.originalEstimate).toBe(plan.purchaseEstimate)
    expect(plan.warnings.join('')).toContain('不是实时售价')
    expect(plan.warnings.join('')).toContain('不能保证穷尽过敏原')
    expect(JSON.stringify(config)).toBe(before)
    expect(JSON.stringify(recipes)).toBe(catalogBefore)
  })
})

describe('scaled quantities, merged ingredients and pantry', () => {
  it('scales by total portions / two, ceil eggs and sensible gram rounding', () => {
    const config = settings({ members: [member({ portion: 1.25 })] })
    const list = getShoppingList([recipe('tomato-eggs')], config, TODAY)
    expect(list.find(i => i.ingredientId === 'egg')).toMatchObject({ required: 2, toBuy: 2, unit: '个', estimatedCost: 2.4 })
    expect(list.find(i => i.ingredientId === 'tomato')?.required).toBe(190)
    expect(list.find(i => i.ingredientId === 'oil')?.required).toBe(7)
    expect(list.find(i => i.ingredientId === 'salt')?.required).toBe(2)
    const large = getShoppingList([recipe('rice')], settings({ members: [member({ portion: 1 }), member({ id: 'b', portion: 2 })] }), TODAY)
    expect(large[0].required).toBe(240)
  })
  it('merges shared ingredients before rounding and emits one shopping row', () => {
    const list = getShoppingList([recipe('tomato-eggs'), recipe('tomato-tofu-soup')], settings({ members: [member({ portion: 0.5 })] }), TODAY)
    expect(list.filter(i => i.ingredientId === 'tomato')).toHaveLength(1)
    expect(list.find(i => i.ingredientId === 'tomato')?.required).toBe(125)
    expect(list.find(i => i.ingredientId === 'salt')?.required).toBe(1)
  })
  it('sums usable same-unit inventory, excludes past expiry, includes today expiry', () => {
    const config = settings({ pantry: [
      { ingredientId: 'tomato', quantity: 100 },
      { ingredientId: 'tomato', quantity: 80, expiresOn: TODAY },
      { ingredientId: 'tomato', quantity: 1000, expiresOn: '2026-11-06' },
      { ingredientId: 'egg', quantity: 1 },
    ] })
    const list = getShoppingList([recipe('tomato-eggs')], config, TODAY)
    expect(list.find(i => i.ingredientId === 'tomato')).toMatchObject({ required: 300, available: 180, toBuy: 120, estimatedCost: 0.96 })
    expect(list.find(i => i.ingredientId === 'egg')).toMatchObject({ required: 3, available: 1, toBuy: 2 })
    const plan = planMeal(config, 0, TODAY)
    expect(plan.warnings.some(w => w.includes('番茄') && w.includes('已过期') && w.includes('1000g'))).toBe(true)
  })
  it('does not buy surplus stock and respects zero and custom prices', () => {
    const config = settings({ pantry: [{ ingredientId: 'rice', quantity: 1000 }], prices: { rice: 0, egg: 2 } })
    expect(getShoppingList([recipe('rice')], config, TODAY)[0]).toMatchObject({ required: 160, available: 1000, toBuy: 0, estimatedCost: 0 })
    expect(getShoppingList([recipe('tomato-eggs')], config, TODAY).find(i => i.ingredientId === 'egg')?.estimatedCost).toBe(6)
    const noRiceStock = settings({ prices: { rice: 0 } })
    expect(getShoppingList([recipe('rice')], noRiceStock, TODAY)[0].estimatedCost).toBe(0)
  })
})

describe('hard safety filters and soft preferences', () => {
  it.each(['蛋', '鸡蛋', 'egg', '蛋清'])('excludes eggs using allergy %s', allergy => {
    const config = settings({ members: [member({ allergies: allergy })] })
    for (let variant = 0; variant < 5; variant++) expect(planMeal(config, variant, TODAY).recipes.every(r => r.recipe.ingredients.every(i => i.ingredientId !== 'egg'))).toBe(true)
    expect(() => getShoppingList([recipe('tomato-eggs')], config, TODAY)).toThrow('不符合')
  })
  it.each(['大豆', 'soy', '豆浆', '酱油'])('excludes tofu and soy sauce via alias %s', allergy => {
    const config = settings({ members: [member({ allergies: allergy })] })
    const plan = planMeal(config, 0, TODAY)
    expect(plan.recipes.every(r => r.recipe.ingredients.every(i => !['tofu', 'soy-sauce'].includes(i.ingredientId)))).toBe(true)
    expect(() => getShoppingList([recipe('mushroom-tofu')], config, TODAY)).toThrow('不符合')
  })
  it('matches hard avoids against ingredient names and dish titles, not likes', () => {
    const config = settings({ members: [member({ avoids: '白菜、番茄;鸡肉，虾', likes: '白菜 鸡肉' })] })
    const plan = planMeal(config, 0, TODAY)
    expect(plan.shopping.every(i => !['cabbage', 'tomato', 'chicken', 'shrimp'].includes(i.ingredientId))).toBe(true)
    expect(() => getShoppingList([recipe('cabbage')], settings({ members: [member({ avoids: '清炒白菜' })] }), TODAY)).toThrow('不符合')
  })
  it('filters wheat aliases including wheat-containing sauce and seafood names', () => {
    const config = settings({ members: [member({ allergies: '面粉 海鲜' })] })
    const plan = planMeal(config, 0, TODAY)
    expect(plan.shopping.every(i => !['noodles', 'soy-sauce', 'shrimp'].includes(i.ingredientId))).toBe(true)
    expect(() => getShoppingList([recipe('shrimp-broccoli')], settings({ members: [member({ allergies: '甲壳类' })] }), TODAY)).toThrow('不符合')
  })
  it('hard seafood avoids apply without requiring an allergy entry', () => {
    for (const avoids of ['海鲜', '海产品', 'seafood']) {
      const config = settings({ members: [member({ avoids, likes: '虾' })] })
      expect(() => getShoppingList([recipe('shrimp-broccoli')], config, TODAY)).toThrow('不符合')
      for (const variant of [0, 3, 25]) expect(planMeal(config, variant, TODAY).shopping.some(i => i.ingredientId === 'shrimp')).toBe(false)
    }
  })
  it('matches soft taste tags such as 清淡 when costs tie', () => {
    const config = settings({ dishCount: 1, vegetarian: true, prices: Object.fromEntries(ingredients.map(i => [i.id, 0])), members: [member({ likes: '清淡' })] })
    expect(planMeal(config, 0, TODAY).recipes.some(r => r.recipe.category !== 'staple' && r.recipe.tags.includes('清淡'))).toBe(true)
  })
  it('does not assume absent common allergens are present or promise exhaustive safety', () => {
    expect(() => planMeal(settings({ members: [member({ allergies: '花生、鱼、牛奶' })] }), 0, TODAY)).not.toThrow()
  })
  it('strict vegetarian excludes eggs as well as meat/seafood for every variant', () => {
    const config = settings({ vegetarian: true })
    for (let variant = 0; variant < 8; variant++) {
      const plan = planMeal(config, variant, TODAY)
      expect(plan.recipes).toHaveLength(4)
      expect(plan.shopping.every(i => !['egg', 'pork', 'chicken', 'shrimp'].includes(i.ingredientId))).toBe(true)
      expect(plan.warnings.some(w => w.includes('严格纯素'))).toBe(true)
    }
  })
  it('uses another safe staple when rice is hard avoided and errors if none safe', () => {
    const config = settings({ members: [member({ avoids: '大米' })] })
    expect(planMeal(config, 0, TODAY).recipes.find(r => r.recipe.category === 'staple')?.recipe.id).not.toBe('rice')
    expect(() => planMeal(settings({ members: [member({ avoids: '大米 小麦 土豆' })] }), 0, TODAY)).toThrow('没有可用主食')
    expect(() => planMeal(settings({ members: [member({ avoids: '盐 油 鸡蛋 豆腐 猪肉 鸡肉 虾仁' })] }), 0, TODAY)).toThrow('不会自动放宽')
  })
  it('likes are a soft tie-break and never override hard restrictions or budget', () => {
    const freePrices = Object.fromEntries(ingredients.map(i => [i.id, 0]))
    const config = settings({ dishCount: 1, vegetarian: true, prices: freePrices, members: [member({ likes: '香菇' })] })
    expect(planMeal(config, 0, TODAY).recipes.some(r => r.recipe.title.includes('香菇'))).toBe(true)
    const avoided = { ...config, members: [member({ likes: '香菇', avoids: '香菇' })] }
    expect(planMeal(avoided, 0, TODAY).shopping.some(i => i.ingredientId === 'mushroom')).toBe(false)
  })
})

describe('exhaustive budget selection and deterministic alternatives', () => {
  it('selects cheapest affordable balanced normal menu when balance is feasible', () => {
    const config = settings({ dishCount: 2 })
    const allBalanced = enumerate(config).filter(menu => menu.some(r => r.category === 'meat') && menu.some(r => r.category === 'veg'))
    const min = Math.min(...allBalanced.map(menu => cost(menu, config)))
    const plan = planMeal(config, 0, TODAY)
    expect(plan.purchaseEstimate).toBe(min)
    expect(plan.recipes.some(r => r.recipe.category === 'meat')).toBe(true)
    expect(plan.recipes.some(r => r.recipe.category === 'veg')).toBe(true)
    expect(plan.fitsBudget).toBe(true)
    expect(planMeal({ ...config, budget: min }, 0, TODAY).fitsBudget).toBe(true)
  })
  it('honors chicken likes with actual prices when safe balanced options fit budget', () => {
    const config = settings({ budget: 40, members: [member({ likes: '鸡肉' }), member({ id: 'b' })] })
    const plan = planMeal(config, 0, TODAY)
    expect(plan.recipes.some(r => r.recipe.id === 'chicken-potato')).toBe(true)
    expect(plan.recipes.some(r => r.recipe.category === 'veg')).toBe(true)
    expect(plan.fitsBudget).toBe(true)
    expect(plan.purchaseEstimate).toBeLessThanOrEqual(40)
    const impossible = { ...config, budget: 0 }
    const minimum = Math.min(...enumerate(impossible).map(menu => cost(menu, impossible)))
    expect(planMeal(impossible, 0, TODAY).purchaseEstimate).toBe(minimum)
  })
  it('honors the feasible budget over balance and warns rather than overspending', () => {
    const config = settings({ dishCount: 2, budget: 5 })
    const plan = planMeal(config, 0, TODAY)
    expect(plan.fitsBudget).toBe(true)
    expect(plan.purchaseEstimate).toBeLessThanOrEqual(5)
    expect(plan.warnings.some(w => w.includes('未安排荤素各一道'))).toBe(true)
  })
  it('when impossible returns global cheapest safe plan, exact exceed, even for variants', () => {
    const config = settings({ dishCount: 2, budget: 0 })
    const min = Math.min(...enumerate(config).map(menu => cost(menu, config)))
    const plan = planMeal(config, 9, TODAY)
    expect(plan.fitsBudget).toBe(false)
    expect(plan.purchaseEstimate).toBe(min)
    expect(plan.warnings.some(w => w.includes(`超出预算 ¥${min.toFixed(2)}`))).toBe(true)
    expect(planMeal(config, 0, TODAY).id).toBe(plan.id)
  })
  it('uses stocked ingredients including a stocked alternate staple to minimize purchases', () => {
    const chosen = [recipe('noodles'), recipe('chicken-potato'), recipe('broccoli-carrot')]
    const pantry = getShoppingList(chosen, settings(), TODAY).map(i => ({ ingredientId: i.ingredientId, quantity: i.required }))
    const config = settings({ dishCount: 2, pantry, budget: 0 })
    const plan = planMeal(config, 0, TODAY)
    expect(plan.purchaseEstimate).toBe(0)
    expect(plan.fitsBudget).toBe(true)
    expect(plan.originalEstimate).toBeGreaterThan(0)
    expect(plan.recipes.some(r => r.recipe.id === 'noodles')).toBe(true)
    expect(plan.recipes.some(r => r.recipe.category === 'meat')).toBe(true)
  })
  it('variants are deterministic, distinct safe affordable menus with mains 1–4', () => {
    const config = settings()
    const first = planMeal(config, 0, TODAY)
    const second = planMeal(config, 1, TODAY)
    expect(second.id).not.toBe(first.id)
    expect(second).toEqual(planMeal(config, 1, TODAY))
    for (const variant of [1, 5, 50, 9999]) expect(planMeal(config, variant, TODAY).purchaseEstimate).toBeLessThanOrEqual(config.budget)
    for (const dishCount of [1, 2, 3, 4]) expect(planMeal(settings({ dishCount }), 0, TODAY).recipes).toHaveLength(dishCount + 1)
  })
})

describe('validation and preparation safety', () => {
  it.each([NaN, Infinity, -1, 100001])('rejects budget %s', budget => expect(() => planMeal(settings({ budget }), 0, TODAY)).toThrow('预算'))
  it.each([NaN, Infinity, -1, 100001])('rejects override price %s instead of silently using defaults', price => expect(() => planMeal(settings({ prices: { rice: price } }), 0, TODAY)).toThrow('单价'))
  it.each([0, 5, 1.5, NaN])('rejects mains count %s', dishCount => expect(() => planMeal(settings({ dishCount }), 0, TODAY)).toThrow('菜数'))
  it.each([0, -1, Infinity, 5.1])('rejects portion %s', portion => expect(() => planMeal(settings({ members: [member({ portion })] }), 0, TODAY)).toThrow('食量'))
  it('rejects empty/duplicate members, invalid dates, pantry values, identifiers and variants', () => {
    expect(() => planMeal(settings({ members: [] }), 0, TODAY)).toThrow('成员')
    expect(() => planMeal(settings({ members: [member(), member()] }), 0, TODAY)).toThrow('唯一')
    expect(() => planMeal(settings(), 0, '2026-02-30')).toThrow('日期')
    expect(() => planMeal(settings({ pantry: [{ ingredientId: 'rice', quantity: -1 }] }), 0, TODAY)).toThrow('库存数量')
    expect(() => planMeal(settings({ pantry: [{ ingredientId: 'egg', quantity: 1.5 }] }), 0, TODAY)).toThrow('整数个')
    expect(() => planMeal(settings({ pantry: [{ ingredientId: 'rice', quantity: 1, expiresOn: 'bad' }] }), 0, TODAY)).toThrow('日期')
    expect(() => planMeal(settings({ prices: { unknown: 1 } }), 0, TODAY)).toThrow('未知食材')
    expect(() => getShoppingList([{ ...recipe('rice'), ingredients: [{ ingredientId: 'unknown', quantity: 1 }] }], settings(), TODAY)).toThrow('未知食材')
    expect(() => planMeal(settings(), 1.5, TODAY)).toThrow('整数')
    expect(() => planMeal(settings(), -1, TODAY)).toThrow('编号')
  })
  it('starts rice, preps vegetables before raw meat, then prioritizes simmering', () => {
    const steps = getPrepSteps([recipe('chicken-potato'), recipe('rice'), recipe('cucumber')])
    const riceIndex = steps.findIndex(s => s.startsWith('主食：'))
    const vegIndex = steps.findIndex(s => s.includes('所有蔬菜'))
    const meatIndex = steps.findIndex(s => s.startsWith('生肉：'))
    expect(riceIndex).toBeLessThan(vegIndex)
    expect(vegIndex).toBeLessThan(meatIndex)
    expect(steps.findIndex(s => s.startsWith('蔬菜：黄瓜'))).toBeLessThan(meatIndex)
    expect(steps.some(s => s.includes('并行炒蔬菜'))).toBe(true)
    expect(steps.join('')).toContain('生熟工具不可混用')
    expect(steps.join('')).toContain('75°C')
    expect(new Set(steps).size).toBe(steps.length)
  })
})

describe('fair washer selection', () => {
  const members = ['a', 'b', 'c'].map(id => member({ id, name: id }))
  const record = (memberId: string, index: number): WashRecord => ({ id: `wash-${index}`, date: `2026-11-${String(index + 1).padStart(2, '0')}`, memberId })
  it('handles no members and solo cook; excludes cook when others exist', () => {
    expect(chooseWasher([], [])).toBeUndefined()
    expect(chooseWasher([members[0]], [], 'a')).toBe(members[0])
    expect(chooseWasher(members, [], 'a')?.id).toBe('b')
  })
  it('chooses least historical count and then least recently assigned', () => {
    expect(chooseWasher(members, [record('a', 0), record('a', 1), record('b', 2)])?.id).toBe('c')
    expect(chooseWasher(members, [record('b', 0), record('c', 1), record('a', 2)])?.id).toBe('b')
    expect(chooseWasher(members, [record('b', 0), record('c', 1), record('a', 2)], 'b')?.id).toBe('c')
  })
  it('rotates stable ties using dated history and does not mutate inputs', () => {
    const history: WashRecord[] = []
    const chosen: string[] = []
    for (let i = 0; i < 9; i++) {
      const next = chooseWasher(members, history)!
      chosen.push(next.id)
      history.push(record(next.id, i))
    }
    expect(chosen).toEqual(['a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c'])
    const reversed = [...history].reverse()
    const before = JSON.stringify(reversed)
    expect(chooseWasher(members, reversed)?.id).toBe('a')
    expect(JSON.stringify(reversed)).toBe(before)
  })
  it('ignores unknown members when deciding ties and remains stable on equal dates', () => {
    expect(chooseWasher(members, [record('unknown', 0)])?.id).toBe('a')
    const sameDate = ['c', 'a', 'b'].map((id, i) => ({ ...record(id, i), date: TODAY }))
    expect(chooseWasher(members, sameDate)?.id).toBe('c')
  })
})
