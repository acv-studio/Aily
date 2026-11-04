import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const browser = await chromium.launch()
const evidence = 'docs/evidence/primary-character'
await mkdir(evidence, { recursive: true })
try {
  for (const [locale, width, height] of [['zh-CN', 390, 844], ['zh-CN', 320, 740], ['en', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4175/')
    // Fixtures are isolated from the user's browser and database.
    await page.evaluate(async locale => {
      const { saveSetting, saveConversation, saveMemory } = await import('/src/db.ts')
      const { defaultOnboardingProfile } = await import('/src/onboarding.ts')
      await saveSetting('onboarded', true)
      await saveSetting('selected', 'lu')
      await saveSetting('onboardingProfile', { ...defaultOnboardingProfile('lu'), userName: '小雨', blockedTopics: '隐私话题' })
      await saveConversation('chen', [{ id: 1, from: 'user', text: '恒的独立聊天', time: '12:00' }])
      await saveConversation('gu', [{ id: 1, from: 'user', text: '泽的独立聊天', time: '12:00' }])
      await saveMemory({ id: 'test-memory', characterId: 'chen', text: '原有关系回忆', category: 'relationship', state: 'confirmed', confirmedAt: new Date().toISOString() })
      localStorage.setItem('aily.locale', locale)
      localStorage.setItem('aily-safety-consent-v1', 'adult-ai-privacy-accepted')
    }, locale)
    await page.reload()
    const zh = locale === 'zh-CN'
    await page.getByRole('button', { name: zh ? '我的' : 'Profile', exact: true }).click()
    const trigger = page.locator('.profile-setting-row').first()
    await trigger.click()
    assert.equal(await page.getByRole('radio').count(), 3)
    assert.equal(await page.getByRole('radio').first().isChecked(), true)
    await page.getByRole('radio').nth(1).click()
    await page.waitForFunction(async () => {
      const data = await (await import('/src/db.ts')).loadLocalData()
      return data.settings.selected === 'chen' && data.settings.onboardingProfile.characterId === 'chen'
    })
    assert.equal(await page.getByRole('radio').nth(1).isChecked(), true)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: `${evidence}/${locale}-${width}.png` })
    await page.getByRole('button', { name: zh ? '消息' : 'Messages', exact: true }).click()
    await page.locator('.desktop-bot').waitFor()
    assert.match(await page.locator('.desktop-bot').textContent(), /恒的独立聊天/)
    await page.reload()
    await page.locator('.desktop-bot').waitFor()
    assert.match(await page.locator('.desktop-bot').textContent(), /恒的独立聊天/)
    const stored = await page.evaluate(async () => (await (await import('/src/db.ts')).loadLocalData()))
    assert.equal(stored.settings.onboardingProfile.userName, '小雨')
    assert.equal(stored.settings.onboardingProfile.blockedTopics, '隐私话题')
    assert.equal(stored.conversations.chen[0].text, '恒的独立聊天')
    assert.equal(stored.conversations.gu[0].text, '泽的独立聊天')
    assert.equal(stored.memories.find(memory => memory.id === 'test-memory').text, '原有关系回忆')
    assert.deepEqual(errors, [])
    console.log(`PASS ${locale} ${width}px: three choices, saved selection, home synchronization, reload, independent history, preserved preferences and memories, no overflow or runtime errors`)
    await context.close()
  }
} finally { await browser.close() }
