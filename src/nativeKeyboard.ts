import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'

export type NativeKeyboardState = { height:number; fullHeight:number; width:number }
let keyboardState:NativeKeyboardState = { height:0, fullHeight:typeof window==='undefined'?0:window.innerHeight, width:typeof window==='undefined'?0:window.innerWidth }
const closedHeights=new Map<number,number>(keyboardState.fullHeight>0?[[keyboardState.width,keyboardState.fullHeight]]:[])
if (typeof window!=='undefined') window.addEventListener('resize',()=>{
  if(keyboardState.height===0) closedHeights.set(window.innerWidth,Math.max(closedHeights.get(window.innerWidth)||0,window.innerHeight))
})
const observers=new Set<()=>void>()
export const getNativeKeyboardState=()=>keyboardState
export function subscribeNativeKeyboard(callback:()=>void) { observers.add(callback); return()=>{observers.delete(callback)} }
function publishKeyboardHeight(value:number) {
  const height=Number.isFinite(value)?Math.max(0,value):0
  // DidShow may arrive after Native resize; never treat a shortened innerHeight
  // as the original full height. For an unseen orientation, trust native resize.
  if(height===0) closedHeights.set(window.innerWidth,Math.max(closedHeights.get(window.innerWidth)||0,window.innerHeight))
  const fullHeight=closedHeights.get(window.innerWidth)||0
  keyboardState={height,fullHeight,width:window.innerWidth}
  document.documentElement.dataset.keyboardOpen=String(height>0)
  document.documentElement.style.setProperty('--native-keyboard-height',`${height}px`)
  observers.forEach(callback=>callback())
}
let initialized = false
export async function initializeNativeKeyboard() {
  if (initialized || !Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return
  initialized = true
  try {
    // Cosmetic accessory setup must never prevent keyboard-safe geometry.
    void Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(error => console.warn('Unable to hide keyboard accessory bar', error))
    let acceptDidShow=true
    const hide=()=>{acceptDidShow=false;publishKeyboardHeight(0)}
    await Keyboard.addListener('keyboardWillShow', info => {acceptDidShow=true;publishKeyboardHeight(info.keyboardHeight)})
    await Keyboard.addListener('keyboardDidShow', info => {if(acceptDidShow)publishKeyboardHeight(info.keyboardHeight)})
    await Keyboard.addListener('keyboardWillHide', hide)
    await Keyboard.addListener('keyboardDidHide', hide)
    document.addEventListener('visibilitychange',hide)
    window.addEventListener('pagehide',hide)
    window.addEventListener('pageshow',hide)
  } catch (error) {
    initialized = false
    console.warn('Unable to initialize iOS keyboard controls', error)
  }
}
void initializeNativeKeyboard()
