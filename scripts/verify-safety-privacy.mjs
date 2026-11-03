import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const before = process.argv.includes('--before')
const evidence = process.env.AILY_EVIDENCE_DIR || 'docs/evidence/safety-privacy'
const url = process.env.AILY_URL || 'http://127.0.0.1:4293/'
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await page.getByRole('button', { name: /遇见 TA/ }).waitFor()
  await page.screenshot({ path: `${evidence}/${before ? 'before' : 'after'}-welcome.png`, fullPage: true })
  if (!before) {
    await page.getByLabel('我已年满 18 周岁').check()
    await page.getByLabel('我理解 AI 身份与数据说明').check()
  }
  await page.getByRole('button', { name: /遇见 TA/ }).click()
  await page.getByRole('button', { name: /开始我们的故事/ }).click()
  // Preserve the full nine-step onboarding introduced before the safety gate.
  for (let step = 2; step <= 6; step++) await page.getByRole('button', { name: '继续', exact: true }).click()
  await page.getByRole('button', { name: '发送试聊', exact: true }).click()
  await page.getByRole('button', { name: '称呼没问题，继续', exact: true }).click()
  await page.getByRole('button', { name: '完成引导', exact: true }).click()
  await page.getByRole('button', { name: '我的', exact: true }).click()
  await page.getByText('我的 Aily', { exact: true }).waitFor()
  await page.screenshot({ path: `${evidence}/${before ? 'before' : 'after'}-profile.png`, fullPage: true })
  if (!before) {
    await page.getByRole('button', { name: '安全与隐私', exact: true }).click()
    await page.getByRole('heading', { name: '安全与隐私' }).waitFor()
    await page.screenshot({ path: `${evidence}/after-privacy.png`, fullPage: true })
    await page.getByRole('button', { name: '删除本机使用资料', exact: true }).click()
    await page.getByLabel('输入“删除”确认').fill('删除')
    await page.screenshot({ path: `${evidence}/after-delete-confirm.png`, fullPage: true })
    await page.getByRole('button', { name: '取消删除' }).click()
    await page.getByRole('button', { name: '返回我的' }).click()
    await page.getByRole('button', { name: '消息', exact: true }).click()
    await page.getByRole('button', { name: /去找他/ }).click()
    await page.getByLabel('发消息', { exact: true }).fill('我想自杀')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await page.getByText(/在中国大陆拨打/).waitFor()
    await page.screenshot({ path: `${evidence}/after-crisis.png`, fullPage: true })
    await page.reload()
    await page.getByRole('button', { name: '我的', exact: true }).click()
    await page.getByRole('button', { name: '安全与隐私', exact: true }).click()
    await page.getByRole('button', { name: '删除本机使用资料', exact: true }).click()
    await page.getByLabel('输入“删除”确认').fill('删除')
    const other = await context.newPage()
    await other.goto(url)
    await other.getByRole('button', { name: '我的', exact: true }).waitFor()
    await page.getByRole('button', { name: '永久删除并退出', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '请关闭其他 Aily' }).waitFor()
    // Refusal must preserve conversation data; the other active tab remains usable.
    await other.getByRole('button', { name: /去找他/ }).click()
    await other.getByText(/在中国大陆拨打/).waitFor()
    await other.close()
    await page.getByRole('button', { name: '重试删除' }).click()
    await page.getByText('本机使用资料已删除').waitFor()
    await page.reload()
    assert.equal(await page.getByLabel('我已年满 18 周岁').isChecked(), false)
    await page.setViewportSize({ width: 320, height: 740 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `${evidence}/after-welcome-320.png`, fullPage: true })
  }
  assert.deepEqual(errors, [])
  console.log(before ? 'Captured real baseline welcome/profile.' : 'Safety/privacy browser journey passed.')
} finally { await browser.close() }
