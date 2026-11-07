import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
process.env.PLAYWRIGHT_BROWSERS_PATH ||= new URL('../.toolchains/playwright/', import.meta.url).pathname
const { webkit } = await import('playwright')
const before = process.argv.includes('--before')
const url = process.env.AILY_APP_DATA_URL || 'http://127.0.0.1:5174'
const out = new URL('../.mobile-build/app-data-mobile/', import.meta.url)
await mkdir(out, { recursive: true })
const browser = await webkit.launch({ headless: true })
const results = []
try {
  for (const theme of ['dark', 'light']) {
    for (const width of [402, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(url)
      await page.evaluate(async mode => {
        const { finishOnboarding } = await import('/src/db.ts')
        const { defaultOnboardingProfile } = await import('/src/onboarding.ts')
        const { acceptSafetyConsent } = await import('/src/privacy.ts')
        const { setThemePreference } = await import('/src/theme.ts')
        await finishOnboarding(defaultOnboardingProfile('lu'), [])
        acceptSafetyConsent(); setThemePreference(mode)
        localStorage.setItem('aily.locale', 'zh-CN')
        localStorage.setItem('aily-desktop-ledger', JSON.stringify([{ id: 'one', date: '2026-11-01', kind: 'expense', cents: 1234, note: 'PRIVATE-NOTE' }]))
      }, theme)
      await page.reload()
      await page.getByRole('button', { name: '与陆听澜聊天', exact: true }).click()
      await page.getByRole('button', { name: '聊天设置', exact: true }).click()
      await page.getByRole('button', { name: '读取应用数据', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '主 Bot 应用数据', exact: true })
      await dialog.getByLabel('要问主 Bot 的问题', { exact: true }).fill('总结我的收支')
      await dialog.getByLabel('开始日期（可选）', { exact: true }).fill('2026-11-01')
      await dialog.getByLabel('结束日期（不含当天，可选）', { exact: true }).fill('2026-12-01')
      const checkbox = dialog.getByRole('checkbox', { name: '收支汇总（不含备注）', exact: true })
      await checkbox.tap()
      assert.equal(await checkbox.isChecked(), true)
      // Tap the label text, not only the small native checkbox.
      await checkbox.locator('..').locator('span').tap()
      assert.equal(await checkbox.isChecked(), false)
      await checkbox.locator('..').locator('span').tap()
      assert.equal(await checkbox.isChecked(), true)
      const styles = await dialog.evaluate(root => {
        const panel = root.querySelector('.app-data-panel')
        const body = root.querySelector('.chat-extra-body')
        const dates = root.querySelector('.app-data-dates')
        const bounds = root.getBoundingClientRect()
        const controls = [...panel.querySelectorAll('textarea,input[type=text],input[type=date],fieldset')]
        return { textColor: getComputedStyle(panel).color, themeColor: getComputedStyle(document.body).color, scrollWidth: body.scrollWidth, clientWidth: body.clientWidth, datesWidth: dates.getBoundingClientRect().width, clipped: controls.filter(el => { const r = el.getBoundingClientRect(); return r.left < bounds.left || r.right > bounds.right }).map(el => el.tagName + ':' + el.type), inert: !!checkboxAncestor(root) }
        function checkboxAncestor(root) { return root.querySelector('input[type=checkbox]').closest('[inert]') }
      })
      const buttons = await dialog.locator('.app-data-actions button').evaluateAll(elements => elements.map(el => { const s = getComputedStyle(el); return { color: s.color, background: s.backgroundColor, appearance: s.webkitAppearance } }))
      if (process.argv.includes('--debug')) console.log(await dialog.locator('.app-data-actions button').first().evaluate(el => [...document.styleSheets].flatMap(sheet => { try { return [...sheet.cssRules] } catch { return [] } }).filter(rule => rule.selectorText && el.matches(rule.selectorText) && rule.style.background).map(rule => rule.cssText)))
      if (!before) {
        for (const button of buttons) {
          const lum = color => {
            const [r,g,b] = color.match(/[\d.]+/g).slice(0,3).map(Number).map(v => { const s=v/255; return s<=.04045 ? s/12.92 : ((s+.055)/1.055)**2.4 })
            return .2126*r+.7152*g+.0722*b
          }
          const fg = lum(button.color), bg = lum(button.background)
          assert.ok((Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05) >= 4.5, JSON.stringify(button))
          assert.equal(button.appearance, 'none')
        }
      }
      await page.screenshot({ path: new URL(`${before ? 'before' : 'after'}-${theme}-${width}-selected.png`, out).pathname })
      if (!before) {
        assert.equal(styles.textColor, styles.themeColor)
        assert.ok(styles.scrollWidth <= styles.clientWidth + 1, JSON.stringify(styles))
        assert.deepEqual(styles.clipped, [])
        await dialog.locator('.chat-extra-body').evaluate(el => { el.scrollTop = el.scrollHeight })
        const actionBox = await dialog.getByRole('button', { name: '本机读取并预览', exact: true }).boundingBox()
        assert.ok(actionBox.y >= 0 && actionBox.y + actionBox.height <= 874, 'Read action must remain visible after selection')
      }
      await dialog.getByRole('button', { name: '本机读取并预览', exact: true }).tap()
      await dialog.getByRole('heading', { name: '将发送的数据', exact: true }).waitFor()
      assert.ok((await dialog.getByLabel('应用数据预览').innerText()).includes('1234'))
      assert.ok(!(await dialog.getByLabel('应用数据预览').innerText()).includes('PRIVATE-NOTE'))
      const consent = dialog.getByRole('checkbox', { name: '我已检查预览，允许向上述模型发送这些数据，仅限本次。', exact: true })
      await consent.tap()
      assert.equal(await consent.isChecked(), true)
      await page.screenshot({ path: new URL(`${before ? 'before' : 'after'}-${theme}-${width}-preview.png`, out).pathname })
      assert.deepEqual(errors, [])
      results.push({ theme, width, ...styles, checkboxWorks: true, previewWorks: true })
      await context.close()
    }
  }
  await writeFile(new URL(`${before ? 'before' : 'after'}-results.json`, out), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
} finally { await browser.close() }
