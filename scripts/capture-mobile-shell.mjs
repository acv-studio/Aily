import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

// Actual isolated application captures; same viewport, theme, and onboarding state.
const browser = await chromium.launch({ headless: true })
const output = new URL('../docs/evidence/mobile-shell/', import.meta.url)
await mkdir(output, { recursive: true })
try {
  for (const [label, url] of [['before', process.env.BEFORE_URL || 'http://127.0.0.1:4186'], ['after', process.env.AFTER_URL || 'http://127.0.0.1:4198']]) {
    const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1, colorScheme: 'dark' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(url)
    await page.getByRole('button', { name: '遇见 TA' }).waitFor()
    await page.screenshot({ path: new URL(`${label}-welcome.png`, output).pathname })
    await page.getByRole('button', { name: '遇见 TA' }).click()
    await page.getByRole('button', { name: '开始我们的故事' }).click()
    await page.getByRole('button', { name: '我的', exact: true }).click()
    await page.getByPlaceholder('输入备份密码').fill('mobile-test-passphrase')
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /导出/ }).click()
    const download = await downloadPromise
    if (!download.suggestedFilename().startsWith('aily-backup-')) throw new Error('Unexpected backup filename')
    await page.getByText('加密备份已导出，API Key 不包含在文件中', { exact: true }).waitFor()
    await page.screenshot({ path: new URL(`${label}-backup.png`, output).pathname })
    if (errors.length) throw new Error(errors.join('\n'))
    await context.close()
  }
} finally {
  await browser.close()
}
