import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'

describe('Aily core journey', () => {
  beforeEach(() => localStorage.clear())

  it('introduces the memory-first value proposition', () => {
    render(<App />)
    expect(screen.getByText(/会生长/)).toBeInTheDocument()
    expect(screen.getByText(/数据仅保存在当前设备/)).toBeInTheDocument()
  })

  it('lets a user choose a character and enter the app', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /遇见 TA/ }))
    fireEvent.click(screen.getByRole('button', { name: /陈奕恒/ }))
    fireEvent.click(screen.getByRole('button', { name: /开始我们的故事/ }))
    expect(screen.getAllByText('陈奕恒')).toHaveLength(2)
    expect(localStorage.getItem('aily-demo-state')).toContain('chen')
  })
})
