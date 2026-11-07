import { useEffect, useRef } from 'react'
import { App } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'

/** Notify once per background/foreground cycle, never on initial activation. */
export default function useAppResume(onResume: () => void): void {
  const callback = useRef(onResume)
  callback.current = onResume

  useEffect(() => {
    let channel: 'native' | 'web' | 'disposed' = 'native'
    let armed = false
    let isAndroid = false
    const handles = new Set<PluginListenerHandle>()

    const remove = (handle: PluginListenerHandle) => {
      // Both synchronous bridge failures and rejected removals are harmless.
      try { void Promise.resolve(handle.remove()).catch(() => {}) } catch { /* unavailable bridge */ }
    }
    const removeNative = () => {
      handles.forEach(remove)
      handles.clear()
    }
    const consume = () => {
      if (!armed || channel === 'disposed') return
      armed = false // Consume before user code, including throwing/reentrant callbacks.
      try { void Promise.resolve(callback.current()).catch(() => {}) } catch { /* isolate user code */ }
    }
    const onVisibilityChange = () => {
      if (channel !== 'web') return
      if (document.visibilityState === 'hidden') armed = true
      else if (document.visibilityState === 'visible') consume()
    }
    const useWeb = () => {
      if (channel !== 'native') return
      channel = 'web' // Disable native handlers before enabling the fallback.
      armed = typeof document !== 'undefined' && document.visibilityState === 'hidden'
      removeNative()
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange)
    }
    const register = (add: () => Promise<PluginListenerHandle>) => {
      if (channel !== 'native') return
      try {
        void add().then(handle => {
          // Registrations can resolve after fallback or unmount.
          if (channel !== 'native') remove(handle)
          else handles.add(handle)
        }).catch(useWeb)
      } catch { useWeb() }
    }

    try {
      if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('App')) useWeb()
      else isAndroid = Capacitor.getPlatform() === 'android'
    } catch { useWeb() }

    // iOS pause = didEnterBackground; inactive alone = willResignActive and can
    // be just a permission prompt. Android onPause can also be a brief system
    // interruption; only appStateChange(false), from onStop, arms Android.
    register(() => App.addListener('pause', () => {
      if (channel === 'native' && !isAndroid) armed = true
    }))
    // iOS resume = willEnterForeground, before didBecomeActive. Either signal
    // may consume the same pause; duplicate active/resume signals cannot fire twice.
    register(() => App.addListener('resume', () => {
      if (channel === 'native') consume()
    }))
    register(() => App.addListener('appStateChange', ({ isActive }) => {
      if (channel !== 'native') return
      if (isActive) consume()
      else if (isAndroid) armed = true
    }))
    // Do not query getState: an asynchronously stale snapshot cannot arm a cycle.

    return () => {
      channel = 'disposed'
      armed = false
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
      removeNative()
    }
  }, [])
}
