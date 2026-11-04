import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const browser = await chromium.launch()
const evidence = 'docs/evidence/profile-layout'
await mkdir(evidence, { recursive: true })
try {
  for (const [locale, width, height] of [['zh-CN', 390, 844], ['zh-CN', 320, 740], ['en', 390, 844], ['en', 320, 740]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'dark', timezoneId: 'Asia/Shanghai' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4175/')
    // Synthetic fixture in an isolated context, never touching the user's browser data.
    await page.evaluate(async locale => {
      const { saveSetting } = await import('/src/db.ts')
      await saveSetting('onboarded', true)
      await saveSetting('selected', 'gu')
      localStorage.setItem('aily.locale', locale)
      localStorage.setItem('aily-safety-consent-v1', 'adult-ai-privacy-accepted')
    }, locale)
    await page.reload()
    const zh = locale === 'zh-CN'
    await page.getByRole('button', { name: zh ? '我的' : 'Profile', exact: true }).click()
    await page.locator('.profile-screen').waitFor()
    assert.equal(await page.getByRole('combobox').count(), 0)
    assert.equal(await page.locator('.profile-screen > :first-child').getAttribute('class'), 'profile-card glass')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    // Check the title doesn't strand a single Chinese character on its final line.
    if (zh) {
      const lines = await page.locator('.plan-card h3').evaluate(element => {
        const node = element.firstChild
        const counts = new Map()
        for (let i = 0; i < node.textContent.length; i++) {
          const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1)
          const top = Math.round(range.getBoundingClientRect().top)
          counts.set(top, (counts.get(top) || 0) + 1)
        }
        return [...counts.values()]
      })
      assert.ok(lines.at(-1) > 1, `Orphan title: ${lines}`)
    }
    await page.screenshot({ path: `${evidence}/${locale}-${width}.png` })
    const language = page.getByRole('button', { name: zh ? '语言设置 简体中文' : 'Language settings English', exact: true })
    await language.click()
    await page.getByRole('combobox', { name: '界面语言 / Interface language' }).waitFor()
    await language.click()
    await page.getByRole('button', { name: zh ? 'DeepSeek 连接 演示模式' : 'DeepSeek connection Demo mode', exact: true }).click()
    await page.getByRole('textbox', { name: zh ? '接口地址' : 'API endpoint', exact: true }).waitFor()
    await page.getByRole('button', { name: zh ? 'DeepSeek 连接 演示模式' : 'DeepSeek connection Demo mode', exact: true }).click()
    await page.getByRole('button', { name: zh ? '编辑本机陪伴档案' : 'Edit local companion profile', exact: true }).click()
    await page.getByRole('button', { name: zh ? '保存偏好' : 'Save preferences', exact: true }).waitFor()
    assert.equal(await page.getByRole('combobox', { name: '界面语言 / Interface language' }).count(), 0)
    assert.equal(await page.getByText('中文 / English', { exact: true }).count(), 0)
    await page.getByRole('button', { name: zh ? '返回' : 'Back', exact: true }).click()
    await page.locator('.profile-screen').waitFor()
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    const bottomGap = await page.evaluate(() => document.querySelector('.bottom-nav').getBoundingClientRect().top - document.querySelector('.ai-note').getBoundingClientRect().bottom)
    assert.ok(bottomGap >= 16, `Bottom navigation overlap: ${bottomGap}`)
    assert.deepEqual(errors, [])
    console.log(`PASS: ${locale} ${width}px, ordered profile, collapsed settings, API/editor, no overflow or title orphan, bottom gap ${bottomGap}px, no browser errors`)
    await context.close()
  }
} finally { await browser.close() }
