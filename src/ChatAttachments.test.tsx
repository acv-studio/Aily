import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import ChatPanel, { type ChatPanelProps } from './ChatPanel'
import { characters } from './data'

function panel(overrides: Partial<ChatPanelProps> = {}) {
  const props: ChatPanelProps = {
    character: characters[0], messages: [], draft: '', setDraft: vi.fn(),
    send: vi.fn(async () => {}), saveMemory: vi.fn(async () => {}), withdraw: vi.fn(async () => {}),
    close: vi.fn(), stop: vi.fn(), replying: false, error: '', demo: true,
    openGame: vi.fn(), openStory: vi.fn(), ...overrides,
  }
  const view = render(<ChatPanel {...props} />)
  return { ...view, props }
}
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const expand = () => fireEvent.click(screen.getByRole('button', { name: '更多发送选项' }))
const selectFile = async (kind: '照片' | '视频', file: File) => {
  await act(async () => fireEvent.change(screen.getByLabelText(`选择${kind}文件`), { target: { files: [file] } }))
  await waitFor(() => expect(screen.queryByText('正在读取附件…')).not.toBeInTheDocument())
}

describe('chat plus attachment menu', () => {
  it('shows three options on the right, preserves draft, closes with Escape and outside click', () => {
    const view = panel({ draft: '草稿' })
    const plus = screen.getByRole('button', { name: '更多发送选项' })
    expect(plus).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: '照片' })).not.toBeInTheDocument()
    expand()
    for (const name of ['照片', '视频', '表情']) expect(screen.getByRole('button', { name })).toBeVisible()
    expect(screen.getByRole('textbox', { name: '发消息' })).toHaveValue('草稿')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(plus).toHaveFocus()
    expect(plus).toHaveAttribute('aria-expanded', 'false')
    expand()
    fireEvent.pointerDown(view.container.querySelector('.messages')!)
    expect(plus).toHaveAttribute('aria-expanded', 'false')
    expect(view.props.send).not.toHaveBeenCalled()
  })

  it('inserts an emoji at the cursor, preserves text, and sends only on Send', async () => {
    const send = vi.fn(async () => {})
    function Harness() {
      const [draft, setDraft] = useState('你好朋友')
      return <ChatPanel character={characters[0]} messages={[]} draft={draft} setDraft={setDraft} send={send} saveMemory={vi.fn()} withdraw={vi.fn()} close={vi.fn()} stop={vi.fn()} replying={false} error="" demo openGame={vi.fn()} openStory={vi.fn()} />
    }
    render(<Harness />)
    const input = screen.getByRole('textbox', { name: '发消息' }) as HTMLInputElement
    input.setSelectionRange(2, 2)
    expand()
    fireEvent.click(screen.getByRole('button', { name: '表情' }))
    fireEvent.click(screen.getByRole('button', { name: '插入表情 😊' }))
    expect(input).toHaveValue('你好😊朋友')
    expect(input).toHaveFocus()
    expect(send).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送消息' })))
    expect(send).toHaveBeenCalledOnce()
  })

  it.each(['image', 'video'] as const)('previews and sends a local %s attachment, resets the chooser', async kind => {
    const view = panel()
    expand()
    const file = new File(['media'], kind === 'image' ? 'photo.png' : 'clip.mp4', { type: kind === 'image' ? 'image/png' : 'video/mp4' })
    await selectFile(kind === 'image' ? '照片' : '视频', file)
    expect(screen.getByRole('button', { name: '更多发送选项' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(file.name)).toBeInTheDocument()
    if (kind === 'video') expect(screen.getByLabelText('预览待发送视频')).toHaveAttribute('controls')
    else expect(screen.getByAltText(file.name)).toBeVisible()
    expect(view.props.send).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送消息' })))
    expect(view.props.send).toHaveBeenCalledWith(expect.objectContaining({ kind, attachment: expect.objectContaining({ mimeType: file.type, name: file.name, dataUrl: expect.stringContaining(`data:${file.type};base64,`) }) }))
    expect(screen.queryByText(file.name)).not.toBeInTheDocument()
  })

  it('rejects oversized, empty and nonvideo files without enabling send', async () => {
    panel()
    const oversized = new File(['x'], 'large.mp4', { type: 'video/mp4' })
    Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 })
    for (const file of [oversized, new File([], 'empty.mp4', { type: 'video/mp4' }), new File(['x'], 'bad.html', { type: 'text/html' })]) {
      await selectFile('视频', file)
      expect(screen.getByText('请选择 20MB 以内的 MP4、WebM 或 MOV 视频')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '发送消息' })).not.toBeInTheDocument()
    }
  })

  it('removes the preview and clears it when character or session changes', async () => {
    const view = panel()
    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' })
    await selectFile('视频', file)
    fireEvent.click(screen.getByRole('button', { name: '移除' }))
    expect(screen.queryByLabelText('预览待发送视频')).not.toBeInTheDocument()
    await selectFile('视频', file)
    view.rerender(<ChatPanel {...view.props} temporary />)
    expect(screen.queryByLabelText('预览待发送视频')).not.toBeInTheDocument()
    await selectFile('视频', file)
    view.rerender(<ChatPanel {...view.props} character={characters[1]} temporary />)
    expect(screen.queryByLabelText('预览待发送视频')).not.toBeInTheDocument()
  })

  it('disables plus while replying and provides a video format failure notice', () => {
    panel({ replying: true, messages: [
      { id: 1, from: 'user', text: '', time: '', kind: 'video', attachment: { name: 'clip.mp4', mimeType: 'video/mp4', dataUrl: 'data:video/mp4;base64,eA==' } },
      { id: 2, from: 'user', text: '', time: '', kind: 'video', withdrawn: true },
      { id: 3, from: 'user', text: '', time: '', kind: 'video' },
    ] })
    expect(screen.getByRole('button', { name: '更多发送选项' })).toBeDisabled()
    expect(screen.getAllByLabelText('播放视频消息')).toHaveLength(1)
    expect(screen.getByText('视频附件不可用')).toBeInTheDocument()
    fireEvent.error(screen.getByLabelText('播放视频消息'))
    expect(screen.getByText('此视频无法播放，请尝试 MP4（H.264）格式。')).toBeInTheDocument()
  })
})
