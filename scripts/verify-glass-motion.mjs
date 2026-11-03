import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const before = process.argv.includes('--before')
const evidence = 'docs/evidence/glass-motion'
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', colorScheme: 'dark', reducedMotion: 'no-preference', timezoneId: 'Asia/Shanghai' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  // The baseline merge omitted an import. Restore only that import in transit,
  // leaving baseline markup/styles/behaviour intact; no mock UI is used.
  if (before) {
    for (const module of ['App', 'OnboardingFlow']) await page.route(`**/src/${module}.tsx`, async route => {
      const response = await route.fetch()
      const imports = `import { t, useI18n } from '/src/i18n.tsx';\n${module === 'OnboardingFlow' ? "import LanguageSettings from '/src/LanguageSettings.tsx';\n" : ''}`
      await route.fulfill({ response, body: imports + await response.text() })
    })
  }
  await page.goto(before ? 'http://127.0.0.1:4330/' : 'http://127.0.0.1:4329/')
  await page.locator('.welcome').waitFor()
  await page.screenshot({ path: `${evidence}/${before ? 'before' : 'after'}-onboarding.png`, fullPage: true })
  await page.evaluate(async () => {
    const { db, finishOnboarding } = await import('/src/db.ts')
    const { defaultOnboardingProfile } = await import('/src/onboarding.ts')
    const { acceptSafetyConsent } = await import('/src/privacy.ts')
    acceptSafetyConsent()
    await finishOnboarding({ ...defaultOnboardingProfile('lu'), userName: '小雨' }, [])
    await db.memories.put({ id: 'motion-memory', characterId: 'lu', text: '我们约好周末一起去看海', category: 'relationship', state: 'pending', enabled: false, confirmedAt: '2026-01-01T12:00:00Z' })
  })
  await page.reload()
  await page.getByRole('button', { name: '回忆', exact: true }).click()
  const memory = page.locator('.managed-memory').filter({ hasText: '我们约好周末一起去看海' })
  await memory.waitFor()
  await memory.getByRole('button', { name: '确认记住', exact: true }).click()
  await memory.getByRole('button', { name: '永远别忘', exact: true }).waitFor()
  if (!before) {
    const stage = page.locator('.relationship-stage')
    assert.match(await stage.innerText(), /熟悉/)
    assert.equal(await stage.evaluate(element => element.getAnimations({ subtree: true }).length), 2)
    await memory.evaluate(element => element.getAnimations({ subtree: true }).forEach(animation => { animation.pause(); animation.currentTime = 240 }))
    // Freeze the real application's animations mid-flight for comparable evidence.
    await stage.evaluate(element => element.getAnimations({ subtree: true }).forEach(animation => { animation.pause(); animation.currentTime = 240 }))
  }
  await page.screenshot({ path: `${evidence}/${before ? 'before' : 'after'}-relationship.png`, fullPage: true })
  await memory.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${evidence}/${before ? 'before' : 'after'}-memory.png` })
  await page.getByRole('button', { name: '商城', exact: true }).click()
  await page.getByTestId('demo-balance').filter({ hasText: /^0$/ }).waitFor()
  await page.getByRole('button', { name: '+100 演示币 · 不扣款', exact: true }).click()
  await page.getByRole('button', { name: '确认模拟充值', exact: true }).click()
  await page.getByText('已模拟充值 100 演示币，未真实扣款。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '赠送礼物（演示）', exact: true }).click()
  await page.getByRole('button', { name: '确认赠送（演示）', exact: true }).click()
  const feedback = page.locator('.gift-feedback')
  await feedback.filter({ hasText: '已向陆听澜赠送' }).waitFor()
  await feedback.scrollIntoViewIfNeeded()
  if (!before) await feedback.evaluate(element => element.getAnimations({ subtree: true }).forEach(animation => { animation.pause(); animation.currentTime = 240 }))
  await page.screenshot({ path: `${evidence}/${before ? 'before' : 'after'}-gift.png`, fullPage: true })
  if (!before) {
    assert.equal(await feedback.getAttribute('data-glass-motion'), 'gift')
    // Finished feedback remains legible and decorative layers never intercept input.
    await feedback.evaluate(element => element.getAnimations({ subtree: true }).forEach(animation => animation.finish()))
    assert.equal(await feedback.evaluate(element => getComputedStyle(element, '::before').pointerEvents), 'none')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: '赠送礼物（演示）', exact: true }).click()
    await page.getByRole('button', { name: '确认赠送（演示）', exact: true }).click()
    await feedback.waitFor()
    assert.equal(await feedback.evaluate(element => element.getAnimations({ subtree: true }).length), 0)
    await page.getByRole('button', { name: '回忆', exact: true }).click()
    assert.equal(await page.locator('[data-glass-motion="memory"]').evaluateAll(elements => elements.flatMap(element => element.getAnimations({ subtree: true })).length), 0)
    await page.setViewportSize({ width: 320, height: 740 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `${evidence}/after-reduced-320.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(async () => { const { setLocale } = await import('/src/i18n.tsx'); setLocale('en') })
  await page.locator('.bottom-nav button').nth(0).click()
  await page.locator('.talk-button').click()
  await page.locator('.chat-header').waitFor()
  await page.screenshot({ path: `${evidence}/${before ? 'before' : 'after'}-chat-en.png`, fullPage: true })
  assert.deepEqual(errors, [])
  console.log(before ? 'Baseline application scenarios captured.' : 'Motion journeys passed: confirmed memory/stage, gift response, reduced motion, 320px overflow and no browser errors.')
} finally { await browser.close() }
