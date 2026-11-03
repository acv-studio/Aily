import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RockPaperScissors, { decideWinner } from './RockPaperScissors'

describe('two-stage rock paper scissors', () => {
  it('decides outcomes correctly', () => {
    expect(decideWinner('石头', '剪刀')).toBe('user')
    expect(decideWinner('布', '剪刀')).toBe('character')
    expect(decideWinner('石头', '石头')).toBe('draw')
  })

  it('locks promise, reveals actual moves and saves a memory', () => {
    const complete = vi.fn()
    render(<RockPaperScissors characterName="陆听澜" onComplete={complete} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /石头/ }))
    expect(screen.getByText(/你承诺出/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /剪刀/ }))
    expect(screen.getByText('这次你赢了')).toBeInTheDocument()
    expect(complete).toHaveBeenCalledWith(expect.stringContaining('实际出剪刀'))
  })
})
