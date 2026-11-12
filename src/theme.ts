import { useSyncExternalStore } from 'react'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { App } from '@capacitor/app'
import { Keyboard, KeyboardStyle } from '@capacitor/keyboard'

export type ThemePreference = 'system' | 'light' | 'dark'
const key = 'aily.theme'
const listeners = new Set<() => void>()
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null
let preference: ThemePreference = read()
function read(): ThemePreference { try { const value = localStorage.getItem(key); return value === 'light' || value === 'dark' ? value : 'system' } catch { return 'system' } }
export function resolvedTheme(value = preference): 'light'|'dark' { return value === 'system' ? media?.matches ? 'light' : 'dark' : value }
async function apply() {
  const resolved = resolvedTheme()
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
  document.querySelector<HTMLMetaElement>('meta[name=theme-color]')?.setAttribute('content', resolved === 'light' ? '#f5f5f7' : '#110f16')
  if (Capacitor.isNativePlatform()) {
    try { await StatusBar.setStyle({ style: resolved === 'light' ? Style.Light : Style.Dark }) } catch {}
    if (Capacitor.getPlatform() === 'ios') { try { await Keyboard.setStyle({ style: resolved === 'light' ? KeyboardStyle.Light : KeyboardStyle.Dark }) } catch {} }
  }
}
export function setThemePreference(value: ThemePreference) { preference = value; try { localStorage.setItem(key, value) } catch {} void apply(); listeners.forEach(listener=>listener()) }
export function getThemePreference(){ return preference }
function subscribe(listener:()=>void){ listeners.add(listener); return()=>listeners.delete(listener) }
export function useTheme(){ const value=useSyncExternalStore(subscribe,getThemePreference,getThemePreference); return { preference:value, resolved:resolvedTheme(value), setTheme:setThemePreference } }
media?.addEventListener('change',()=>{ if(preference==='system'){ void apply(); listeners.forEach(listener=>listener()) } })
const resync=()=>{ if(preference==='system'){ void apply(); listeners.forEach(listener=>listener()) } }
if(typeof document!=='undefined'){
  void apply()
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) resync() })
  window.addEventListener('focus',resync)
  window.addEventListener('pageshow',resync)
  if(Capacitor.isNativePlatform()){ try { void App.addListener('appStateChange',state=>{ if(state.isActive) resync() }) } catch {} }
}
