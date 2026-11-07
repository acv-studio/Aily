import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
process.env.PLAYWRIGHT_BROWSERS_PATH ||= new URL('../.toolchains/playwright/', import.meta.url).pathname
const { webkit } = await import('playwright')
const url = process.env.AILY_THEME_URL || 'http://127.0.0.1:5174'
const out = new URL('../.mobile-build/flat-tabs/', import.meta.url)
await mkdir(out, { recursive: true })
const browser = await webkit.launch({ headless: true })
const results = []
try {
  for (const theme of ['light', 'dark']) for (const width of [402, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(url)
    await page.evaluate(async mode => {
      const { finishOnboarding } = await import('/src/db.ts')
      const { defaultOnboardingProfile } = await import('/src/onboarding.ts')
      const { acceptSafetyConsent } = await import('/src/privacy.ts')
      const { setThemePreference } = await import('/src/theme.ts')
      const { setExtensionInstalled } = await import('/src/extensionApps.ts')
      await finishOnboarding(defaultOnboardingProfile('lu'), [])
      acceptSafetyConsent(); setThemePreference(mode)
      localStorage.setItem('aily.locale', 'zh-CN')
      for (const id of ['wardrobe', 'skincare-diary', 'meal-planner']) setExtensionInstalled(id, true)
      localStorage.setItem('aily.ext.wardrobe', JSON.stringify([{ id: 'top', name: '上衣', category: '上装', color: '浅绿', season: '四季' }, { id: 'bottom', name: '长裤', category: '下装', color: '浅紫', season: '四季' }, { id: 'shoe', name: '平底鞋', category: '鞋子', color: '绿色', season: '四季' }]))
    }, theme)
    await page.reload()
    await page.getByRole('button', { name: /穿搭衣橱$/ }).waitFor()
    const sample = async (selector, name, exclude = '') => {
      const values = await page.locator(selector).evaluate((nav, excluded) => {
        const radius = el => { const s = getComputedStyle(el); return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius] }
        const rgb = text => (text.match(/[\d.]+/g) || []).map(Number)
        const background = element => {
          const layers = []
          for (let el = element; el; el = el.parentElement) { const paint = rgb(getComputedStyle(el).backgroundColor); layers.push(paint); if ((paint[3] ?? 1) === 1) break }
          let color = [255,255,255]
          for (const paint of layers.reverse()) color = color.map((v,i) => v*(1-(paint[3] ?? 1)) + paint[i]*(paint[3] ?? 1))
          return color
        }
        const lum = values => values.slice(0,3).map(v => { const s = v/255; return s <= .04045 ? s/12.92 : ((s+.055)/1.055)**2.4 }).reduce((sum,v,i) => sum+v*[.2126,.7152,.0722][i],0)
        const buttons = [...nav.querySelectorAll('button')].filter(el => !excluded || !el.matches(excluded)).map(el => {
          const label = el.querySelector('span') || el, s = getComputedStyle(label), fg = lum(rgb(s.color)), bg = lum(background(label))
          return { text: el.textContent.trim(), radius: radius(el), color: s.color, contrast: (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05) }
        })
        return { radius: radius(nav), background: getComputedStyle(nav).backgroundColor, buttons }
      }, exclude)
      assert.deepEqual(values.radius, ['0px','0px','0px','0px'], name)
      for (const button of values.buttons) { assert.deepEqual(button.radius, ['0px','0px','0px','0px'], `${name}: ${button.text}`); if (name === 'wardrobe') assert.ok(button.contrast >= 4.5, JSON.stringify(button)) }
      if (theme === 'light' && ['main', 'wardrobe'].includes(name)) assert.equal(values.background, 'rgb(255, 255, 255)')
      results.push({ theme, width, name, ...values })
    }
    await sample('.bottom-nav', 'main')
    await page.getByRole('button', { name: /穿搭衣橱$/ }).click()
    const wardrobe = page.getByRole('navigation', { name: '衣橱导航', exact: true })
    await wardrobe.waitFor()
    await sample('.wardrobe-bottom-nav', 'wardrobe')
    const cardRadius = await page.locator('.wardrobe-category-card').first().evaluate(el => getComputedStyle(el).borderTopLeftRadius)
    assert.equal(cardRadius, '20px', 'Content cards keep their own rounded style')
    await page.screenshot({ path: new URL(`${theme}-${width}-wardrobe.png`, out).pathname })
    const box = await wardrobe.boundingBox()
    await page.screenshot({ path: new URL(`${theme}-${width}-wardrobe-tab-detail.png`, out).pathname, clip: { x: 0, y: Math.max(0, Math.floor(box.y)-30), width, height: 874-Math.max(0, Math.floor(box.y)-30) } })
    await wardrobe.getByRole('button', { name: '分类', exact: true }).tap()
    await sample('.wardrobe-bottom-nav', 'wardrobe')
    await sample('.wardrobe-filters', 'wardrobe-filters')
    await wardrobe.getByRole('button', { name: '穿搭', exact: true }).tap()
    await page.getByRole('button', { name: '返回 Aily', exact: true }).tap()
    await page.getByRole('button', { name: /护肤日记$/ }).click()
    await page.getByRole('navigation', { name: '护肤导航', exact: true }).waitFor()
    await sample('.sk-bottom-nav', 'skincare')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '记账', exact: true }).click()
    await page.getByRole('navigation', { name: '手账导航', exact: true }).waitFor()
    await sample('.ledger-bottom-nav', 'ledger', '.ledger-add')
    assert.equal(await page.locator('.ledger-add').evaluate(el => getComputedStyle(el).borderTopLeftRadius), '50%', 'Add action remains a button, not a tab')
    await page.getByRole('navigation', { name: '手账导航', exact: true }).getByRole('button', { name: '图表', exact: true }).click()
    await sample('.ledger-segmented', 'ledger-chart-tabs')
    await sample('.ledger-chart-kind', 'ledger-chart-kind')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.deepEqual(errors, [])
    await context.close()
  }
  await writeFile(new URL('results.json', out), JSON.stringify(results, null, 2))
  console.log(`PASS: ${results.length} tab variants; all corners square; light navigation white; wardrobe label contrast >=4.5; cards and add button unchanged.`)
} finally { await browser.close() }
