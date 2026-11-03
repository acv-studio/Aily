import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import InteractiveStory from './InteractiveStory'

describe('interactive story', () => {
  it('records the selected branch as a relationship memory', () => {
    const complete = vi.fn()
    render(<InteractiveStory characterName="陆听澜" onComplete={complete} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '推开厨房的门' }))
    fireEvent.click(screen.getByRole('button', { name: /从背后抱住他/ }))
    expect(screen.getByText('这一晚，被好好记住了')).toBeInTheDocument()
    expect(complete).toHaveBeenCalledWith(expect.stringContaining('从背后抱住他'))
  })
})
