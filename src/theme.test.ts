import { beforeEach, expect, it } from 'vitest'
import { getThemePreference, setThemePreference } from './theme'

beforeEach(()=>localStorage.clear())
it('applies and persists light and dark appearance preferences',()=>{
  setThemePreference('light')
  expect(getThemePreference()).toBe('light')
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(localStorage.getItem('aily.theme')).toBe('light')
  setThemePreference('dark')
  expect(document.documentElement.dataset.theme).toBe('dark')
})
