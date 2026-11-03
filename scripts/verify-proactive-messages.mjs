import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const before = process.argv.includes('--before')
const evidence = process.env.AILY_EVIDENCE_DIR || 'docs/evidence/proactive-messages'
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(process.env.AILY_URL || 'http://127.0.0.1:4187/')
  await page.evaluate(async () => {
    const { saveSetting } = await import('/src/db.ts')
    await saveSetting('onboarded', true); await saveSetting('selected', 'lu')
    localStorage.setItem('aily-safety-consent-v1', 'adult-ai-privacy-accepted')
  })
  await page.reload()
  await page.getByRole('button', { name: '我的', exact: true }).click()
  await page.getByText('我的 Aily', { exact: true }).waitFor()
  await page.screenshot({ path: `${evidence}/${before ? 'before' : 'after'}-profile.png`, fullPage: true })
  if (!before) {
    await page.getByRole('button', { name: '角色主动消息设置' }).click()
    await page.getByRole('heading', { name: '角色主动消息' }).waitFor()
    await page.getByRole('button', { name: '保存设置' }).waitFor()
    await page.screenshot({ path: `${evidence}/after-settings.png`, fullPage: true })
    await page.getByRole('checkbox', { name: '开启主动消息' }).check()
    await page.getByLabel('消息频率').selectOption('normal')
    await page.getByRole('checkbox', { name: '免打扰' , exact: true }).uncheck()
    await page.getByLabel('当前天气（手动提供）').selectOption('rainy')
    await page.getByRole('button', { name: '保存设置' }).click()
    await page.getByRole('status').filter({ hasText: '设置已保存' }).waitFor()
    await page.getByRole('button', { name: '返回我的' }).click()
    await page.getByRole('button', { name: '消息', exact: true }).click()
    await page.getByText(/本机主动消息演示/).waitFor()
    await page.screenshot({ path: `${evidence}/after-message.png`, fullPage: true })
    await page.reload()
    await page.getByRole('button', { name: '我的', exact: true }).click()
    await page.getByRole('button', { name: '角色主动消息设置' }).click()
    assert.equal(await page.getByRole('checkbox', { name: '开启主动消息' }).isChecked(), true)
    assert.equal(await page.getByLabel('消息频率').inputValue(), 'normal')
    await page.getByLabel('设置角色').selectOption('chen')
    assert.equal(await page.getByRole('checkbox', { name: '开启主动消息' }).isChecked(), false)
    await page.setViewportSize({ width: 320, height: 740 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `${evidence}/after-settings-320.png`, fullPage: true })
  }
  assert.deepEqual(errors, [])
  console.log(before ? 'Captured real baseline profile, 390x844 dark.' : 'Proactive preferences/browser journey passed, including delivery, reload, role isolation and 320px layout.')
} finally { await browser.close() }
