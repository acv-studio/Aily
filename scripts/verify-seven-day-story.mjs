import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const before = process.argv.includes('--before')
const evidence = 'docs/evidence/seven-day-story'
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install({ time: new Date('2026-11-04T10:00:00+08:00') })
  await page.goto(process.env.AILY_URL || 'http://127.0.0.1:4191/')
  await page.getByRole('button', { name: /遇见 TA/ }).click()
  await page.getByRole('button', { name: /开始我们的故事/ }).click()
  const openStory = async () => {
    await page.getByRole('button', { name: /去找他/ }).click()
    await page.getByRole('button', { name: /共同故事/ }).click()
  }
  await openStory()
  await page.getByRole('heading', { name: '下班后的晚饭', exact: true }).waitFor()
  await page.screenshot({ path: `${evidence}/${before ? 'before' : 'after'}-day1.png`, fullPage: true })
  if (!before) {
    await page.getByRole('button', { name: '开始这一章' }).click()
    await page.getByRole('button', { name: /从背后抱住他/ }).click()
    await page.getByRole('button', { name: '确认保存选择与回忆' }).click()
    await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
    await page.getByRole('button', { name: '关闭故事' }).click()
    await page.reload()
    await openStory()
    await page.getByText('明天再续写下一章').waitFor()
    await page.screenshot({ path: `${evidence}/after-waiting.png`, fullPage: true })
    await page.getByRole('button', { name: '回看第 1 天：下班后的晚饭' }).click()
    await page.getByText('你的选择：从背后抱住他').waitFor()
    await page.getByRole('button', { name: '关闭故事' }).click()
    for (let day = 2; day <= 7; day++) {
      await page.clock.setSystemTime(new Date(`2026-11-${String(day + 3).padStart(2, '0')}T10:00:00+08:00`))
      await page.reload()
      await openStory()
      await page.getByRole('button', { name: '开始这一章' }).click()
      await page.locator('.story-choices button').nth((day - 1) % 2).click()
      await page.getByRole('button', { name: '确认保存选择与回忆' }).click()
      await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
      if (day === 7) {
        await page.screenshot({ path: `${evidence}/after-finale.png`, fullPage: true })
        await page.locator('.seven-day-sheet').evaluate(sheet => { sheet.scrollTop = sheet.scrollHeight })
        await page.screenshot({ path: `${evidence}/after-finale-recap.png`, fullPage: true })
      }
      await page.getByRole('button', { name: '关闭故事' }).click()
    }
    await page.reload()
    await openStory()
    await page.getByText('七天篇章已完成').waitFor()
    await page.setViewportSize({ width: 320, height: 740 })
    await page.screenshot({ path: `${evidence}/after-complete-320.png`, fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.getByRole('button', { name: '关闭故事' }).click()
    await page.getByRole('button', { name: '返回消息', exact: true }).click()
    await page.getByRole('button', { name: '回忆', exact: true }).click()
    await page.getByText(/与陆听澜完成/).first().waitFor()
    const memories = await page.evaluate(async () => {
      const database = await new Promise((resolve, reject) => { const request = indexedDB.open('aily'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      return new Promise((resolve, reject) => { const request = database.transaction('memories').objectStore('memories').getAll(); request.onsuccess = () => { database.close(); resolve(request.result) }; request.onerror = () => reject(request.error) })
    })
    assert.equal(memories.filter(memory => memory.id.startsWith('sevenDayStory:lu:')).length, 7)
  }
  assert.deepEqual(errors, [])
  console.log(before ? 'Captured real baseline day 1, 390x844 dark.' : 'Seven-day story browser journey passed: seven dates, reload, replay, waiting, finale, memories and 320px layout.')
} finally { await browser.close() }
