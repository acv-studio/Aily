import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const evidenceDir = 'docs/evidence/chat-actions'
await mkdir(evidenceDir, { recursive: true })
const browser = await chromium.launch()
try {
  for (const [phase, url] of [['before', process.env.BASELINE_URL || 'http://127.0.0.1:43917'], ['after', process.env.BASE_URL || 'http://127.0.0.1:4197']]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark', timezoneId: 'Asia/Shanghai' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(url)
    await page.getByText('会生长', { exact: true }).waitFor()
    if (phase === 'after') await page.getByRole('button', { name: '遇见 TA', exact: true }).waitFor()
    if (errors.length) throw new Error(`${phase}: ${errors.join(', ')}`)
    await page.screenshot({ path: `${evidenceDir}/${phase}-welcome.png`, fullPage: true })
    await context.close()
  }
  console.log('Original and integrated welcome screens captured from actual apps')
} finally { await browser.close() }
