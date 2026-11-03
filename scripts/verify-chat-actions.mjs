import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const baseline = process.env.BASELINE === '1'
const phase = baseline ? 'before' : 'after'
const evidenceDir = process.env.EVIDENCE_DIR || 'docs/evidence/chat-actions'
await mkdir(evidenceDir, { recursive: true })
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark', timezoneId: 'Asia/Shanghai' })
const page = await context.newPage()
const errors = []
const requests = []
page.on('pageerror', error => errors.push(error.message))
await page.route('https://api.deepseek.com/chat/completions', async route => {
  requests.push(route.request().postDataJSON())
  await route.fulfill({ contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"这是测试回复。"}}]}\n\ndata: [DONE]\n\n' })
})
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4197')
  await page.evaluate(async () => {
    const { db, persistChatChanges, saveSetting } = await import('/src/db.ts')
    const { acceptSafetyConsent } = await import('/src/privacy.ts')
    acceptSafetyConsent() // Adult/AI disclosure fixture in this isolated test only.
    await db.messages.clear()
    await saveSetting('onboarded', true)
    await saveSetting('selected', 'lu')
    await persistChatChanges('lu', [
      { id: 1, from: 'user', text: '周六去海边散步', time: '08:00', createdAt: '2026-01-01T00:00:00Z', status: 'sent' },
      { id: 2, from: 'character', text: '好，我们慢慢走。', time: '08:01', createdAt: '2026-01-01T00:01:00Z', status: 'sent' },
      { id: 3, from: 'user', text: 'Coffee on Sunday', time: '08:02', createdAt: '2026-01-01T00:02:00Z', status: 'sent' },
    ])
    await persistChatChanges('chen', [{ id: 1, from: 'user', text: '另一个角色的独立聊天', time: '08:00', status: 'sent' }])
    sessionStorage.setItem('aily-api-key', 'synthetic-test-key')
  })
  await page.reload()
  await page.getByRole('button', { name: '去找他' }).click()
  await page.getByRole('button', { name: '搜索消息' }).click()
  await page.getByRole('textbox', { name: '搜索聊天记录' }).fill('coffee')
  await page.screenshot({ path: `${evidenceDir}/${phase}-search.png` })
  if (!baseline) await page.getByText('找到 1 条消息').waitFor()
  await page.getByRole('button', { name: '搜索消息' }).click()
  const hiddenSearchRows = await page.locator('.message-row').count()
  if (!baseline) assert.equal(hiddenSearchRows, 3, 'closing search restores all rows')
  // Restore baseline via the explicit close button; both runs now share the same state.
  if (baseline) { await page.getByRole('button', { name: '搜索消息' }).click(); await page.getByRole('button', { name: '关闭', exact: true }).click() }
  await page.getByRole('button', { name: '引用消息 1', exact: true }).click()
  await page.getByRole('textbox', { name: '发消息' }).fill('就按这条安排')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await page.getByText('这是测试回复。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '停止回复' }).waitFor({ state: 'hidden' })
  if (!baseline) assert.match(requests[0].messages.at(-1).content, /引用消息.*周六去海边散步/s, 'quote reaches the actual transport')
  await page.getByRole('button', { name: '引用消息 1', exact: true }).click()
  await page.locator('.message-row').first().getByRole('button', { name: '撤回', exact: true }).click()
  await page.getByText('你撤回了一条消息', { exact: true }).waitFor()
  await page.screenshot({ path: `${evidenceDir}/${phase}-withdraw-quote.png` })
  if (!baseline) {
    assert.equal(await page.locator('.quoted-preview').count(), 0, 'withdrawn selected quote clears')
    await page.getByText('引用的消息已撤回', { exact: true }).waitFor()
    await page.getByRole('button', { name: '搜索消息' }).click()
    await page.getByRole('textbox', { name: '搜索聊天记录' }).fill('周六')
    await page.getByText('找到 0 条消息').waitFor()
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await page.reload()
    await page.getByRole('button', { name: '去找他' }).click()
    await page.getByText('你撤回了一条消息', { exact: true }).waitFor()
    await page.getByText('引用的消息已撤回', { exact: true }).waitFor()
    await page.getByRole('textbox', { name: '发消息' }).fill('继续聊吧')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await page.getByRole('button', { name: '停止回复' }).waitFor({ state: 'hidden' })
    assert(!JSON.stringify(requests.at(-1)).includes('周六去海边散步'), 'withdrawn quote is not sent again')
    await page.getByRole('button', { name: '返回消息' }).click()
    await page.getByRole('button', { name: /陈奕恒/ }).click()
    await page.getByRole('button', { name: '去找他' }).click()
    await page.getByText('另一个角色的独立聊天', { exact: true }).waitFor()
    assert.equal(await page.getByText('你撤回了一条消息', { exact: true }).count(), 0, 'role isolation')
  }
  assert.deepEqual(errors, [])
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  await writeFile(`${evidenceDir}/${phase}-result.json`, JSON.stringify({ phase, revision, viewport: '390x844', theme: 'dark', timezone: 'Asia/Shanghai', syntheticData: true, hiddenSearchRows, requests: requests.length, pageErrors: errors, result: baseline ? 'Baseline captured, known defects observed' : 'Search, quote transport, withdraw, reload and role isolation passed' }, null, 2) + '\n')
  console.log(`${phase}: application captures and chat action verification complete`)
} finally { await browser.close() }
