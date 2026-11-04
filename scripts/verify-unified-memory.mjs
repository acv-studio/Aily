import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

// Isolated browser profile; never reads or changes the user's stored memories.
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4175/')
  await page.evaluate(async () => {
    const { saveSetting, saveMemory, saveConversation } = await import('/src/db.ts')
    await saveSetting('onboarded', true)
    await saveSetting('selected', 'lu')
    localStorage.setItem('aily.locale', 'zh-CN')
    localStorage.setItem('aily-safety-consent-v1', 'adult-ai-privacy-accepted')
    await saveConversation('chen', [{ id: 42, from: 'user', text: '我喜欢篮球', time: '10:00', createdAt: '2026-11-04T02:00:00Z' }])
    for (const memory of [
      { id: 'unified-lu', characterId: 'lu', text: '我不吃辣', category: 'profile' },
      { id: 'unified-chen', characterId: 'chen', text: '我喜欢篮球', category: 'profile', sourceMessageId: 42 },
      { id: 'unified-gu', characterId: 'gu', text: '周末想去看海', category: 'context', state: 'pending', enabled: false },
    ]) await saveMemory({ confirmedAt: '2026-11-04T02:00:00Z', state: 'confirmed', enabled: true, ...memory })
  })
  await page.reload()
  await page.getByRole('button', { name: '记忆', exact: true }).click()
  await page.getByRole('heading', { name: '我的记忆', exact: true }).waitFor()
  assert.equal(await page.getByLabel('记忆角色', { exact: true }).count(), 0)
  for (const text of ['我不吃辣', '我喜欢篮球', '周末想去看海']) await page.getByRole('heading', { name: text, exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '编辑', exact: true }).first().isVisible(), false)
  await page.getByLabel('搜索记忆', { exact: true }).fill('篮球')
  assert.equal(await page.getByRole('heading', { name: '我不吃辣', exact: true }).count(), 0)
  await page.getByText('详情与管理', { exact: true }).click()
  await page.getByRole('button', { name: '查看来源', exact: true }).click()
  await page.getByText('#42 · 我喜欢篮球', { exact: true }).waitFor()
  await page.getByLabel('搜索记忆', { exact: true }).fill('')
  await page.getByLabel('记忆状态筛选', { exact: true }).selectOption('pending')
  assert.equal(await page.locator('.memory-page > article.managed-memory').count(), 1)
  await page.getByLabel('记忆状态筛选', { exact: true }).selectOption('all')
  await page.getByRole('button', { name: '关闭来源', exact: true }).click()
  for (const text of ['我不吃辣', '我喜欢篮球', '周末想去看海']) await page.getByRole('heading', { name: text, exact: true }).waitFor()
  await page.getByRole('heading', { name: '我的记忆', exact: true }).scrollIntoViewIfNeeded()
  await mkdir('docs/evidence/unified-memory', { recursive: true })
  await page.screenshot({ path: 'docs/evidence/unified-memory/desktop.png', fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'docs/evidence/unified-memory/mobile.png', fullPage: true, animations: 'disabled' })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  assert.deepEqual(errors, [])
  console.log('PASS: existing preview, unified role-free list, all-role search, source provenance, pending filter, collapsed controls, desktop/mobile layout; no browser errors.')
} finally {
  await browser.close()
}
