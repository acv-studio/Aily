import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RockPaperScissors, { decideWinner } from './RockPaperScissors'

afterEach(cleanup)
function play() {
  fireEvent.click(screen.getByRole('button', { name: /石头/ }))
  fireEvent.click(screen.getByRole('button', { name: /剪刀/ }))
}
describe('two-stage rock paper scissors', () => {
  it('decides outcomes correctly', () => {
    expect(decideWinner('石头', '剪刀')).toBe('user')
    expect(decideWinner('布', '剪刀')).toBe('character')
    expect(decideWinner('石头', '石头')).toBe('draw')
  })
  it('saves only after explicit confirmation and waits before closing', async () => {
    let resolve!: () => void
    const complete = vi.fn(() => new Promise<void>(done => { resolve = done }))
    const close = vi.fn()
    render(<RockPaperScissors characterName="陆听澜" onComplete={complete} onClose={close} />)
    play()
    expect(complete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '收下这段回忆' }))
    expect(complete).toHaveBeenCalledWith(expect.stringContaining('实际出剪刀'))
    expect(screen.getByRole('button', { name: '正在保存…' })).toBeDisabled()
    expect(close).not.toHaveBeenCalled()
    resolve()
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
  })
  it('retains result and permits retry with the same summary after a save failure', async () => {
    const complete = vi.fn().mockRejectedValueOnce(new Error('此类记忆已关闭')).mockResolvedValueOnce(undefined)
    const close = vi.fn()
    render(<RockPaperScissors characterName="陆听澜" onComplete={complete} onClose={close} />)
    play()
    fireEvent.click(screen.getByRole('button', { name: '收下这段回忆' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('此类记忆已关闭')
    expect(close).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '重试保存回忆' }))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(complete.mock.calls[1][0]).toBe(complete.mock.calls[0][0])
  })
  it('never writes permanent memories in temporary mode', () => {
    const complete = vi.fn(), close = vi.fn()
    render(<RockPaperScissors temporary characterName="陆听澜" onComplete={complete} onClose={close} />)
    play()
    expect(screen.getByText('临时会话不能保存长期记忆')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '关闭小游戏' }).at(-1)!)
    expect(complete).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })
})
