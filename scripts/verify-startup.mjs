import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

// Run against an isolated dev server; never alters the user's browser data.
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark', timezoneId: 'Asia/Shanghai' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4399/')
  await page.getByRole('button', { name: 'Meet your companion', exact: true }).waitFor()
  assert.equal(await page.locator('vite-error-overlay').count(), 0)
  assert.ok(await page.locator('#root').evaluate(root => root.children.length > 0))
  if (process.env.CAPTURE === '1') {
    await mkdir('docs/evidence/blank-screen', { recursive: true })
    await page.screenshot({ path: 'docs/evidence/blank-screen/after.png' })
  }
  // Returning-user fixture with a confirmed memory exercises the other lost bindings.
  await page.evaluate(async () => {
    const { saveSetting, saveMemory } = await import('/src/db.ts')
    await saveSetting('onboarded', true)
    await saveSetting('selected', 'lu')
    await saveMemory({ id: 'startup-fixture', characterId: 'lu', category: 'relationship', text: '一起散步', confirmedAt: '2026-01-01T10:00:00Z' })
    localStorage.setItem('aily.locale', 'zh-CN')
    localStorage.setItem('aily-safety-consent-v1', 'adult-ai-privacy-accepted')
  })
  await page.reload()
  await page.getByRole('button', { name: '回忆', exact: true }).click()
  await page.getByRole('button', { name: '分享回忆卡', exact: true }).click()
  await page.getByRole('dialog', { name: '分享回忆卡' }).waitFor()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  for (const tab of ['此刻', '商城', '我的', '消息']) {
    await page.getByRole('button', { name: tab, exact: true }).click()
  }
  await page.getByRole('button', { name: '去找他', exact: true }).click()
  await page.getByRole('textbox', { name: '发消息', exact: true }).fill('今天很累')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await page.getByText(/【本地演示回复 · 非 AI 生成】/).waitFor()
  await page.getByRole('button', { name: '发送消息', exact: true }).waitFor({ state: 'visible' })
  await page.reload()
  await page.getByRole('button', { name: '去找他', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS: fresh startup, returning profile, populated memories, share dialog, five tabs, local demo reply and reload; no browser errors.')
} finally {
  await browser.close()
}
