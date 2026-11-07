import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginListenerHandle } from '@capacitor/core'
import useAppResume from './useAppResume'

const sdk = vi.hoisted(() => ({
  addListener: vi.fn(), getState: vi.fn(), removeAllListeners: vi.fn(),
  isNativePlatform: vi.fn(), isPluginAvailable: vi.fn(),
}))
vi.mock('@capacitor/app', () => ({ App: sdk }))
vi.mock('@capacitor/core', () => ({ Capacitor: sdk }))

type NativeEvent = 'pause' | 'resume' | 'appStateChange'
type Listener = (state: { isActive: boolean }) => void
let listeners: Map<NativeEvent, Listener[]>
let handles: Array<{ remove: ReturnType<typeof vi.fn> }>
let visibility: DocumentVisibilityState
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function remember(name: NativeEvent, listener: Listener) {
  listeners.set(name, [...(listeners.get(name) ?? []), listener])
}
function handle() {
  const value = { remove: vi.fn().mockResolvedValue(undefined) }
  handles.push(value)
  return value
}
function emit(name: NativeEvent, isActive = true) {
  act(() => { listeners.get(name)?.forEach(listener => listener({ isActive })) })
}
function web(state: DocumentVisibilityState) {
  visibility = state
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}
async function settle() {
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() })
}
beforeEach(() => {
  vi.resetAllMocks()
  listeners = new Map(); handles = []; visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  sdk.isNativePlatform.mockReturnValue(true)
  sdk.isPluginAvailable.mockReturnValue(true)
  sdk.addListener.mockImplementation((name: NativeEvent, listener: Listener) => {
    remember(name, listener)
    return Promise.resolve(handle())
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('native app resume', () => {
  it('does not trigger on cold start, initial active, or unarmed resume; never queries getState', async () => {
    const callback = vi.fn()
    renderHook(() => useAppResume(callback)); await settle()
    emit('appStateChange'); emit('resume'); emit('appStateChange')
    expect(callback).not.toHaveBeenCalled()
    expect(sdk.getState).not.toHaveBeenCalled()
    expect(sdk.addListener.mock.calls.map(([name]) => name)).toEqual(['pause', 'resume', 'appStateChange'])
  })
  it('does not arm on permission-prompt inactive false alone', async () => {
    const callback = vi.fn()
    renderHook(() => useAppResume(callback)); await settle()
    emit('appStateChange', false); emit('appStateChange', false)
    emit('appStateChange', true); emit('resume')
    expect(callback).not.toHaveBeenCalled()
  })
  it('consumes iOS pause/resume before active and ignores duplicate active/resume', async () => {
    const callback = vi.fn()
    renderHook(() => useAppResume(callback)); await settle()
    emit('appStateChange', false); emit('pause'); emit('pause')
    expect(callback).not.toHaveBeenCalled()
    emit('resume')
    expect(callback).toHaveBeenCalledTimes(1)
    emit('appStateChange'); emit('resume'); emit('appStateChange')
    expect(callback).toHaveBeenCalledTimes(1)
  })
  it('can consume pause with active true even when resume is missing or arrives later', async () => {
    const callback = vi.fn()
    renderHook(() => useAppResume(callback)); await settle()
    emit('pause'); emit('appStateChange', false); emit('appStateChange'); emit('resume')
    expect(callback).toHaveBeenCalledTimes(1)
  })
  it('fires once for each repeated background/foreground cycle', async () => {
    const callback = vi.fn()
    renderHook(() => useAppResume(callback)); await settle()
    for (let i = 1; i <= 3; i++) {
      emit('appStateChange', false); emit('pause'); emit('resume'); emit('appStateChange')
      expect(callback).toHaveBeenCalledTimes(i)
    }
  })
  it('uses the latest callback without registering listeners again', async () => {
    const first = vi.fn(), latest = vi.fn()
    const hook = renderHook(({ callback }) => useAppResume(callback), { initialProps: { callback: first } })
    await settle(); emit('pause')
    hook.rerender({ callback: latest }); emit('resume')
    expect(first).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledTimes(1)
    expect(sdk.addListener).toHaveBeenCalledTimes(3)
  })
  it('never handles browser visibility while native is working (including initially hidden)', async () => {
    visibility = 'hidden'
    const callback = vi.fn()
    renderHook(() => useAppResume(callback)); await settle()
    web('visible'); emit('resume'); emit('appStateChange')
    expect(callback).not.toHaveBeenCalled()
    emit('pause'); web('hidden'); web('visible')
    expect(callback).not.toHaveBeenCalled()
    emit('resume'); expect(callback).toHaveBeenCalledTimes(1)
  })
  it('isolates throwing callbacks and continues later cycles', async () => {
    const callback = vi.fn(() => { throw new Error('callback failed') })
    renderHook(() => useAppResume(callback)); await settle()
    emit('pause'); expect(() => emit('resume')).not.toThrow(); emit('appStateChange')
    emit('pause'); emit('resume')
    expect(callback).toHaveBeenCalledTimes(2)
  })
  it('catches promises returned by callbacks even with the void callback API', async () => {
    const callback = vi.fn(async () => { throw new Error('async callback failed') })
    renderHook(() => useAppResume(callback)); await settle()
    emit('pause'); emit('resume'); await settle()
    emit('pause'); emit('appStateChange'); await settle()
    expect(callback).toHaveBeenCalledTimes(2)
  })
})

describe('browser fallback', () => {
  it('only fires on hidden -> visible, not visible cold start, focus, or duplicate visible', () => {
    sdk.isNativePlatform.mockReturnValue(false)
    const callback = vi.fn()
    renderHook(() => useAppResume(callback))
    web('visible'); act(() => { window.dispatchEvent(new Event('focus')) })
    expect(callback).not.toHaveBeenCalled(); expect(sdk.addListener).not.toHaveBeenCalled()
    web('hidden'); web('hidden'); web('visible'); web('visible')
    expect(callback).toHaveBeenCalledTimes(1)
    web('hidden'); web('visible'); expect(callback).toHaveBeenCalledTimes(2)
  })
  it('arms from an initially hidden document', () => {
    sdk.isNativePlatform.mockReturnValue(false); visibility = 'hidden'
    const callback = vi.fn()
    renderHook(() => useAppResume(callback))
    expect(callback).not.toHaveBeenCalled(); web('visible')
    expect(callback).toHaveBeenCalledTimes(1)
  })
  it('uses the latest browser callback and removes visibility listener on unmount', () => {
    sdk.isNativePlatform.mockReturnValue(false)
    const first = vi.fn(), latest = vi.fn()
    const remove = vi.spyOn(document, 'removeEventListener')
    const hook = renderHook(({ callback }) => useAppResume(callback), { initialProps: { callback: first } })
    web('hidden'); hook.rerender({ callback: latest }); web('visible')
    expect(first).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledTimes(1)
    hook.unmount(); web('hidden'); web('visible')
    expect(latest).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })
  it('falls back when the native App plugin is unavailable', () => {
    sdk.isPluginAvailable.mockReturnValue(false)
    const callback = vi.fn()
    renderHook(() => useAppResume(callback)); web('hidden'); web('visible')
    expect(callback).toHaveBeenCalledTimes(1); expect(sdk.addListener).not.toHaveBeenCalled()
  })
  it('falls back when platform detection throws', () => {
    sdk.isNativePlatform.mockImplementation(() => { throw new Error('bridge absent') })
    const callback = vi.fn()
    renderHook(() => useAppResume(callback)); web('hidden'); web('visible')
    expect(callback).toHaveBeenCalledTimes(1)
  })
  it.each(['pause', 'resume', 'appStateChange'] as const)('falls back on rejected %s registration without double processing', async failed => {
    const gate = deferred<PluginListenerHandle>()
    sdk.addListener.mockImplementation((name: NativeEvent, listener: Listener) => {
      remember(name, listener)
      return name === failed ? gate.promise : Promise.resolve(handle())
    })
    const callback = vi.fn()
    const hook = renderHook(() => useAppResume(callback)); await settle()
    emit('pause') // Failed native cycle must not leak into web fallback.
    gate.reject(new Error('registration failed')); await settle()
    emit('resume'); emit('appStateChange'); web('visible')
    expect(callback).not.toHaveBeenCalled()
    web('hidden'); emit('pause'); emit('resume'); web('visible'); emit('appStateChange')
    expect(callback).toHaveBeenCalledTimes(1)
    expect(handles).toHaveLength(2)
    handles.forEach(value => expect(value.remove).toHaveBeenCalledTimes(1))
    hook.unmount(); web('hidden'); web('visible'); emit('pause'); emit('resume')
    expect(callback).toHaveBeenCalledTimes(1)
    handles.forEach(value => expect(value.remove).toHaveBeenCalledTimes(1))
  })
  it('handles a synchronously throwing registration and initially hidden fallback', () => {
    visibility = 'hidden'
    sdk.addListener.mockImplementation(() => { throw new Error('unavailable') })
    const callback = vi.fn()
    renderHook(() => useAppResume(callback)); web('visible'); web('visible')
    expect(callback).toHaveBeenCalledTimes(1); expect(sdk.addListener).toHaveBeenCalledTimes(1)
  })
})

describe('listener cleanup and async races', () => {
  it('removes all native handles on unmount and ignores subsequent events', async () => {
    const callback = vi.fn()
    const hook = renderHook(() => useAppResume(callback)); await settle()
    emit('pause'); hook.unmount(); emit('resume'); emit('pause'); emit('appStateChange')
    expect(callback).not.toHaveBeenCalled()
    expect(handles).toHaveLength(3)
    handles.forEach(value => expect(value.remove).toHaveBeenCalledTimes(1))
    expect(sdk.removeAllListeners).not.toHaveBeenCalled()
  })
  it('removes every registration resolving after unmount', async () => {
    const gates = [deferred<PluginListenerHandle>(), deferred<PluginListenerHandle>(), deferred<PluginListenerHandle>()]
    sdk.addListener.mockImplementation((name: NativeEvent, listener: Listener) => {
      remember(name, listener)
      return gates[sdk.addListener.mock.calls.length - 1].promise
    })
    const callback = vi.fn()
    const hook = renderHook(() => useAppResume(callback)); hook.unmount()
    for (const gate of gates) gate.resolve(handle())
    await settle(); emit('pause'); emit('resume'); web('hidden'); web('visible')
    expect(callback).not.toHaveBeenCalled()
    handles.forEach(value => expect(value.remove).toHaveBeenCalledTimes(1))
  })
  it('removes late successful handles after another registration fails', async () => {
    const gates = [deferred<PluginListenerHandle>(), deferred<PluginListenerHandle>(), deferred<PluginListenerHandle>()]
    sdk.addListener.mockImplementation(() => gates[sdk.addListener.mock.calls.length - 1].promise)
    const callback = vi.fn()
    renderHook(() => useAppResume(callback))
    gates[0].reject(new Error('missing pause')); await settle()
    gates[1].resolve(handle()); gates[2].resolve(handle()); await settle()
    handles.forEach(value => expect(value.remove).toHaveBeenCalledTimes(1))
    web('hidden'); web('visible'); expect(callback).toHaveBeenCalledTimes(1)
  })
  it('does not install fallback if registration rejects after unmount', async () => {
    const gate = deferred<PluginListenerHandle>()
    sdk.addListener.mockReturnValue(gate.promise)
    const addWeb = vi.spyOn(document, 'addEventListener')
    const callback = vi.fn()
    const hook = renderHook(() => useAppResume(callback)); hook.unmount()
    gate.reject(new Error('late registration failure')); await settle()
    expect(addWeb.mock.calls.filter(([name]) => name === 'visibilitychange')).toHaveLength(0)
    web('hidden'); web('visible'); expect(callback).not.toHaveBeenCalled()
  })
  it('catches rejecting and synchronously throwing remove operations', async () => {
    const hook = renderHook(() => useAppResume(vi.fn())); await settle()
    handles[0].remove.mockRejectedValue(new Error('remove rejected'))
    handles[1].remove.mockImplementation(() => { throw new Error('remove threw') })
    expect(() => hook.unmount()).not.toThrow(); await settle()
    handles.forEach(value => expect(value.remove).toHaveBeenCalledTimes(1))
  })
  it('catches late handle remove rejection after unmount', async () => {
    const gate = deferred<PluginListenerHandle>()
    sdk.addListener.mockReturnValueOnce(gate.promise)
    const hook = renderHook(() => useAppResume(vi.fn())); await settle(); hook.unmount()
    const late = handle(); late.remove.mockRejectedValue(new Error('late remove rejected'))
    gate.resolve(late); await settle()
    expect(late.remove).toHaveBeenCalledTimes(1)
  })
  it('isolates StrictMode effect generations and removes all handles', async () => {
    const callback = vi.fn()
    const hook = renderHook(() => useAppResume(callback), {
      reactStrictMode: true,
    })
    await settle(); expect(handles).toHaveLength(6)
    handles.slice(0, 3).forEach(value => expect(value.remove).toHaveBeenCalledTimes(1))
    emit('pause'); emit('resume'); emit('appStateChange')
    expect(callback).toHaveBeenCalledTimes(1)
    hook.unmount(); handles.forEach(value => expect(value.remove).toHaveBeenCalledTimes(1))
  })
})
