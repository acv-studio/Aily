import { Capacitor } from '@capacitor/core'
import { Clipboard } from '@capacitor/clipboard'

/** Copies only the caller's original text, including user-requested local-only text. */
export async function copyMessageText(text: string): Promise<void> {
  if (text.length === 0) throw new Error('Cannot copy an empty message')

  if (Capacitor.isNativePlatform()) {
    // The official plugin writes to iOS UIPasteboard / Android ClipboardManager.
    // A rejected native write must remain a failure, not a browser fallback.
    await Clipboard.write({ string: text })
    return
  }

  if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Some WebViews expose this API but reject permission/security checks.
      // Only a positively successful legacy copy may recover that failure.
    }
  }
  // Without the async API this runs synchronously in the user's click gesture.
  copyWithTextarea(text)
}

function copyWithTextarea(text: string): void {
  if (typeof document === 'undefined' || !document.body || typeof document.execCommand !== 'function') {
    throw new Error('Clipboard copying is unavailable')
  }

  const focused = document.activeElement
  const field = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement ? focused : null
  const fieldSelection = field && field.selectionStart !== null && field.selectionEnd !== null
    ? { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection }
    : null
  const selection = document.getSelection()
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : []
  const endpoints = selection?.anchorNode && selection.focusNode
    ? { anchor: selection.anchorNode, anchorOffset: selection.anchorOffset, focus: selection.focusNode, focusOffset: selection.focusOffset }
    : null
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.tabIndex = -1
  // It must remain rendered/selectable for execCommand, not display:none.
  textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;font-size:16px;'

  try {
    document.body.append(textarea)
    textarea.focus({ preventScroll: true })
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    if (document.execCommand('copy') !== true) throw new Error('Clipboard copy failed')
  } finally {
    textarea.remove()
    // Focus/selection restoration is best effort if the previous node disappeared;
    // it must not swallow or replace a failed clipboard write.
    try {
      if (focused instanceof HTMLElement && focused.isConnected) focused.focus({ preventScroll: true })
    } catch { /* A detached or non-focusable element cannot be restored. */ }
    try {
      if (selection) {
        selection.removeAllRanges()
        for (const range of ranges) selection.addRange(range)
        if (ranges.length === 1 && endpoints && typeof selection.setBaseAndExtent === 'function') {
          selection.setBaseAndExtent(endpoints.anchor, endpoints.anchorOffset, endpoints.focus, endpoints.focusOffset)
        }
      }
    } catch { /* Original selection nodes may have been removed. */ }
    try {
      if (field?.isConnected && fieldSelection) {
        field.setSelectionRange(fieldSelection.start, fieldSelection.end, fieldSelection.direction ?? undefined)
      }
    } catch { /* Some input types cannot restore a text selection. */ }
  }
}
