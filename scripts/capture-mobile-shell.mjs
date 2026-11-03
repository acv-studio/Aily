import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

// Actual isolated application captures; same viewport, theme, and onboarding state.
const browser = await chromium.launch({ headless: true })
const output = new URL('../docs/evidence/mobile-shell/', import.meta.url)
await mkdir(output, { recursive: true })
try {
  for (const [label, url] of [['before', process.env.BEFORE_URL || 'http://127.0.0.1:4186'], ['after', process.env.AFTER_URL || 'http://127.0.0.1:4198']]) {
    const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce', locale: 'zh-CN' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(url)
    await page.getByRole('button', { name: '遇见 TA' }).waitFor()
    await page.screenshot({ path: new URL(`${label}-welcome.png`, output).pathname })
    // Use the same isolated local fixture on both versions, without exercising
    // unrelated onboarding changes or making any external model requests.
    await page.evaluate(async () => {
      const { db } = await import('/src/db.ts')
      localStorage.setItem('aily-safety-consent-v1', 'adult-ai-privacy-accepted')
      await db.settings.put({ key: 'onboarded', value: true })
      await db.settings.put({ key: 'selected', value: 'lu' })
    })
    await page.reload()
    await page.getByRole('button', { name: '我的', exact: true }).click()
    const panel = page.locator('.data-transfer, .data-tools')
    await panel.scrollIntoViewIfNeeded()
    await panel.locator('input[type=password]').fill('mobile-test-passphrase')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /导出/ }).click()
    const download = await downloadPromise
    if (!download.suggestedFilename().startsWith('aily-backup-')) throw new Error('Unexpected backup filename')
    const notice = label === 'before' ? '加密备份已导出，API Key 不包含在文件中' : '已发起加密备份下载，请妥善保存文件和密码。'
    await page.getByText(notice, { exact: true }).waitFor()
    await panel.scrollIntoViewIfNeeded()
    await page.screenshot({ path: new URL(`${label}-backup.png`, output).pathname })
    if (errors.length) throw new Error(errors.join('\n'))
    await context.close()
  }
} finally {
  await browser.close()
}
