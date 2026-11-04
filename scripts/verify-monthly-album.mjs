import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const phase = process.env.AILY_PHASE || 'after'
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai', colorScheme: 'dark' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4321/')
  await page.evaluate(async () => {
    localStorage.setItem('aily.locale', 'zh-CN')
    const { clearAllData, saveSetting, saveMemory } = await import('/src/db.ts')
    const { acceptSafetyConsent } = await import('/src/privacy.ts')
    acceptSafetyConsent(); await clearAllData()
    await saveSetting('onboarded', true); await saveSetting('selected', 'lu')
    await saveMemory({ id: 'album-story', characterId: 'lu', text: '我们一起完成海边明信片故事', category: 'relationship', confirmedAt: '2026-10-30T10:00:00Z' })
    await saveMemory({ id: 'album-dinner', characterId: 'lu', text: '第一次一起做晚饭，选择了热汤和清淡小菜', category: 'relationship', confirmedAt: '2026-10-28T10:00:00Z' })
    await saveMemory({ id: 'album-private', characterId: 'lu', text: '我们讨论了我的抑郁诊断', sensitive: true, category: 'relationship', confirmedAt: '2026-10-28T10:00:00Z' })
    await saveMemory({ id: 'album-other', characterId: 'chen', text: '另一角色的秘密事件', category: 'relationship', confirmedAt: '2026-10-28T10:00:00Z' })
  })
  await page.reload()
  await mkdir('docs/evidence/monthly-album', { recursive: true })
  if (phase === 'before') {
    // The committed baseline throws before rendering App; capture it honestly, not a mockup.
    await page.screenshot({ path: 'docs/evidence/monthly-album/before-memories.png' })
    assert.ok(errors.includes('useI18n is not defined'))
    console.log('before: captured actual baseline startup failure (useI18n is not defined)')
    process.exitCode = 0
  } else {
    await page.getByRole('button', { name: '记忆', exact: true }).click()
    await page.getByRole('heading', { name: '我们一起完成海边明信片故事' }).waitFor()
    await page.evaluate(() => window.scrollTo(0, document.querySelector('.memory-view-switch').getBoundingClientRect().top + window.scrollY - 20))
    await page.screenshot({ path: `docs/evidence/monthly-album/${phase}-memories.png` })
    if (phase === 'after') {
    await page.getByRole('button', { name: '月度回忆册', exact: true }).click()
    assert.equal(await page.getByText('另一角色的秘密事件', { exact: true }).count(), 0)
    assert.equal(await page.getByText('我们讨论了我的抑郁诊断', { exact: true }).count(), 0)
    await page.locator('.monthly-album').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'docs/evidence/monthly-album/after-album.png' })
    await page.getByRole('button', { name: '预览分享内容', exact: true }).click()
    assert.equal((await page.locator('.album-preview pre').textContent()).includes('海边'), false)
    await page.locator('.album-preview').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'docs/evidence/monthly-album/after-preview.png' })
    await page.getByLabel('我已检查预览，确认可对外分享').check()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载回忆册', exact: true }).click()
    const download = await downloadPromise
    assert.equal(download.suggestedFilename(), 'aily-monthly-2026-10.txt')
    await page.getByRole('button', { name: '返回调整', exact: true }).click()
    await page.getByLabel('包含脱敏文字摘录（默认不包含）').check()
    await page.getByRole('button', { name: '预览分享内容', exact: true }).click()
    assert.match(await page.locator('.album-preview pre').textContent(), /海边明信片/)
    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: 844 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    }
    assert.equal(await page.evaluate(async () => (await import('/src/db.ts')).db.memories.count()), 4)
    }
  }
  if (phase === 'after') assert.deepEqual(errors, [])
  console.log(`${phase}: monthly album application checks and captures passed`)
} finally { await browser.close() }
