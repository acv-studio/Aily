import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SpeechControls, { type SpeechControlsProps } from './SpeechControls'
import type { ChatMessage } from './chatService'

class MockRecognition {
  static instances: MockRecognition[] = []
  lang = ''
  continuous = false
  interimResults = true
  onresult: ((event: any) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn()
  constructor() { MockRecognition.instances.push(this) }
}
class MockUtterance {
  lang = ''
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public text: string) {}
}
const speak = vi.fn()
const cancel = vi.fn()
const completed: ChatMessage = { id: 1, from: 'character', text: '你好，今天怎么样？', time: '', status: 'sent' }
function panel(overrides: Partial<SpeechControlsProps> = {}) {
  const props: SpeechControlsProps = { draft: '', setDraft: vi.fn(), messages: [completed], replying: false, ...overrides }
  return { ...render(<SpeechControls {...props} />), props }
}
function consentAndStart() {
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '开始听写' }))
  return MockRecognition.instances.at(-1)!
}
function result(session: MockRecognition, results: { text: string; final: boolean }[], resultIndex = 0) {
  act(() => session.onresult?.({ resultIndex, results: results.map(item => ({ isFinal: item.final, 0: { transcript: item.text } })) }))
}

beforeEach(() => {
  MockRecognition.instances = []
  speak.mockReset()
  cancel.mockReset()
  vi.stubGlobal('SpeechRecognition', MockRecognition)
  vi.stubGlobal('webkitSpeechRecognition', undefined)
  vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance)
  vi.stubGlobal('speechSynthesis', { speak, cancel })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('consent-gated browser dictation', () => {
  it('explains vendor audio privacy, requires explicit consent and a separate manual start', () => {
    panel()
    expect(screen.getByText(/部分浏览器会把麦克风音频发送/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始听写' })).toBeDisabled()
    expect(MockRecognition.instances).toHaveLength(0)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(MockRecognition.instances).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '开始听写' }))
    expect(MockRecognition.instances[0].start).toHaveBeenCalledOnce()
    expect(MockRecognition.instances[0]).toMatchObject({ lang: 'zh-CN', interimResults: false })
  })

  it('appends only final transcripts once, uses current draft, and never sends', () => {
    const view = panel({ draft: '原稿' })
    const session = consentAndStart()
    result(session, [{ text: '临时', final: false }])
    expect(view.props.setDraft).not.toHaveBeenCalled()
    view.rerender(<SpeechControls {...view.props} draft="编辑后的草稿" />)
    const finals = [{ text: '第一句', final: true }, { text: '第二句', final: true }]
    result(session, finals)
    expect(view.props.setDraft).toHaveBeenLastCalledWith('编辑后的草稿 第一句 第二句')
    result(session, finals)
    expect(view.props.setDraft).toHaveBeenCalledOnce()
    result(session, [...finals, { text: '第三句', final: true }], 2)
    expect(view.props.setDraft).toHaveBeenLastCalledWith('编辑后的草稿 第一句 第二句 第三句')
    expect(screen.getByText(/听写文字已加入草稿，请检查后手动发送/)).toBeInTheDocument()
    expect(speak).not.toHaveBeenCalled()
  })

  it('retains the final transcript after manual stop, then allows a fresh session', () => {
    const { props } = panel()
    const session = consentAndStart()
    fireEvent.click(screen.getByRole('button', { name: '停止听写' }))
    expect(session.stop).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '停止听写' })).toBeDisabled()
    result(session, [{ text: '停止后的确认文字', final: true }])
    expect(props.setDraft).toHaveBeenCalledWith('停止后的确认文字')
    act(() => session.onend?.())
    expect(session.onresult).toBeNull()
    expect(screen.getByRole('button', { name: '开始听写' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '开始听写' }))
    expect(MockRecognition.instances).toHaveLength(2)
  })

  it('supports the webkit-prefixed browser API', () => {
    vi.stubGlobal('SpeechRecognition', undefined)
    vi.stubGlobal('webkitSpeechRecognition', MockRecognition)
    panel()
    expect(consentAndStart().start).toHaveBeenCalledOnce()
  })

  it.each([
    ['not-allowed', /权限被拒绝/],
    ['service-not-allowed', /权限被拒绝/],
    ['audio-capture', /无法使用麦克风/],
    ['network', /网络服务不可用/],
    ['no-speech', /未检测到语音/],
    ['unknown', /语音识别失败/],
  ])('reports %s and ignores late final results after failure', (error, notice) => {
    const { props } = panel()
    const session = consentAndStart()
    const lateResult = session.onresult!
    act(() => session.onerror?.({ error }))
    expect(screen.getByText(notice)).toBeInTheDocument()
    expect(session.stop).toHaveBeenCalledOnce()
    act(() => lateResult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'late' } }] }))
    expect(props.setDraft).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '开始听写' })).toBeEnabled()
  })

  it.each(['construct', 'start'])('handles recognition %s failures without leaving controls active', failure => {
    vi.stubGlobal('SpeechRecognition', class extends MockRecognition {
      constructor() { super(); if (failure === 'construct') throw new Error('denied') }
      start = vi.fn(() => { throw new Error('denied') })
    })
    panel()
    consentAndStart()
    expect(screen.getByText(/无法开始听写/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始听写' })).toBeEnabled()
  })

  it('revokes consent and invalidates captured callbacks', () => {
    const { props } = panel()
    const session = consentAndStart()
    const lateResult = session.onresult!
    fireEvent.click(screen.getByRole('checkbox'))
    expect(session.stop).toHaveBeenCalledOnce()
    act(() => lateResult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'late' } }] }))
    expect(props.setDraft).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '开始听写' })).toBeDisabled()
  })

  it('stops dictation when replying begins and does not restart automatically', () => {
    const view = panel()
    const session = consentAndStart()
    view.rerender(<SpeechControls {...view.props} replying />)
    expect(session.stop).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '开始听写' })).toBeDisabled()
    view.rerender(<SpeechControls {...view.props} replying={false} />)
    expect(MockRecognition.instances).toHaveLength(1)
  })

  it('shows clear unsupported capability messages and keeps manual controls disabled', () => {
    vi.stubGlobal('SpeechRecognition', undefined)
    vi.stubGlobal('speechSynthesis', undefined)
    panel()
    expect(screen.getByText(/当前浏览器不支持语音识别/)).toBeInTheDocument()
    expect(screen.getByText(/当前浏览器不支持语音朗读/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始听写' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '朗读最新回复' })).toBeDisabled()
  })
})

describe('manual browser text playback', () => {
  it('reads the latest completed nonwithdrawn character text, never partial or failed replies', () => {
    panel({ messages: [
      completed,
      { ...completed, id: 2, text: '最近完成', status: undefined },
      { ...completed, id: 3, text: '用户', from: 'user' },
      { ...completed, id: 4, text: '撤回', withdrawn: true },
      { ...completed, id: 5, text: '生成中', status: 'sending' },
      { ...completed, id: 6, text: '失败', status: 'failed' },
      { ...completed, id: 7, text: '音频', kind: 'audio' },
    ], replying: true })
    expect(speak).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '朗读最新回复' }))
    expect(speak).toHaveBeenCalledOnce()
    expect(speak.mock.calls[0][0]).toMatchObject({ text: '最近完成', lang: 'zh-CN' })
    fireEvent.click(screen.getByRole('button', { name: '停止朗读' }))
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(screen.getByText('朗读已停止。')).toBeInTheDocument()
  })

  it('disables playback without eligible text', () => {
    panel({ messages: [{ ...completed, withdrawn: true }] })
    expect(screen.getByText(/暂无可朗读的已完成角色文字/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '朗读最新回复' })).toBeDisabled()
  })

  it.each(['end', 'error', 'throw'])('handles synthesis %s and allows a retry', event => {
    if (event === 'throw') speak.mockImplementation(() => { throw new Error('service unavailable') })
    panel()
    fireEvent.click(screen.getByRole('button', { name: '朗读最新回复' }))
    const active = speak.mock.calls[0][0] as MockUtterance
    if (event === 'end') act(() => active.onend?.())
    if (event === 'error') act(() => active.onerror?.())
    expect(screen.getByText(event === 'end' ? '朗读已结束。' : event === 'error' ? /朗读失败/ : /无法开始朗读/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '朗读最新回复' })).toBeEnabled()
  })

  it('cancels playback when the selected text is withdrawn and never auto-reads new replies', () => {
    const view = panel()
    fireEvent.click(screen.getByRole('button', { name: '朗读最新回复' }))
    view.rerender(<SpeechControls {...view.props} messages={[{ ...completed, withdrawn: true }]} />)
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(screen.getByText('消息已变化，朗读已停止。')).toBeInTheDocument()
    view.rerender(<SpeechControls {...view.props} messages={[{ ...completed, id: 2, text: '新消息' }]} />)
    expect(speak).toHaveBeenCalledOnce()
  })

  it('cancels withdrawn playback even if an older reply has identical text', () => {
    const view = panel({ messages: [completed, { ...completed, id: 2 }] })
    fireEvent.click(screen.getByRole('button', { name: '朗读最新回复' }))
    view.rerender(<SpeechControls {...view.props} messages={[completed, { ...completed, id: 2, withdrawn: true }]} />)
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: '停止朗读' })).toBeDisabled()
    expect(speak).toHaveBeenCalledOnce()
  })

  it('detaches handlers, stops recognition, cancels synthesis and guards late events on unmount', () => {
    const view = panel()
    const session = consentAndStart()
    const lateResult = session.onresult!
    fireEvent.click(screen.getByRole('button', { name: '朗读最新回复' }))
    const active = speak.mock.calls[0][0] as MockUtterance
    const lateEnd = active.onend!
    view.unmount()
    expect(session.stop).toHaveBeenCalledOnce()
    expect(session.onresult).toBeNull()
    expect(session.onerror).toBeNull()
    expect(session.onend).toBeNull()
    expect(active.onend).toBeNull()
    expect(active.onerror).toBeNull()
    expect(cancel).toHaveBeenCalledTimes(2)
    act(() => {
      lateResult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'late' } }] })
      lateEnd()
    })
    expect(view.props.setDraft).not.toHaveBeenCalled()
  })
})
