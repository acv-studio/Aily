import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'

let initialized = false
export async function initializeNativeKeyboard() {
  if (initialized || !Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return
  initialized = true
  try {
    // Supported iPhone API: hide the Previous / Next / Done accessory strip.
    await Keyboard.setAccessoryBarVisible({ isVisible: false })
    const setOpen = (open: boolean) => { document.documentElement.dataset.keyboardOpen = String(open) }
    await Keyboard.addListener('keyboardWillShow', info => setOpen(info.keyboardHeight > 0))
    await Keyboard.addListener('keyboardDidShow', info => setOpen(info.keyboardHeight > 0))
    await Keyboard.addListener('keyboardDidHide', () => setOpen(false))
  } catch (error) {
    initialized = false
    console.warn('Unable to initialize iOS keyboard controls', error)
  }
}
void initializeNativeKeyboard()
