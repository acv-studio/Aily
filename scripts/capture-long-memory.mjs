import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
const browser = await chromium.launch()
const phase = process.env.AILY_PHASE || 'before'
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, timezoneId: 'Asia/Shanghai', colorScheme: 'dark' })
  await page.goto(process.env.AILY_URL || 'http://127.0.0.1:4174/')
  await page.evaluate(async () => {
    const { clearAllData, saveSetting, saveMemory, saveConversation } = await import('/src/db.ts')
    await clearAllData()
    await saveSetting('onboarded', true)
    await saveSetting('selected', 'lu')
    await saveMemory({ id: 'evidence-diet', characterId: 'lu', text: '我喜欢清淡晚饭，不吃辣', category: 'profile', confirmedAt: '2026-01-01T10:00:00.000Z', sourceMessageId: 1 })
    await saveConversation('lu', [{ id: 1, from: 'user', text: '我喜欢清淡晚饭，不吃辣', time: '18:00', createdAt: '2026-01-01T10:00:00.000Z', status: 'sent' }, { id: 2, from: 'character', text: '好的，晚饭会照顾你的口味。', time: '18:01', createdAt: '2026-01-01T10:01:00.000Z', status: 'sent' }, { id: 3, from: 'user', text: '记住，我想在项目结束后去看海', time: '18:02', createdAt: '2026-11-01T10:02:00.000Z', status: 'sent' }])
  })
  await page.reload()
  await page.getByRole('button', { name: '回忆', exact: true }).click()
  await page.getByText('我喜欢清淡晚饭，不吃辣', { exact: true }).waitFor()
  if (phase === 'after') await page.getByRole('heading', { name: '记住，我想在项目结束后去看海', exact: true }).waitFor()
  await mkdir('docs/evidence/long-memory', { recursive: true })
  await page.screenshot({ path: `docs/evidence/long-memory/${phase}-memory.png` })
  await page.locator('article').filter({ has: page.getByRole('heading', { name: '我喜欢清淡晚饭，不吃辣', exact: true }) }).getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByRole('heading', { name: '纠正长期记忆' }).waitFor()
  await page.screenshot({ path: `docs/evidence/long-memory/${phase}-editor.png` })
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '消息', exact: true }).click()
  await page.getByRole('button', { name: '去找他' }).click()
  await page.getByText('记住，我想在项目结束后去看海', { exact: true }).waitFor()
  await page.screenshot({ path: `docs/evidence/long-memory/${phase}-chat.png` })
  console.log(`Captured ${phase} actual app: 390x844 dark, lu, identical synthetic history and memory.`)
} finally { await browser.close() }
