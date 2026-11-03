/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import config from '../capacitor.config'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('mobile packaging safety contract', () => {
  it('ships local assets with stable identity and secure origins, not a remote site', () => {
    expect(config.appId).toBe('com.aily.app')
    expect(config.appName).toBe('Aily')
    expect(config.webDir).toBe('dist')
    expect(config.server?.androidScheme).toBe('https')
    expect(config.server?.url).toBeUndefined()
    expect(config.server?.cleartext).not.toBe(true)
    expect(config.server?.allowNavigation).toBeUndefined()
    expect(config.plugins?.CapacitorHttp?.enabled).not.toBe(true)
  })

  it('does not permit cleartext, automatic Android backup, or broad storage permissions', () => {
    const xml = new DOMParser().parseFromString(read('android/app/src/main/AndroidManifest.xml'), 'text/xml')
    const app = xml.querySelector('application')!
    expect(app.getAttribute('android:allowBackup')).toBe('false')
    expect(app.getAttribute('android:usesCleartextTraffic')).toBe('false')
    expect(app.getAttribute('android:dataExtractionRules')).toBe('@xml/data_extraction_rules')
    const permissions = [...xml.querySelectorAll('uses-permission')].map(node => node.getAttribute('android:name'))
    expect(permissions).toContain('android.permission.INTERNET')
    expect(permissions).toContain('android.permission.RECORD_AUDIO')
    expect(permissions).not.toContain('android.permission.MANAGE_EXTERNAL_STORAGE')
    expect(permissions).not.toContain('android.permission.WRITE_EXTERNAL_STORAGE')
  })

  it('keeps iOS deployment compatible with the existing Web APIs and declares recording use', () => {
    const project = read('ios/App/App.xcodeproj/project.pbxproj')
    expect(project.match(/IPHONEOS_DEPLOYMENT_TARGET = [\d.]+;/g)).toEqual(Array(4).fill('IPHONEOS_DEPLOYMENT_TARGET = 16.4;'))
    const plist = read('ios/App/App/Info.plist')
    expect(plist).toContain('NSMicrophoneUsageDescription')
    expect(plist).not.toContain('NSAllowsArbitraryLoads')
  })

  it('only shares cached files through the Android provider', () => {
    const xml = new DOMParser().parseFromString(read('android/app/src/main/res/xml/file_paths.xml'), 'text/xml')
    expect(xml.querySelector('cache-path')?.getAttribute('path')).toBe('.')
    expect(xml.querySelector('external-path')).toBeNull()
  })
})
