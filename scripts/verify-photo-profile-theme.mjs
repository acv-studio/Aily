import { mkdir, readFile, writeFile } from 'node:fs/promises'
process.env.PLAYWRIGHT_BROWSERS_PATH ||= new URL('../.toolchains/playwright/', import.meta.url).pathname
const { webkit } = await import('playwright')

const prefix = process.argv.includes('--before') ? 'before' : 'after'
const url = process.env.AILY_THEME_URL || 'http://127.0.0.1:5174'
const out = new URL('../.mobile-build/photo-profile-theme/', import.meta.url)
await mkdir(out, { recursive: true })
const browser = await webkit.launch({ headless: true })
const results = []
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
    await context.addInitScript(() => localStorage.setItem('aily.locale', 'zh-CN'))
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    page.on('pageerror', error => console.error('Page error:', error.message))
    if (prefix === 'before') {
      const originalCss = await readFile(new URL('baseline-tools-photo-theme.css', out), 'utf8')
      await page.route('**/src/tools-photo-theme.css*', route => route.fulfill({ contentType: 'application/javascript', body: `const s=document.createElement('style');s.textContent=${JSON.stringify(originalCss)};document.head.append(s);export default ${JSON.stringify(originalCss)};` }))
    }
    // Mock only native availability; the actual React page, styles and app navigation run.
    // No device library, user data, model or permission request is accessed.
    await page.route('**/src/nativePhotoOrganizer.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `export const isPhotoOrganizerAvailable=()=>true; export const listPhotos=async()=>({photos:[],limited:false}); export const getPhoto=async()=>{throw new Error('not used')}; export const deletePhotos=async()=>{throw new Error('not used')};` }))
    await page.goto(url)
    await page.evaluate(async mode => {
      const { finishOnboarding } = await import('/src/db.ts')
      const { defaultOnboardingProfile } = await import('/src/onboarding.ts')
      const { acceptSafetyConsent } = await import('/src/privacy.ts')
      const { setThemePreference } = await import('/src/theme.ts')
      const { setExtensionInstalled } = await import('/src/extensionApps.ts')
      setExtensionInstalled('photo-organizer', true)
      await finishOnboarding(defaultOnboardingProfile('lu'), [])
      acceptSafetyConsent(); setThemePreference(mode)
    }, theme)
    await page.reload()
    try { await page.getByRole('button', { name: /相册整理/ }).click() }
    catch (error) { console.log('Navigation diagnostics:', await page.locator('body').innerText()); await page.screenshot({ path: new URL(`${prefix}-${theme}-navigation.png`, out).pathname }); throw error }
    const mini = page.locator('.photo-organizer')
    await mini.getByRole('button', { name: '我的', exact: true }).click()
    await mini.locator('.organizer-profile-actions button').first().waitFor()
    await page.screenshot({ path: new URL(`${prefix}-${theme}.png`, out).pathname })
    const samples = await mini.evaluate(root => {
      const rgb = text => (text.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
      const lum = color => {
        const v = rgb(color).map(x => { const s = x / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4 })
        return v[0] * .2126 + v[1] * .7152 + v[2] * .0722
      }
      const ratio = (fg, bg) => { const a = lum(fg), b = lum(bg); return (Math.max(a,b)+.05)/(Math.min(a,b)+.05) }
      const paint = element => {
        const style = getComputedStyle(element)
        let node = element, background = style.backgroundColor
        while (node && (!background || background === 'transparent' || background === 'rgba(0, 0, 0, 0)')) { node = node.parentElement; if (node) background = getComputedStyle(node).backgroundColor }
        return { text: element.textContent.trim(), color: style.color, background, opacity: style.opacity, contrast: ratio(style.color, background) }
      }
      const normal = [...root.querySelectorAll('.organizer-profile-card h3,.organizer-profile-card p,.organizer-profile-actions button,.organizer-source-chips button')].map(paint)
      const icons = [...root.querySelectorAll('.organizer-profile-card>svg,.organizer-profile-actions button svg')].map(paint)
      const actions = [...root.querySelectorAll('.organizer-profile-actions button')]
      actions.forEach(button => { button.disabled = true })
      const disabled = actions.map(paint)
      actions.forEach(button => { button.disabled = false })
      return { normal, disabled, icons }
    })
    results.push({ theme, ...samples })
    console.log(theme, samples.normal.map(s => `${s.text.slice(0,24)}=${s.contrast.toFixed(2)}`).join(' | '))
    if (prefix !== 'before') {
      for (const sample of samples.icons) {
        if (!Number.isFinite(sample.contrast) || sample.contrast < 3) throw new Error(`Low icon contrast ${theme}: ${JSON.stringify(sample)}`)
      }
      for (const sample of [...samples.normal, ...samples.disabled]) {
        if (!sample.text || !Number.isFinite(sample.contrast) || sample.contrast < 4.5 || Number(sample.opacity) < 1) throw new Error(`Low contrast ${theme}: ${JSON.stringify(sample)}`)
      }
    }
    await context.close()
  }
  await writeFile(new URL(`${prefix}-contrast.json`, out), JSON.stringify(results, null, 2))
  console.log(`Saved ${prefix} screenshots and computed-style contrast report.`)
} finally { await browser.close() }
