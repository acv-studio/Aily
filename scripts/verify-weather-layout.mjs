import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const evidence = 'docs/evidence/weather-layout'
await mkdir(evidence, { recursive: true })
const browser = await chromium.launch()
try {
  for (const width of [320, 390, 480, 892]) {
    for (const locale of ['zh-CN', 'en']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Shanghai' })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4175/')
      await page.evaluate(async locale => {
        const { saveSetting } = await import('/src/db.ts')
        await saveSetting('onboarded', true)
        await saveSetting('selected', 'lu')
        localStorage.setItem('aily.locale', locale)
        localStorage.setItem('aily-safety-consent-v1', 'adult-ai-privacy-accepted')
      }, locale)
      await page.reload()
      await page.locator('.weather-actions').waitFor()
      async function check(state) {
        const geometry = await page.evaluate(() => {
          const clock = document.querySelector('.clock-widget').getBoundingClientRect()
          const weather = document.querySelector('.weather-widget').getBoundingClientRect()
          const grid = document.querySelector('.desktop-widgets').getBoundingClientRect()
          const elements = [...document.querySelectorAll('.weather-widget *')]
          return {
            equalWidth: Math.abs(clock.width - weather.width) < 1,
            equalHeight: Math.abs(clock.height - weather.height) < 1,
            aligned: Math.abs(clock.y - weather.y) < 1 && Math.abs(weather.right - grid.right) < 1,
            contained: elements.every(element => {
              const rect = element.getBoundingClientRect()
              return rect.left >= weather.left && rect.right <= weather.right + 1 && rect.top >= weather.top && rect.bottom <= weather.bottom + 1
            }),
            overflow: document.documentElement.scrollWidth > innerWidth,
            buttonsFit: [...document.querySelectorAll('.weather-actions button')].every(button => button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight),
          }
        })
        for (const key of ['equalWidth', 'equalHeight', 'aligned', 'contained', 'buttonsFit']) assert.ok(geometry[key], `${width}/${locale}/${state}: ${key}`)
        assert.equal(geometry.overflow, false, `${width}/${locale}/${state}: no horizontal overflow`)
      }
      await check('empty')
      await page.screenshot({ path: `${evidence}/empty-${width}-${locale}.png` })
      const cityButton = locale === 'en' ? 'Search city' : '搜索城市'
      const submitButton = locale === 'en' ? 'Search' : '搜索'
      await page.getByRole('button', { name: cityButton, exact: true }).click()
      await check('search')
      await page.route('https://geocoding-api.open-meteo.com/**', route => route.fulfill({ json: { results: [{ name: 'A very long city name for layout verification', latitude: 31.2, longitude: 121.4 }] } }))
      await page.route('https://api.open-meteo.com/**', route => route.fulfill({ json: { current: { time: '2026-11-04T15:00', temperature_2m: -12, apparent_temperature: -18, weather_code: 3, is_day: 1, wind_speed_10m: 28 } } }))
      await page.getByRole('textbox', { name: cityButton, exact: true }).fill('Shanghai')
      await page.getByRole('button', { name: submitButton, exact: true }).click()
      await page.locator('.weather-temperature').waitFor()
      await check('loaded')
      await page.screenshot({ path: `${evidence}/loaded-${width}-${locale}.png` })
      await page.route('https://api.open-meteo.com/**', route => route.abort())
      await page.locator('.weather-widget-header button').click()
      await page.locator('.weather-placeholder [role="alert"]').waitFor()
      await check('error')
      assert.deepEqual(errors, [])
      console.log(`PASS ${width}px/${locale}: empty, search, loaded, error; equal cards, contained content, no overflow`)
      await context.close()
    }
  }
} finally { await browser.close() }
