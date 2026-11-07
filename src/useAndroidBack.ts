import { useEffect, useRef } from 'react'
import { App } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'

/** React screens do not create WebView history entries. Route the Android system
 * back button through the host before considering browser history/minimization.
 */
export default function useAndroidBack(onBack: () => boolean): void {
  const callback = useRef(onBack); callback.current = onBack
  useEffect(() => {
    let alive = true
    let handle: PluginListenerHandle | undefined
    const remove = (value: PluginListenerHandle) => { try { void Promise.resolve(value.remove()).catch(() => {}) } catch { /* bridge already closed */ } }
    try {
      if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('App')) return
      void App.addListener('backButton', ({ canGoBack }) => {
        if (!alive) return
        try {
          if (callback.current()) return
          if (canGoBack) window.history.back()
          else void App.minimizeApp().catch(() => {})
        } catch { /* Never exit or discard a route if its back handler fails. */ }
      }).then(value => { if (alive) handle = value; else remove(value) }).catch(() => {})
    } catch { /* Browser/iOS or an unavailable native bridge keep their normal navigation. */ }
    return () => { alive = false; if (handle) remove(handle) }
  }, [])
}
