import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
const browser = await chromium.launch()
const phase = process.env.AILY_PHASE || 'before'
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark', timezoneId: 'Asia/Shanghai' })
  await page.goto(process.env.AILY_URL || 'http://127.0.0.1:4192/')
  await page.evaluate(async () => {
    const { clearAllData, saveSetting } = await import('/src/db.ts')
    await clearAllData()
    await saveSetting('onboarded', true)
    await saveSetting('selected', 'lu')
    localStorage.setItem('aily.locale', 'zh-CN')
  })
  await page.reload()
  await page.getByRole('button', { name: '我的', exact: true }).click()
  await page.getByRole('heading', { name: '我的 Aily' }).waitFor()
  await mkdir('docs/evidence/i18n', { recursive: true })
  await page.screenshot({ path: `docs/evidence/i18n/${phase}-profile-zh.png`, fullPage: true })
  await page.getByRole('button', { name: '消息', exact: true }).click()
  await page.getByRole('button', { name: '去找他', exact: true }).click()
  await page.getByRole('button', { name: '⌁ 共同故事', exact: true }).click()
  await page.getByRole('button', { name: '开始这一章', exact: true }).click()
  await page.screenshot({ path: `docs/evidence/i18n/${phase}-story-zh.png` })
  await page.getByRole('button', { name: '关闭故事', exact: true }).click()
  await page.getByRole('button', { name: '返回消息', exact: true }).click()
  await page.getByRole('button', { name: '我的', exact: true }).click()
  if (phase === 'after') {
    await page.getByRole('combobox', { name: '界面语言 / Interface language' }).selectOption('en')
    await page.getByRole('heading', { name: 'My Aily' }).waitFor()
    await page.screenshot({ path: 'docs/evidence/i18n/after-profile-en.png', fullPage: true })
    await page.getByRole('button', { name: 'Messages', exact: true }).click()
    await page.getByRole('button', { name: 'Talk to him', exact: true }).click()
    await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor()
    await page.screenshot({ path: 'docs/evidence/i18n/after-chat-en.png' })
    await page.getByRole('button', { name: '⌁ Shared story', exact: true }).click()
    await page.getByRole('button', { name: 'Start this chapter', exact: true }).click()
    await page.screenshot({ path: 'docs/evidence/i18n/after-story-en.png' })
  }
  console.log(`Captured ${phase}: actual app, 390×844, dark, lu, empty local chat, profile.`)
} finally { await browser.close() }
