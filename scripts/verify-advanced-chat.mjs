import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const browser = await chromium.launch()
const viewport = { width: 390, height: 844 }
const errors = []
async function open(url) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await page.getByRole('button', { name: /遇见 TA/ }).click()
  await page.getByRole('button', { name: /开始我们的故事/ }).click()
  return page
}
try {
  const baseline = await open(process.env.AILY_BASELINE_URL || 'http://127.0.0.1:4187')
  await baseline.getByRole('button', { name: '去找他' }).click()
  await baseline.screenshot({ path: 'docs/evidence/advanced-chat/before-chat.png' })
  await baseline.getByRole('button', { name: '返回消息' }).click()
  await baseline.getByRole('button', { name: '我的', exact: true }).click()
  await baseline.screenshot({ path: 'docs/evidence/advanced-chat/before-settings.png', fullPage: true })
  const page = await open(process.env.AILY_URL || 'http://127.0.0.1:4186')
  await page.getByRole('button', { name: '去找他' }).click()
  await page.screenshot({ path: 'docs/evidence/advanced-chat/after-chat.png' })
  await page.getByText('语音与通话', { exact: true }).click()
  await page.getByRole('button', { name: '开始听写' }).waitFor()
  await page.screenshot({ path: 'docs/evidence/advanced-chat/after-speech-controls.png' })
  await page.getByRole('button', { name: '返回消息' }).click()
  await page.getByRole('button', { name: '我的', exact: true }).click()
  await page.getByRole('heading', { name: '主动陪伴 · 本地定时提醒' }).waitFor()
  assert.equal(await page.getByRole('checkbox', { name: '开启本地定时提醒' }).isChecked(), false)
  await page.screenshot({ path: 'docs/evidence/advanced-chat/after-settings.png', fullPage: true })
  // Contract verification only: this fixture Key and response are not a live service test.
  await page.evaluate(() => { sessionStorage.setItem('aily-api-key', 'mock-browser-test-only'); localStorage.setItem('aily-api-model', 'deepseek-flash') })
  await page.reload()
  const requests = []
  await page.route('https://api.deepseek.com/chat/completions', async route => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"模拟识图回复 · 非真实服务验证"}}]}\n\ndata: [DONE]\n\n' })
  })
  await page.getByRole('button', { name: '去找他' }).click()
  const photo = { name: 'test.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhM0AAAAASUVORK5CYII=', 'base64') }
  const file = page.locator('input[type=file]').first()
  await file.setInputFiles(photo)
  await page.getByText(/待发送：test.png/).waitFor()
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await page.getByText(/图片已保存在本机，没有发送给模型/).waitFor()
  assert.equal(requests.length, 0)
  await file.setInputFiles(photo)
  await page.getByRole('checkbox', { name: /同意将本次图片/ }).check()
  await page.getByRole('textbox', { name: '发消息' }).fill('这个像素是什么颜色？')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await page.getByText('模拟识图回复 · 非真实服务验证', { exact: true }).waitFor()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].model, 'deepseek-flash')
  assert.equal(requests[0].messages.at(-1).content[1].type, 'image_url')
  assert.equal(requests[0].messages.filter(message => Array.isArray(message.content)).length, 1)
  await page.getByRole('textbox', { name: '发消息' }).fill('谢谢')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await page.getByRole('button', { name: '停止回复' }).waitFor({ state: 'hidden' })
  assert.equal(requests.length, 2)
  assert.equal(requests[1].messages.some(message => Array.isArray(message.content)), false)
  await page.reload()
  await page.getByRole('button', { name: '去找他' }).click()
  assert.equal(await page.getByRole('img', { name: 'test.png', exact: true }).count(), 2)
  assert.deepEqual(errors, [])
  console.log('Browser contract checks passed: local photo default, explicit vision upload, configured model, no historical image upload, persisted photos; actual matched visual evidence captured. No live API calls or real audio test.')
} finally { await browser.close() }
