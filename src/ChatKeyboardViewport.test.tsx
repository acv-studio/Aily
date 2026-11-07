import { act, cleanup, render } from '@testing-library/react'
import {afterEach,expect,it,onTestFinished,vi} from 'vitest'
import fs from 'node:fs'
import ChatPanel from './ChatPanel'
import {characters} from './data'
const native=vi.hoisted(()=>({height:0,fullHeight:874,width:402,listeners:new Set<()=>void>()}))
vi.mock('./nativeKeyboard',()=>({getNativeKeyboardState:()=>native,subscribeNativeKeyboard:(cb:()=>void)=>{native.listeners.add(cb);return()=>native.listeners.delete(cb)}}))
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();native.height=0;native.fullHeight=874;native.listeners.clear()})
it('keeps the real chat composer in every keyboard frame and restores it on hide',()=>{
 vi.stubGlobal('innerHeight',874);vi.stubGlobal('innerWidth',402)
 const viewport=Object.assign(new EventTarget(),{height:874,offsetTop:0});vi.stubGlobal('visualViewport',viewport)
 const previous=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'scrollIntoView');Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});onTestFinished(()=>{if(previous)Object.defineProperty(HTMLElement.prototype,'scrollIntoView',previous);else Reflect.deleteProperty(HTMLElement.prototype,'scrollIntoView')})
 const props={character:characters[0],messages:Array.from({length:20},(_,i)=>({id:i+1,from:'user' as const,text:'键盘回归测试消息',time:'10:14',status:'sent' as const})),draft:'待发送文字',setDraft:vi.fn(),send:vi.fn(async()=>{}),saveMemory:vi.fn(async()=>{}),withdraw:vi.fn(async()=>{}),close:vi.fn(),stop:vi.fn(),replying:false,error:'',demo:true,openGame:vi.fn(),openStory:vi.fn()}
 const view=render(<ChatPanel {...props}/>),root=view.container.querySelector('.chat-screen') as HTMLElement
 fs.mkdirSync('.mobile-build/chat-keyboard-frames',{recursive:true})
 const save=(name:string)=>fs.writeFileSync(`.mobile-build/chat-keyboard-frames/${name}.html`,`<!doctype html><html><body>${document.body.innerHTML}</body></html>`)
 expect(root.style.getPropertyValue('--chat-view-height')).toBe('874px');save('closed')
 act(()=>{native.height=376;native.listeners.forEach(cb=>cb())})
 expect(root.style.getPropertyValue('--chat-view-height')).toBe('498px');expect(root.dataset.keyboardOpen).toBe('true');save('native-only')
 act(()=>{viewport.height=498;viewport.dispatchEvent(new Event('resize'))})
 expect(root.style.getPropertyValue('--chat-view-height')).toBe('498px');save('visual-and-native')
 act(()=>{vi.stubGlobal('innerHeight',498);window.dispatchEvent(new Event('resize'))})
 expect(root.style.getPropertyValue('--chat-view-height')).toBe('498px');save('resized-webview')
 act(()=>{viewport.height=438;viewport.offsetTop=60;viewport.dispatchEvent(new Event('scroll'))})
 expect(root.style.getPropertyValue('--chat-view-top')).toBe('60px');expect(root.style.getPropertyValue('--chat-view-height')).toBe('438px');save('panned')
 act(()=>{vi.stubGlobal('innerHeight',874);viewport.height=874;viewport.offsetTop=0;native.height=0;native.listeners.forEach(cb=>cb())})
 expect(root.style.getPropertyValue('--chat-view-height')).toBe('874px');expect(root.dataset.keyboardOpen).toBe('false');save('restored')
 view.unmount();expect(native.listeners.size).toBe(0);expect(props.send).not.toHaveBeenCalled()
})
