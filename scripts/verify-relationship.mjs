import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const before = process.argv.includes('--before')
const dir = 'docs/evidence/relationship'
await mkdir(dir, { recursive: true })
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(process.env.AILY_URL || 'http://127.0.0.1:4196/')
  await page.evaluate(async () => {
    const { db, finishOnboarding } = await import('/src/db.ts')
    const { defaultOnboardingProfile } = await import('/src/onboarding.ts')
    const { acceptSafetyConsent } = await import('/src/privacy.ts')
    acceptSafetyConsent()
    await finishOnboarding({ ...defaultOnboardingProfile('lu'), userName: '小雨' }, [])
    await db.memories.bulkPut(Array.from({ length: 8 }, (_, i) => ({ id: `event-${i}`, characterId: 'lu', text: `一起散步时分享的回忆 ${String.fromCharCode(65 + i)}`, category: 'relationship', state: 'confirmed', enabled: true, confirmedAt: '2026-01-01T12:00:00Z' })))
  })
  await page.reload()
  await page.getByRole('button', { name: '去找他', exact: true }).waitFor()
  await page.getByRole('button', { name: '回忆', exact: true }).click()
  await page.getByLabel('记忆角色').waitFor()
  await page.screenshot({ path: `${dir}/${before ? 'before' : 'after'}-intimate.png`, fullPage: true })
  if (!before) {
    const card = page.getByRole('region', { name: '关系阶段' })
    assert.match(await card.innerText(), /亲密/)
    assert.doesNotMatch(await card.innerText(), /\d|%|好感度|还差/)
    await page.getByLabel('专属称呼', { exact: true }).fill('雨宝')
    await page.getByLabel('同意这位角色使用专属称呼').check()
    await page.getByRole('button', { name: '保存专属称呼' }).click()
    await page.getByRole('status').filter({ hasText: '称呼已保存' }).waitFor()
    await page.reload()
    await page.getByRole('button', { name: '回忆', exact: true }).click()
    assert.equal(await page.getByLabel('专属称呼', { exact: true }).inputValue(), '雨宝')
    await page.screenshot({ path: `${dir}/after-saved.png`, fullPage: true })
    await page.getByLabel('记忆角色').selectOption('chen')
    await page.getByText('亲密阶段解锁，由你决定是否使用。', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('专属称呼', { exact: true }).count(), 0)
    await page.screenshot({ path: `${dir}/after-locked.png`, fullPage: true })
    await page.getByLabel('记忆角色').selectOption('lu')
    await page.setViewportSize({ width: 320, height: 740 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `${dir}/after-320.png`, fullPage: true })
  }
  assert.deepEqual(errors, [])
  console.log(before ? 'Real baseline captured.' : 'Relationship browser journey passed: state/events, no score, nickname save/reload, locked other role, narrow viewport.')
} finally { await browser.close() }
