import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ExtensionStore, { ExtensionAppView } from './ExtensionStore'
import { extensionApps, installedExtensionIds } from './extensionApps'

const INSTALL_KEY = 'aily.extension-apps.v1'
const MEAL_KEY = 'aily.ext.meal.v1'
beforeEach(() => localStorage.clear())
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('registers the offline household meal planner as a lifestyle extension', () => {
  expect(extensionApps.find(app => app.id === 'meal-planner')).toMatchObject({ category: 'life', name: '吃什么', english: 'What to Eat' })
  expect(extensionApps.filter(app => app.id === 'meal-planner')).toHaveLength(1)
})

it('installs, reloads, opens and uninstalls meal planner without deleting its user data', () => {
  const openApp = vi.fn()
  const view = render(<ExtensionStore locale="zh-CN" openApp={openApp} />)
  const card = () => screen.getByRole('heading', { name: '吃什么' }).closest('article')!
  expect(within(card()).queryByRole('button', { name: '打开 吃什么' })).toBeNull()
  fireEvent.click(within(card()).getByRole('button', { name: '安装 吃什么' }))
  expect(installedExtensionIds()).toContain('meal-planner')
  view.unmount(); render(<ExtensionStore locale="zh-CN" openApp={openApp} />)
  fireEvent.click(within(card()).getByRole('button', { name: '打开 吃什么' }))
  expect(openApp).toHaveBeenCalledExactlyOnceWith('meal-planner')
  const userData = '{"preserve":"user meal data"}'
  localStorage.setItem(MEAL_KEY, userData)
  fireEvent.click(within(card()).getByRole('button', { name: '卸载 吃什么' }))
  expect(installedExtensionIds()).not.toContain('meal-planner')
  expect(localStorage.getItem(MEAL_KEY)).toBe(userData)
  expect(within(card()).getByRole('button', { name: '安装 吃什么' })).toBeInTheDocument()
})

it('failed installation leaves registry and store UI unchanged', () => {
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
  render(<ExtensionStore locale="en" />)
  const card = screen.getByRole('heading', { name: 'What to Eat' }).closest('article')!
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
  fireEvent.click(within(card).getByRole('button', { name: 'Install What to Eat' }))
  expect(alert).toHaveBeenCalledWith('Installation failed because local storage is unavailable.')
  expect(localStorage.getItem(INSTALL_KEY)).toBeNull()
  expect(within(card).getByRole('button', { name: 'Install What to Eat' })).toBeInTheDocument()
  expect(within(card).queryByRole('button', { name: 'Uninstall What to Eat' })).toBeNull()
})

it('routes meal-planner to the real five-step application without writing on mount', () => {
  const writes = vi.spyOn(Storage.prototype, 'setItem')
  render(<ExtensionAppView id="meal-planner" locale="en" />)
  expect(screen.getByRole('region', { name: 'Meal planner' })).toBeInTheDocument()
  expect(within(screen.getByRole('navigation', { name: 'Meal steps' })).getAllByRole('button')).toHaveLength(5)
  expect(screen.getByRole('button', { name: 'Generate meal' })).toBeInTheDocument()
  expect(writes).not.toHaveBeenCalled()
})
