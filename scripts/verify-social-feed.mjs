import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const before = process.argv.includes('--before')
const evidence = 'docs/evidence/social-feed'
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const url = process.env.AILY_URL || 'http://127.0.0.1:4193/'
  await page.goto(url)
  // Isolated browser fixture: same onboarded state for both revisions.
  await page.evaluate(async () => {
    const { saveSetting } = await import('/src/db.ts')
    await saveSetting('onboarded', true)
  })
  await page.reload()
  await page.getByRole('button', { name: '此刻', exact: true }).click()
  await page.locator('.moment').first().waitFor()
  await page.screenshot({ path: `${evidence}/${before ? 'before' : 'after'}-feed.png` })
  if (!before) {
    const card = page.locator('.moment').filter({ hasText: '陈奕恒' }).first()
    await card.getByRole('button', { name: '点赞', exact: true }).click()
    await card.getByRole('button', { name: '取消点赞', exact: true }).waitFor()
    await card.getByRole('button', { name: '评论', exact: true }).click()
    await page.getByRole('textbox', { name: '评论内容' }).fill('这片云很好看')
    await page.getByRole('button', { name: '发送评论', exact: true }).click()
    await card.locator('.moment-comment').getByText(/本机演示回应/).waitFor()
    await page.screenshot({ path: `${evidence}/after-comment.png` })
    await card.getByRole('button', { name: '私聊回应', exact: true }).click()
    await page.locator('.chat-header strong').filter({ hasText: '陈奕恒' }).waitFor()
    assert.match(await page.getByRole('textbox', { name: '发消息' }).inputValue(), /这片云很好看/)
    await page.getByRole('button', { name: '返回消息' }).click()
    await page.getByRole('button', { name: '此刻', exact: true }).click()
    await card.getByRole('button', { name: '取消点赞', exact: true }).waitFor()
    await page.reload()
    await page.getByRole('button', { name: '此刻', exact: true }).click()
    await card.getByRole('button', { name: '取消点赞', exact: true }).waitFor()
    await card.getByText('这片云很好看', { exact: true }).waitFor()
    await page.getByRole('combobox', { name: '动态角色' }).selectOption('gu')
    const count = await page.locator('.moment').count()
    await page.getByRole('button', { name: '生成动态', exact: true }).click()
    await page.waitForFunction(expected => document.querySelectorAll('.moment').length === expected, count + 1)
    assert.match(await page.locator('.moment').first().textContent(), /顾辰泽/)
    const other = await context.newPage()
    await other.goto(url)
    await other.getByRole('button', { name: '此刻', exact: true }).click()
    const otherCard = other.locator('.moment').filter({ hasText: '陈奕恒' }).first()
    await otherCard.getByRole('button', { name: '取消点赞', exact: true }).click()
    await card.getByRole('button', { name: '点赞', exact: true }).waitFor()
    await page.locator('.moment').first().getByRole('button', { name: '隐藏动态' }).click()
    await page.waitForFunction(expected => document.querySelectorAll('.moment').length === expected, count)
    await page.setViewportSize({ width: 320, height: 740 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    await page.screenshot({ path: `${evidence}/after-feed-320.png`, fullPage: true })
    await other.close()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(async () => {
      const { saveConversation, saveMemory } = await import('/src/db.ts')
      await saveConversation('gu', [{ id: 1, from: 'user', text: 'PRIVATE_BROWSER_CHAT', time: '现在' }])
      await saveMemory({ id: 'browser-private', characterId: 'gu', text: 'PRIVATE_BROWSER_MEMORY', confirmedAt: new Date().toISOString() })
      sessionStorage.setItem('aily-api-key', 'isolated-test-key')
    })
    const requests = []
    let fail = true
    await page.route('https://api.deepseek.com/chat/completions', async route => {
      const request = route.request().postDataJSON()
      requests.push(request)
      if (fail) { await route.fulfill({ status: 500, body: 'test failure' }); return }
      const reply = request.messages.at(-1).content.includes('回应一条朋友圈评论') ? '这本书留下了一个好问题。' : '翻过一页，留一点安静给自己。'
      await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n` })
    })
    await page.reload()
    await page.getByRole('button', { name: '此刻', exact: true }).click()
    await page.getByRole('combobox', { name: '动态角色' }).selectOption('gu')
    await page.locator('.moment').first().waitFor()
    const beforeAI = await page.locator('.moment').count()
    await page.getByRole('button', { name: '生成动态', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: /请求失败/ }).waitFor()
    assert.equal(await page.locator('.moment').count(), beforeAI)
    fail = false
    await page.getByRole('button', { name: '生成动态', exact: true }).click()
    await page.locator('.moment').first().getByText('AI 生成动态 · 虚构配图', { exact: true }).waitFor()
    const aiCard = page.locator('.moment').first()
    fail = true
    await aiCard.getByRole('button', { name: '评论', exact: true }).click()
    await page.getByRole('textbox', { name: '评论内容' }).fill('这本书怎么样？')
    await page.getByRole('button', { name: '发送评论', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: /请求失败/ }).waitFor()
    assert.equal(await aiCard.locator('.moment-comment').count(), 1)
    fail = false
    await aiCard.getByRole('button', { name: '重试回应', exact: true }).click()
    await aiCard.getByText('AI 生成回应', { exact: true }).waitFor()
    assert.equal(await aiCard.locator('.moment-comment').count(), 1)
    await page.screenshot({ path: `${evidence}/after-ai-reply.png` })
    assert.equal(requests.length, 4)
    for (const request of requests) {
      assert.equal(request.messages.length, 2)
      assert.match(request.messages[0].content, /顾辰泽/)
      assert.doesNotMatch(JSON.stringify(request), /PRIVATE_BROWSER_CHAT|PRIVATE_BROWSER_MEMORY/)
    }
    await page.reload()
    await page.getByRole('button', { name: '此刻', exact: true }).click()
    await page.locator('.moment').first().getByText('AI 生成回应', { exact: true }).waitFor()
  }
  assert.deepEqual(errors, [])
  console.log(before ? 'Captured actual baseline feed, 390x844 dark, isolated onboarded fixture.' : 'Social feed browser flow passed: generation, like, comment/reply, correct-role private chat, tab/reload persistence, cross-tab sync, hide, 320px layout, mocked model failures/retry/privacy and AI reply persistence.')
} finally { await browser.close() }
