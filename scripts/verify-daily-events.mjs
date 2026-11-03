import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const before = process.argv.includes('--before')
const evidence = 'docs/evidence/daily-events'
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai', locale: 'zh-CN' })
  await context.addInitScript(() => localStorage.setItem('aily.locale', 'zh-CN'))
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install({ time: new Date('2026-12-25T12:00:00+08:00') })
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4329/')
  await page.locator('.welcome').waitFor()
  await page.evaluate(async () => {
    const { saveSetting } = await import('/src/db.ts')
    const { acceptSafetyConsent } = await import('/src/privacy.ts')
    await saveSetting('onboarded', true)
    acceptSafetyConsent()
  })
  await page.reload()
  await page.getByRole('button', { name: '此刻', exact: true }).click()
  await page.locator('.moment').first().waitFor()
  await page.screenshot({ path: `${evidence}/${before ? 'before' : 'after'}-holiday.png` })
  if (!before) {
    const card = page.getByRole('region', { name: '今日轻量事件' })
    await card.getByText('节日话题', { exact: true }).waitFor()
    assert.match(await card.textContent(), /12月25日|12 月 25 日/)
    const identity = await card.locator('h2').textContent()
    await card.getByRole('combobox', { name: '一起聊的角色' }).selectOption('gu')
    await card.getByRole('button').first().click()
    await page.locator('.chat-header strong').filter({ hasText: '顾辰泽' }).waitFor()
    assert.ok((await page.getByRole('textbox', { name: '发消息' }).inputValue()).length > 0)
    assert.equal(await page.locator('.message-row.mine').count(), 0)
    await page.screenshot({ path: `${evidence}/after-draft.png` })
    await page.getByRole('button', { name: '返回消息' }).click()
    await page.getByRole('button', { name: '此刻', exact: true }).click()
    assert.equal(await card.locator('h2').textContent(), identity)
    await page.reload()
    await page.getByRole('button', { name: '此刻', exact: true }).click()
    assert.equal(await card.locator('h2').textContent(), identity)
    await page.clock.setSystemTime(new Date('2026-12-26T12:00:00+08:00'))
    await page.clock.runFor(60000)
    await card.getByText('日常话题', { exact: true }).waitFor()
    await page.screenshot({ path: `${evidence}/after-daily.png` })
    await page.evaluate(async () => { const { setLocale } = await import('/src/i18n.tsx'); setLocale('en') })
    const englishCard = page.getByRole('region', { name: 'Today’s small event' })
    await englishCard.getByText('Daily topic', { exact: true }).waitFor()
    await page.setViewportSize({ width: 320, height: 740 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await page.screenshot({ path: `${evidence}/after-english-320.png`, fullPage: true })
  }
  assert.deepEqual(errors, [])
  console.log(before ? 'Captured actual baseline: holiday date, 390x844 dark, same local time and fixture.' : 'Daily event browser verification passed: holiday, role draft without sending, refresh stability, date rollover, English, 320px layout.')
} finally { await browser.close() }
