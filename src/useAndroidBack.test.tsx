import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useAndroidBack from './useAndroidBack'
import type { BackButtonListenerEvent } from '@capacitor/app'
const sdk = vi.hoisted(() => ({ addListener:vi.fn(), minimizeApp:vi.fn(), isNativePlatform:vi.fn(), getPlatform:vi.fn(), isPluginAvailable:vi.fn() }))
vi.mock('@capacitor/app',()=>({App:sdk}))
vi.mock('@capacitor/core',()=>({Capacitor:sdk}))
let listener:(event:BackButtonListenerEvent)=>void
let remove:ReturnType<typeof vi.fn>
beforeEach(()=>{
  vi.resetAllMocks(); remove=vi.fn(async()=>{})
  sdk.isNativePlatform.mockReturnValue(true); sdk.getPlatform.mockReturnValue('android'); sdk.isPluginAvailable.mockReturnValue(true)
  sdk.minimizeApp.mockResolvedValue(undefined)
  sdk.addListener.mockImplementation((_name,callback)=>{listener=callback;return Promise.resolve({remove})})
})
afterEach(()=>{cleanup();vi.restoreAllMocks()})
const back=(canGoBack=false)=>act(()=>listener({canGoBack}))
describe('Android native back routes through the current React screen',()=>{
  it('handles app navigation without going through WebView history or minimizing',async()=>{
    const onBack=vi.fn(()=>true), history=vi.spyOn(window.history,'back')
    renderHook(()=>useAndroidBack(onBack)); await act(async()=>{})
    back(true)
    expect(onBack).toHaveBeenCalledOnce(); expect(history).not.toHaveBeenCalled(); expect(sdk.minimizeApp).not.toHaveBeenCalled()
    expect(sdk.addListener.mock.calls[0][0]).toBe('backButton')
  })
  it('uses actual browser history only when no app route handles back',async()=>{
    const history=vi.spyOn(window.history,'back').mockImplementation(()=>{})
    renderHook(()=>useAndroidBack(()=>false)); await act(async()=>{})
    back(true); expect(history).toHaveBeenCalledOnce(); expect(sdk.minimizeApp).not.toHaveBeenCalled()
  })
  it('minimizes at the root instead of creating a synthetic screen-saver route',async()=>{
    renderHook(()=>useAndroidBack(()=>false)); await act(async()=>{})
    back(); expect(sdk.minimizeApp).toHaveBeenCalledOnce()
  })
  it.each(['ios','web'])('does not take over %s navigation',platform=>{
    sdk.getPlatform.mockReturnValue(platform); if(platform==='web')sdk.isNativePlatform.mockReturnValue(false)
    renderHook(()=>useAndroidBack(()=>true));expect(sdk.addListener).not.toHaveBeenCalled()
  })
  it('uses the latest screen callback without reregistering listeners',async()=>{
    const first=vi.fn(()=>true), second=vi.fn(()=>true)
    const hook=renderHook(({callback})=>useAndroidBack(callback),{initialProps:{callback:first}})
    await act(async()=>{});hook.rerender({callback:second});back()
    expect(first).not.toHaveBeenCalled();expect(second).toHaveBeenCalledOnce();expect(sdk.addListener).toHaveBeenCalledOnce()
    hook.unmount();back();expect(second).toHaveBeenCalledOnce();expect(remove).toHaveBeenCalledOnce()
  })
  it('removes late registrations and does not navigate after unmount',async()=>{
    let resolve!:(handle:{remove:typeof remove})=>void
    sdk.addListener.mockImplementation((_name,callback)=>{listener=callback;return new Promise(done=>{resolve=done})})
    const callback=vi.fn(()=>true),hook=renderHook(()=>useAndroidBack(callback));hook.unmount()
    await act(async()=>resolve({remove}));back()
    expect(remove).toHaveBeenCalledOnce();expect(callback).not.toHaveBeenCalled()
  })
  it('does not discard the current screen if its handler throws',async()=>{
    renderHook(()=>useAndroidBack(()=>{throw new Error('pending save')}));await act(async()=>{})
    back();expect(sdk.minimizeApp).not.toHaveBeenCalled()
  })
})
