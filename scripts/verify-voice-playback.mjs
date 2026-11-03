import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// npm install; npx playwright install chromium
// BASELINE=1 BASE_URL=http://127.0.0.1:4191 node scripts/verify-voice-playback.mjs
// BASE_URL=http://127.0.0.1:4191 EVIDENCE_DIR=docs/evidence/voice-playback node scripts/verify-voice-playback.mjs
// A fresh, nonpersistent browser context contains only onboarding settings and our
// synthetic microphone recordings. No provider credentials or private history.
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4191'
const evidenceDir = path.resolve(process.env.EVIDENCE_DIR || 'docs/evidence/voice-playback')
const baseline = process.env.BASELINE === '1'
const phase = baseline ? 'before' : 'after'
const previewSelector = 'audio[aria-label="预听语音消息"]'
const messageSelector = 'audio[aria-label="播放语音消息"]'
const observations = []
const errors = []
let outcome = 'running'
let failure = null
await mkdir(evidenceDir, { recursive: true })
const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
  colorScheme: 'dark', timezoneId: 'Asia/Shanghai', permissions: ['microphone'],
})
const page = await context.newPage()
page.setDefaultTimeout(15_000)
page.on('pageerror', error => errors.push(error.message))

async function screenshot(name) {
  await page.screenshot({ path: path.join(evidenceDir, `${phase}-${name}.png`), fullPage: false })
}

// Read the actual persisted IndexedDB store; works with dev or preview builds.
async function storedMessages() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('aily')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction('conversationMessages', 'readonly')
      const all = transaction.objectStore('conversationMessages').getAll()
      all.onsuccess = () => resolve(all.result)
      all.onerror = () => reject(all.error)
      transaction.oncomplete = () => db.close()
    }
  }))
}

async function observe(locator, label) {
  await locator.waitFor({ state: 'visible' })
  const handle = await locator.elementHandle()
  assert(handle, `${label}: audio element exists`)
  const initial = await handle.evaluate(audio => {
    assertNative(audio)
    function assertNative(element) {
      if (!(element instanceof HTMLAudioElement) || !element.controls) throw new Error('Expected a real native audio element with controls')
    }
    audio.__voiceEvents = []
    for (const event of ['play', 'playing', 'pause', 'ended', 'seeking', 'seeked', 'error']) {
      audio.addEventListener(event, nativeEvent => audio.__voiceEvents.push({ event, time: audio.currentTime, trusted: nativeEvent.isTrusted }))
    }
    return { src: audio.currentSrc || audio.src, controls: audio.controls }
  })
  assert.match(initial.src, /^data:audio\//, `${label}: recorded audio data URL, not a fixture`)
  return { handle, label }
}

async function play(media) {
  // Invoke the browser's real native play(), never replace HTMLMediaElement methods,
  // fabricate events, or mock time/duration. Its promise rejects on decode failures.
  await media.handle.evaluate(audio => audio.play())
  await page.waitForFunction(audio => !audio.paused && audio.currentTime > 0.25 && !audio.error, media.handle)
}

async function pause(media) {
  await media.handle.evaluate(audio => audio.pause())
  await page.waitForFunction(audio => audio.paused && audio.__voiceEvents.some(item => item.event === 'pause'), media.handle)
  const time = await media.handle.evaluate(audio => audio.currentTime)
  await page.waitForTimeout(350)
  assert.equal(await media.handle.evaluate(audio => audio.currentTime), time, `${media.label}: native pause freezes playback position`)
}

async function playback(media) {
  await play(media)
  await pause(media)
  await play(media)
  // Recordings without a WebM duration header can report Infinity. Waiting for
  // natural EOF instead of seeking verifies decoding, native ended, and final state.
  await page.waitForFunction(audio => audio.ended && audio.paused, media.handle, { timeout: 20_000 })
  const duration = await media.handle.evaluate(audio => audio.duration)
  assert(Number.isFinite(duration) && duration > 0, `${media.label}: decoded EOF resolves finite duration`)
  await media.handle.evaluate(audio => { audio.currentTime = audio.duration / 2 })
  await page.waitForFunction(audio => !audio.seeking && Math.abs(audio.currentTime - audio.duration / 2) < 0.1 && audio.__voiceEvents.some(item => item.event === 'seeked'), media.handle)
  await play(media)
  await page.waitForFunction(audio => audio.ended && audio.paused, media.handle, { timeout: 20_000 })
  const result = await media.handle.evaluate(audio => ({
    currentTime: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : String(audio.duration),
    readyState: audio.readyState, error: audio.error?.message || null,
    events: audio.__voiceEvents.map(item => item.event),
    nativeEvents: audio.__voiceEvents.every(item => item.trusted),
  }))
  for (const event of ['play', 'playing', 'pause', 'ended', 'seeking', 'seeked']) assert(result.events.includes(event), `${media.label}: native ${event} event`)
  assert.equal(result.error, null)
  assert.equal(result.nativeEvents, true, `${media.label}: browser-generated media events, not synthetic dispatch`)
  assert(result.currentTime > 0.25, `${media.label}: actual decoded playback advances time`)
  observations.push({ label: media.label, ...result })
}

async function assertStopped(media, reason) {
  await page.waitForFunction(audio => audio.paused, media.handle, { timeout: 3000 })
  assert(await media.handle.evaluate(audio => audio.paused), `${reason}: detached audio is paused`)
  observations.push({ label: reason, paused: true, connected: await media.handle.evaluate(audio => audio.isConnected) })
}

async function record(activeMedia) {
  await page.getByRole('button', { name: '录制语音', exact: true }).click()
  await page.getByRole('button', { name: '结束录音', exact: true }).waitFor()
  if (activeMedia) await assertStopped(activeMedia, 'Starting microphone recording pauses active playback')
  // Real elapsed recording time; fake Chrome microphone supplies genuine PCM.
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: '结束录音', exact: true }).click()
  await page.getByRole('button', { name: '录制语音', exact: true }).waitFor()
  await page.getByRole('button', { name: '移除', exact: true }).waitFor()
}

try {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('voice-verification-seeded')) {
      localStorage.setItem('aily-demo-state', JSON.stringify({
        onboarded: true, selected: 'lu', conversations: { lu: [] }, confirmedMemories: [],
      }))
      sessionStorage.setItem('voice-verification-seeded', '1')
    }
  })
  await page.goto(baseURL)
  await page.getByRole('button', { name: '去找他', exact: true }).click()
  assert.deepEqual(await storedMessages(), [], 'Only onboarding was seeded; no chat content or audio fixtures')
  assert(await page.evaluate(() => !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'), 'Secure localhost/HTTPS with real MediaRecorder is required')

  await record()
  await screenshot('preview')
  let preview
  if (!baseline) {
    preview = await observe(page.locator(previewSelector), 'recording preview')
    await playback(preview)
    await play(preview)
  }
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await page.locator(messageSelector).waitFor()
  if (!baseline) {
    await page.locator(previewSelector).waitFor({ state: 'detached' })
    await assertStopped(preview, 'Sending unmounts and pauses preview')
  }
  const stored = await storedMessages()
  assert.equal(stored.length, 1)
  const recording = stored[0]
  assert.equal(recording.kind, 'audio')
  assert.equal(recording.status, 'sent')
  assert.equal(recording.from, 'user')
  assert.match(recording.attachment.mimeType, /^audio\//)
  assert.match(recording.attachment.dataUrl, /^data:audio\/[^;]+;base64,/)
  assert(Buffer.from(recording.attachment.dataUrl.split(',')[1], 'base64').length > 1000, 'Nonempty real recorded media persisted')
  let message = await observe(page.locator(messageSelector), 'sent message')
  await playback(message)
  await screenshot('chat')

  // The same scenario and viewport in baseline mode; only new preview behavior
  // is skipped. Persisted audio and withdrawal checks remain genuine assertions.
  if (!baseline) await play(message)
  await record(baseline ? undefined : message)
  if (!baseline) {
    const secondPreview = await observe(page.locator(previewSelector), 'second recording preview')
    await play(message)
    await play(secondPreview)
    await assertStopped(message, 'Preview playback pauses message (exclusive playback)')
    await play(message)
    await assertStopped(secondPreview, 'Message playback pauses preview (exclusive playback)')
    await play(secondPreview)
    await page.getByRole('button', { name: '移除', exact: true }).click()
    await page.locator(previewSelector).waitFor({ state: 'detached' })
    await assertStopped(secondPreview, 'Removing draft unmounts and pauses preview')
    await play(message)
    await page.getByRole('button', { name: '返回消息', exact: true }).click()
    await assertStopped(message, 'Leaving chat unmounts and pauses message')
    await page.getByRole('button', { name: '去找他', exact: true }).click()
    // Deliberately corrupt only this live DOM source, not stored recording data.
    // The browser must generate its own real decode error and React must expose it.
    await page.locator(messageSelector).evaluate(audio => {
      audio.src = 'data:audio/webm;base64,SW52YWxpZCBhdWRpbyBkYXRh'
      audio.load()
    })
    await page.getByRole('alert').filter({ hasText: '无法播放这段语音' }).waitFor()
    assert(await page.locator(messageSelector).evaluate(audio => !!audio.error), 'Browser generates real invalid-media error')
    observations.push({ label: 'Real decode error exposes visible playback feedback', passed: true })
  } else {
    await page.getByRole('button', { name: '移除', exact: true }).click()
    await page.getByRole('button', { name: '返回消息', exact: true }).click()
    await page.getByRole('button', { name: '去找他', exact: true }).click()
  }

  await page.reload()
  await page.getByRole('button', { name: '去找他', exact: true }).click()
  const reloaded = await storedMessages()
  assert.equal(reloaded.length, 1, 'Discarded preview never persisted')
  assert.equal(reloaded[0].attachment.dataUrl, recording.attachment.dataUrl, 'Exact recording survives refresh')
  message = await observe(page.locator(messageSelector), 'refreshed persisted message')
  await playback(message)
  await screenshot('refresh')
  await play(message)
  await page.locator('.message-row').filter({ has: page.locator(messageSelector) }).getByRole('button', { name: '撤回', exact: true }).click()
  await page.getByText('你撤回了一条消息', { exact: true }).waitFor()
  await page.locator(messageSelector).waitFor({ state: 'detached' })
  await assertStopped(message, 'Withdrawal unmounts and pauses active message')
  const withdrawn = (await storedMessages())[0]
  assert.equal(withdrawn.withdrawn, true)
  assert.equal(withdrawn.attachment, undefined, 'Withdrawal removes persisted media payload')
  await screenshot('withdrawn')
  await page.reload()
  await page.getByRole('button', { name: '去找他', exact: true }).click()
  await page.getByText('你撤回了一条消息', { exact: true }).waitFor()
  assert.equal(await page.locator(messageSelector).count(), 0, 'Withdrawn audio does not return on refresh')
  assert.deepEqual(errors, [], 'No uncaught browser errors')
  outcome = 'passed'
  console.log(`Voice playback ${phase} verification passed: real fake-mic recording, ${baseline ? 'baseline (preview skipped)' : 'preview, exclusive playback, cleanup'}, send, native play/pause/ended, IndexedDB refresh, withdrawal cleanup. Evidence: ${evidenceDir}`)
} catch (error) {
  outcome = 'failed'
  failure = error instanceof Error ? error.message : String(error)
  await screenshot('failure').catch(() => {})
  throw error
} finally {
  await writeFile(path.join(evidenceDir, `${phase}-results.json`), JSON.stringify({ baseURL, phase, outcome, failure, viewport: { width: 390, height: 844 }, observations, errors }, null, 2))
  await browser.close()
}
