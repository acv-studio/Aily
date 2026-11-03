import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const before = process.argv.includes('--before')
const evidence = 'docs/evidence/reply-modes'
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install({ time: new Date('2026-11-04T10:00:00+08:00') })
  await page.goto(process.env.AILY_URL || 'http://127.0.0.1:4327/')
  await page.getByRole('checkbox', { name: '我已年满 18 周岁', exact: true }).check()
  await page.getByRole('checkbox', { name: '我理解 AI 身份与数据说明' }).check()
  await page.getByRole('button', { name: '遇见 TA', exact: true }).click()
  await page.getByRole('button', { name: /开始我们的故事/ }).click()
  for (let step = 0; step < 5; step++) await page.getByRole('button', { name: '继续', exact: true }).click()
  await page.getByRole('button', { name: '发送试聊', exact: true }).click()
  await page.getByRole('button', { name: '称呼没问题，继续' }).click()
  await page.getByRole('button', { name: '完成引导', exact: true }).click()
  await page.getByRole('button', { name: /去找他/ }).click()
  await page.getByRole('region', { name: '聊天记录' }).waitFor()
  await page.screenshot({ path: `${evidence}/${before ? 'before' : 'after'}-chat.png`, fullPage: true })
  if (!before) {
    const modes = ['简短陪伴', '深入聊天', '剧情模式']
    for (const name of modes) {
      await page.getByRole('button', { name, exact: true }).click()
      await page.getByRole('button', { name, exact: true }).and(page.locator('[aria-pressed="true"]:not(:disabled)')).waitFor()
      await page.getByRole('textbox', { name: '发消息', exact: true }).fill('今天有些累，陪我聊聊')
      await page.getByRole('button', { name: '发送消息', exact: true }).click()
      await page.getByRole('button', { name: '停止回复' }).waitFor({ state: 'hidden' })
    }
    await page.getByText('【虚构场景 · 不记录剧情进度或新增记忆】', { exact: false }).waitFor()
    await page.screenshot({ path: `${evidence}/after-story.png`, fullPage: true })
    await page.reload()
    await page.getByRole('button', { name: /去找他/ }).click()
    assert.equal(await page.getByRole('button', { name: '剧情模式', exact: true }).getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: '临时会话', exact: true }).click()
    await page.getByRole('button', { name: '深入聊天', exact: true }).click()
    await page.getByRole('textbox', { name: '发消息', exact: true }).fill('你好')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await page.getByRole('button', { name: '停止回复' }).waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '结束临时会话', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '剧情模式', exact: true }).getAttribute('aria-pressed'), 'true')
    await page.setViewportSize({ width: 320, height: 740 })
    await page.screenshot({ path: `${evidence}/after-320.png`, fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    for (const name of modes) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox()
      assert.ok(box && box.width > 0 && box.height >= 44 && box.x >= 0 && box.x + box.width <= 320)
    }
  }
  assert.deepEqual(errors, [])
  console.log(before ? 'Captured actual pre-feature chat at 390x844 dark.' : 'Browser verification passed: three demo modes, refresh persistence, temporary isolation, 320px layout, no page errors.')
} finally { await browser.close() }
