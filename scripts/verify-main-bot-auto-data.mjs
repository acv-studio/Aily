import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
process.env.PLAYWRIGHT_BROWSERS_PATH ||= new URL('../.toolchains/playwright/', import.meta.url).pathname
const { webkit } = await import('playwright')
const url = process.env.AILY_APP_DATA_URL || 'http://127.0.0.1:5174'
const out = new URL('../.mobile-build/main-bot-auto-data/', import.meta.url)
await mkdir(out, { recursive: true })
const browser = await webkit.launch({ headless: true })
const results = []
try {
  for (const theme of ['dark', 'light']) for (const width of [402, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai' })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const errors = [], requests = []
    page.on('pageerror', error => errors.push(error.message))
    let failNext = false
    // Only the configured model endpoint is simulated. The real UI, database,
    // live provider registry, automatic host queries and gateway all run.
    await page.route('**/e2e-model/v1/chat/completions', async route => {
      const payload = route.request().postDataJSON()
      requests.push(payload)
      if (failNext) { failNext = false; await route.fulfill({ status: 503, body: 'offline' }); return }
      const answer = `验证回答 ${requests.length}：已根据本轮提供的数据完成回复。`
      await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n` })
    })
    await page.goto(url)
    await page.evaluate(async ({ theme, modelUrl }) => {
      const { finishOnboarding } = await import('/src/db.ts')
      const { defaultOnboardingProfile } = await import('/src/onboarding.ts')
      const { acceptSafetyConsent } = await import('/src/privacy.ts')
      const { setThemePreference } = await import('/src/theme.ts')
      await finishOnboarding(defaultOnboardingProfile('lu'), [])
      acceptSafetyConsent(); setThemePreference(theme)
      localStorage.setItem('aily.locale', 'zh-CN')
      sessionStorage.setItem('aily-api-key', 'e2e-isolated-test-key')
      localStorage.setItem('aily-api-endpoint', modelUrl)
      localStorage.setItem('aily-api-model', 'e2e-test')
      localStorage.setItem('aily-desktop-ledger', JSON.stringify([{ id: 'one', date: '2026-11-01', kind: 'expense', cents: 1234, note: 'SAVED-LEDGER-NOTE', category: 'food' }]))
      localStorage.setItem('aily-desktop-diary', JSON.stringify([{ id: 'one', date: '2026-11-01', text: 'SAVED-DIARY-TEXT', mood: 'good' }]))
    }, { theme, modelUrl: `${url}/e2e-model/v1/chat/completions` })
    await page.reload()
    await page.getByRole('button', { name: '与陆听澜聊天', exact: true }).click()
    await page.getByRole('button', { name: '聊天设置', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '读取应用数据', exact: true }).count(), 0)
    await page.getByText('主 Bot 普通聊天会自动查询应用已保存记录，并将相关数据发送给你配置的模型；临时会话和非主 Bot 不读取。', { exact: true }).waitFor()
    await page.getByRole('button', { name: '聊天设置', exact: true }).click()
    const send = async (question, answerNumber) => {
      await page.getByRole('textbox', { name: '发消息', exact: true }).fill(question)
      await page.getByRole('button', { name: '发送消息', exact: true }).click()
      await page.getByText(`验证回答 ${answerNumber}：已根据本轮提供的数据完成回复。`, { exact: false }).waitFor()
      assert.equal(await page.getByRole('dialog', { name: '主 Bot 应用数据', exact: true }).count(), 0)
      assert.equal(await page.getByRole('checkbox').count(), 0)
    }
    await send('帮我分析本月收支和日记', 1)
    assert.ok(JSON.stringify(requests[0]).includes('SAVED-LEDGER-NOTE'))
    assert.ok(JSON.stringify(requests[0]).includes('SAVED-DIARY-TEXT'))
    assert.ok(JSON.stringify(requests[0]).includes('1234'))
    // Install a new provider after chat is already open. No manual data scopes.
    await page.evaluate(async () => {
      const { registerMiniApp } = await import('/src/extensionRuntime.tsx')
      // Resolve the exact Vite dependency URL (including its HMR version) so
      // dynamic registration and installation share the running host registry.
      const runtimeSource = await fetch('/src/extensionRuntime.tsx').then(response => response.text())
      const dependency = runtimeSource.match(/from ["']([^"']*\/src\/extensionApps\.ts[^"']*)["']/)?.[1]
      assertDependency(dependency)
      const { setExtensionInstalled } = await import(dependency)
      function assertDependency(value) { if (!value) throw new Error('Could not resolve live extension registry') }
      registerMiniApp({ app: { id: 'e2e-water-log', name: '未来饮水本', english: 'Future water log', description: 'Test', englishDescription: 'Test', icon: 'W', color: '#abc', category: 'life' }, component: () => null, clearData: async () => {}, provider: { manifest: { id: 'e2e-water-log', name: '未来饮水本', english: 'Future water log', availability: 'installable', schemaVersion: 1, scopes: [{ id: 'entries', name: '饮水记录', english: 'Water entries', fields: ['title', 'note', 'count'], sensitive: true }] }, read: async () => ({ status: 'ok', records: [{ id: 'one', fields: { title: 'FUTURE-WATER-TITLE', note: 'FUTURE-WATER-NOTE' } }], summary: { count: 1 }, revision: 'stable', truncated: false }) } })
      setExtensionInstalled('e2e-water-log', true)
    })
    await send('帮我总结未来饮水本', 2)
    assert.ok(JSON.stringify(requests[1]).includes('FUTURE-WATER-NOTE'))
    assert.ok(!JSON.stringify(requests[1]).includes('SAVED-DIARY-TEXT'))
    await send('聊聊咖啡吧', 3)
    assert.ok(!JSON.stringify(requests[2]).includes('APP_DATA_JSON'))
    assert.ok(!JSON.stringify(requests[2]).includes('FUTURE-WATER-NOTE'))
    assert.ok(!JSON.stringify(requests[2]).includes('SAVED-LEDGER-NOTE'))
    failNext = true
    await page.getByRole('textbox', { name: '发消息', exact: true }).fill('分析我的收支')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    const retry = page.getByRole('button', { name: '回复未完成 · 重试', exact: true })
    await retry.waitFor()
    await page.evaluate(() => localStorage.setItem('aily-desktop-ledger', JSON.stringify([{ id: 'one', date: '2026-11-01', kind: 'expense', cents: 5678, note: 'FRESH-RETRY-NOTE', category: 'food' }])))
    await retry.click()
    await page.getByText('验证回答 5：已根据本轮提供的数据完成回复。', { exact: false }).waitFor()
    assert.ok(JSON.stringify(requests[4]).includes('5678'))
    assert.ok(JSON.stringify(requests[4]).includes('FRESH-RETRY-NOTE'))
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: new URL(`${theme}-${width}-automatic-chat.png`, out).pathname })
    assert.deepEqual(errors, [])
    results.push({ theme, width, automaticModelReads: true, futureAppDiscovered: true, noManualSetup: true, freshRetry: true, modelRequests: requests.length })
    await context.close()
  }
  await writeFile(new URL('results.json', out), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
} finally { await browser.close() }
