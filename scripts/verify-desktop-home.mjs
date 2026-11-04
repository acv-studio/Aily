import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const evidence = 'docs/evidence/desktop-home'
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch()
try {
  for (const width of [390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, timezoneId: 'Asia/Shanghai', colorScheme: 'dark' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4175/')
    await page.evaluate(async () => {
      const { saveSetting } = await import('/src/db.ts')
      await saveSetting('onboarded', true)
      await saveSetting('selected', 'lu')
      localStorage.setItem('aily.locale', 'zh-CN')
      localStorage.setItem('aily-safety-consent-v1', 'adult-ai-privacy-accepted')
    })
    await page.reload()
    await page.locator('.desktop-app-grid').waitFor()
    assert.equal(await page.locator('.desktop-app-grid button').count(), 6)
    assert.deepEqual(await page.locator('.bottom-nav button').allTextContents(), ['消息', '记忆', '提醒', '我的'])
    const boxes = await Promise.all(['.clock-widget', '.weather-widget', '.desktop-bot', '.desktop-app-grid'].map(selector => page.locator(selector).boundingBox()))
    assert.ok(boxes[0].x < boxes[1].x, 'Clock left of weather')
    assert.ok(boxes[2].y > boxes[0].y && boxes[3].y > boxes[2].y, 'Bot and tools below widgets')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow')
    await page.screenshot({ path: `${evidence}/home-${width}.png` })
    // Deterministic weather API fixture, not a claim about real current conditions.
    await page.route('https://geocoding-api.open-meteo.com/**', route => route.fulfill({ json: { results: [{ name: '北京', latitude: 39.9, longitude: 116.4 }] } }))
    await page.route('https://api.open-meteo.com/**', route => route.fulfill({ json: { current: { time: '2026-11-04T14:45', temperature_2m: 18, apparent_temperature: 17, weather_code: 0, is_day: 1, wind_speed_10m: 8 } } }))
    await page.getByRole('button', { name: '搜索城市', exact: true }).click()
    await page.getByRole('textbox', { name: '搜索城市', exact: true }).fill('北京')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await page.locator('.weather-temperature').waitFor()
    assert.ok((await page.locator('.weather-temperature').textContent()).includes('18'))
    await page.screenshot({ path: `${evidence}/weather-fixture-${width}.png` })
    await page.getByRole('button', { name: '与陆听澜聊天', exact: true }).click()
    await page.getByRole('textbox', { name: '发消息' }).waitFor()
    await page.getByRole('button', { name: '返回消息', exact: true }).click()
    for (const label of ['记账', '相册', '通讯录', '音乐', '日记', '梅花易数']) {
      await page.locator('.desktop-app-grid').getByRole('button', { name: label, exact: true }).click()
      await page.getByRole('dialog').waitFor()
      assert.ok(await page.getByRole('dialog').evaluate(element => {
        const rect = element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(rect.x + 30, rect.y + 30))
      }), `${label}: dialog covers the app header`)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: no overflow`)
      await page.screenshot({ path: `${evidence}/tool-${label}-${width}.png` })
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'detached' })
    }
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}px: widgets, full-row main bot, six tools, chat, Escape, no overflow/errors`)
    await context.close()
  }
} finally { await browser.close() }
