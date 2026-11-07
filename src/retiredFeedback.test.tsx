import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HomeScreen from './HomeScreen'
import ExtensionStore, { ExtensionAppView } from './ExtensionStore'
import { extensionApps, extensionInstallationKey, registerExtensionApp } from './extensionApps'
import { defaultExtensionMarkerKey } from './defaultExtensions'
import { initializeAppDataProviders } from './appDataProviders'
import { listAppDataManifests, registerAppDataProvider } from './appDataGateway'
import { setLocale } from './i18n'

vi.mock('./WeatherWidget', () => ({ default: () => <div>Weather fixture</div> }))
vi.mock('./ClockWidget', () => ({ default: () => <div>Clock fixture</div> }))
beforeEach(() => { localStorage.clear(); setLocale('zh-CN') })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('feedback app removed from the running host', () => {
  it('does not show feedback on the desktop or reinstall it when a legacy profile reopens', () => {
    localStorage.setItem(extensionInstallationKey, '["feedback","focus-timer"]')
    localStorage.setItem(defaultExtensionMarkerKey, '["feedback"]')
    localStorage.setItem('aily.ext.feedback.v1', 'OLD-DRAFT-KEPT')
    const home = render(<HomeScreen selected="lu" conversations={{}} openChat={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /反馈$/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /专注时钟$/ })).toBeInTheDocument()
    expect(localStorage.getItem(extensionInstallationKey)).toBe('["focus-timer"]')
    expect(localStorage.getItem('aily.ext.feedback.v1')).toBe('OLD-DRAFT-KEPT')
    home.unmount()
    render(<HomeScreen selected="lu" conversations={{}} openChat={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /反馈$/ })).not.toBeInTheDocument()
  })
  it.each(['zh-CN', 'en'] as const)('does not list or allow installing feedback from the store in %s', locale => {
    render(<ExtensionStore locale={locale} openApp={vi.fn()} />)
    expect(extensionApps.some(app => app.id === 'feedback')).toBe(false)
    expect(screen.queryByRole('heading', { name: /^(反馈|Feedback)$/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: locale === 'en' ? 'Search apps' : '搜索应用' }), { target: { value: 'feedback' } })
    expect(screen.queryByRole('button', { name: /^(安装 反馈|Install Feedback)$/ })).not.toBeInTheDocument()
    expect(screen.getByText(locale === 'en' ? 'No matching apps. Try another search or filter.' : '没有匹配的应用，请更换搜索词或筛选。')).toBeInTheDocument()
  })
  it('a stale direct feedback route cannot render the deleted form or mail composer', () => {
    render(<ExtensionAppView id="feedback" locale="zh-CN" />)
    expect(screen.getByRole('status')).toHaveTextContent('应用暂不可用')
    expect(screen.queryByRole('button', { name: '发送反馈' })).not.toBeInTheDocument()
  })
  it('legacy feedback metadata does not block data access for remaining apps and cannot register a feedback provider', () => {
    localStorage.setItem(extensionInstallationKey, '["feedback","focus-timer"]')
    initializeAppDataProviders()
    const manifests = listAppDataManifests()
    expect(manifests.some(app => app.id === 'ledger')).toBe(true)
    expect(manifests.some(app => app.id === 'feedback')).toBe(false)
    expect(() => registerExtensionApp({ id: 'feedback', name: 'Feedback', english: 'Feedback', description: 'D', englishDescription: 'D', icon: 'F', color: '#abc', category: 'life' })).toThrow()
    expect(() => registerAppDataProvider({ manifest: { id: 'feedback', name: 'Feedback', english: 'Feedback', availability: 'builtin', schemaVersion: 1, scopes: [] }, read: async () => ({ status: 'empty', records: [], summary: {}, revision: '', truncated: false }) })).toThrow()
  })
})
