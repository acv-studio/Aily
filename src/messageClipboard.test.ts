import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Capacitor } from '@capacitor/core'
import { Clipboard } from '@capacitor/clipboard'
import { copyMessageText } from './messageClipboard'

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn() } }))
vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: vi.fn(), read: vi.fn() } }))

const originalText = '  完整中文原文：你好，世界🌏\n第二行\n\n> 引用本身也是原文\n{"localOnly":true}\n末尾空格  '
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const execDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand')
let writeText: ReturnType<typeof vi.fn>
let readText: ReturnType<typeof vi.fn>
let execCopy: ReturnType<typeof vi.fn>

function setWebClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false)
  vi.mocked(Clipboard.write).mockResolvedValue(undefined)
  writeText = vi.fn().mockResolvedValue(undefined)
  readText = vi.fn()
  execCopy = vi.fn().mockReturnValue(true)
  setWebClipboard({ writeText, readText })
  Object.defineProperty(document, 'execCommand', { value: execCopy, configurable: true })
})

afterEach(() => {
  expect(Clipboard.read).not.toHaveBeenCalled()
  expect(readText).not.toHaveBeenCalled()
  document.body.replaceChildren()
  document.getSelection()?.removeAllRanges()
  vi.restoreAllMocks()
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  else Reflect.deleteProperty(navigator, 'clipboard')
  if (execDescriptor) Object.defineProperty(document, 'execCommand', execDescriptor)
  else Reflect.deleteProperty(document, 'execCommand')
})

describe('native message clipboard', () => {
  beforeEach(() => vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true))

  it.each(['iOS', 'Android'])('uses the official plugin for %s with only the complete original text', async () => {
    await expect(copyMessageText(originalText)).resolves.toBeUndefined()
    expect(Clipboard.write).toHaveBeenCalledExactlyOnceWith({ string: originalText })
    expect(writeText).not.toHaveBeenCalled()
    expect(execCopy).not.toHaveBeenCalled()
  })

  it('propagates native failures without claiming success or trying a Web fallback', async () => {
    const failure = new Error('Native clipboard unavailable')
    vi.mocked(Clipboard.write).mockRejectedValue(failure)
    await expect(copyMessageText(originalText)).rejects.toBe(failure)
    expect(writeText).not.toHaveBeenCalled()
    expect(execCopy).not.toHaveBeenCalled()
    expect(document.querySelector('textarea')).toBeNull()
  })
})

describe('Web message clipboard', () => {
  it('prefers writeText, preserving Chinese, multiline content and whitespace without metadata', async () => {
    await expect(copyMessageText(originalText)).resolves.toBeUndefined()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(originalText)
    expect(Clipboard.write).not.toHaveBeenCalled()
    expect(execCopy).not.toHaveBeenCalled()
    expect(document.querySelector('textarea')).toBeNull()
  })

  it.each([undefined, {}])('copies synchronously with a textarea when writeText is unavailable (%s)', async api => {
    setWebClipboard(api)
    let temporary: HTMLTextAreaElement | null = null
    execCopy.mockImplementation((command: string) => {
      temporary = document.querySelector('textarea')
      expect(command).toBe('copy')
      expect(temporary).toBe(document.activeElement)
      expect(temporary?.value).toBe(originalText)
      expect(temporary?.selectionStart).toBe(0)
      expect(temporary?.selectionEnd).toBe(originalText.length)
      expect(temporary?.readOnly).toBe(true)
      return true
    })
    const result = copyMessageText(originalText)
    // No await or timer before fallback: preserve the click's user activation.
    expect(execCopy).toHaveBeenCalledExactlyOnceWith('copy')
    expect(document.body.contains(temporary)).toBe(false)
    await expect(result).resolves.toBeUndefined()
    expect(Clipboard.write).not.toHaveBeenCalled()
  })

  it('allows rejected writeText to recover only after a confirmed fallback copy', async () => {
    writeText.mockRejectedValue(new Error('Permission denied'))
    await expect(copyMessageText(originalText)).resolves.toBeUndefined()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(originalText)
    expect(execCopy).toHaveBeenCalledExactlyOnceWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it.each(['false', 'throw'] as const)('rejects a failed fallback (%s), cleaning DOM and restoring input focus/selection', async failureKind => {
    setWebClipboard(undefined)
    const input = document.createElement('input')
    input.value = '保持输入框原来的选区'
    document.body.append(input)
    input.focus()
    input.setSelectionRange(2, 7, 'backward')
    const failure = new Error('execCommand failed')
    let temporary: Element | null = null
    execCopy.mockImplementation(() => {
      temporary = document.querySelector('textarea')
      if (failureKind === 'throw') throw failure
      return false
    })
    const result = copyMessageText(originalText)
    if (failureKind === 'throw') await expect(result).rejects.toBe(failure)
    else await expect(result).rejects.toThrow('Clipboard copy failed')
    expect(document.body.contains(temporary)).toBe(false)
    expect(document.querySelector('textarea')).toBeNull()
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(2)
    expect(input.selectionEnd).toBe(7)
    expect(input.selectionDirection).toBe('backward')
    expect(input.value).toBe('保持输入框原来的选区')
  })

  it('restores textarea focus and selection after successful fallback', async () => {
    setWebClipboard(undefined)
    const editor = document.createElement('textarea')
    editor.value = '正在编辑的文本\n不应被改变'
    document.body.append(editor)
    editor.focus()
    editor.setSelectionRange(1, 6, 'forward')
    await expect(copyMessageText(originalText)).resolves.toBeUndefined()
    expect(document.querySelectorAll('textarea')).toHaveLength(1)
    expect(document.activeElement).toBe(editor)
    expect(editor.selectionStart).toBe(1)
    expect(editor.selectionEnd).toBe(6)
    expect(editor.selectionDirection).toBe('forward')
    expect(editor.value).toBe('正在编辑的文本\n不应被改变')
  })

  it('restores the original DOM selection and focused element', async () => {
    setWebClipboard(undefined)
    const button = document.createElement('button')
    const paragraph = document.createElement('p')
    paragraph.textContent = '保留这段中文选区'
    document.body.append(button, paragraph)
    button.focus()
    const selection = document.getSelection()!
    const node = paragraph.firstChild!
    selection.setBaseAndExtent(node, 6, node, 2)
    execCopy.mockImplementation(() => {
      // Model the selection change caused by selecting the temporary textarea.
      selection.removeAllRanges()
      return true
    })
    await expect(copyMessageText(originalText)).resolves.toBeUndefined()
    expect(document.activeElement).toBe(button)
    expect(selection.anchorNode).toBe(node)
    expect(selection.anchorOffset).toBe(6)
    expect(selection.focusNode).toBe(node)
    expect(selection.focusOffset).toBe(2)
    expect(document.querySelector('textarea')).toBeNull()
  })

  it.each(['false', 'throw', 'unavailable'] as const)('never reports success when writeText rejects and fallback is %s', async outcome => {
    writeText.mockRejectedValue(new Error('Permission denied'))
    if (outcome === 'unavailable') Reflect.deleteProperty(document, 'execCommand')
    else execCopy.mockImplementation(() => {
      if (outcome === 'throw') throw new Error('Copy blocked')
      return false
    })
    await expect(copyMessageText(originalText)).rejects.toThrow()
    expect(document.querySelector('textarea')).toBeNull()
    expect(Clipboard.write).not.toHaveBeenCalled()
  })

  it('rejects when neither Web write mechanism exists', async () => {
    setWebClipboard(undefined)
    Reflect.deleteProperty(document, 'execCommand')
    await expect(copyMessageText(originalText)).rejects.toThrow('Clipboard copying is unavailable')
    expect(document.querySelector('textarea')).toBeNull()
  })
})

it.each([false, true])('rejects empty text before any clipboard operation (native=%s)', async native => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(native)
  await expect(copyMessageText('')).rejects.toThrow('Cannot copy an empty message')
  expect(Clipboard.write).not.toHaveBeenCalled()
  expect(writeText).not.toHaveBeenCalled()
  expect(execCopy).not.toHaveBeenCalled()
  expect(document.querySelector('textarea')).toBeNull()
})

it('does not trim a nonempty whitespace-only original', async () => {
  await expect(copyMessageText(' \n\t ')).resolves.toBeUndefined()
  expect(writeText).toHaveBeenCalledExactlyOnceWith(' \n\t ')
})
