import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { db, loadLocalData, saveSetting } from './db'

beforeEach(async () => { localStorage.clear(); sessionStorage.clear(); await db.delete(); await db.open() })
afterEach(cleanup)

describe('Aily core journey', () => {
  it('requires new disclosure even when a previous profile is already onboarded', async () => {
    await saveSetting('onboarded', true)
    render(<App />)
    expect(await screen.findByRole('button', { name: '确认并继续' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /去找他/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('我已年满 18 周岁'))
    fireEvent.click(screen.getByLabelText('我理解 AI 身份与数据说明'))
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }))
    expect(await screen.findByRole('button', { name: /去找他/ })).toBeInTheDocument()
  })

  it('introduces the memory-first value proposition after loading storage', async () => {
    render(<App />)
    expect(await screen.findByText(/会生长/)).toBeInTheDocument()
    expect(screen.getByText(/本机优先保存，外部模型另有传输/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /遇见 TA/ })).toBeDisabled()
  })

  it('persists character choice in IndexedDB instead of a duplicate localStorage blob', async () => {
    render(<App />)
    await screen.findByRole('button', { name: /遇见 TA/ })
    fireEvent.click(screen.getByLabelText('我已年满 18 周岁'))
    fireEvent.click(screen.getByLabelText('我理解 AI 身份与数据说明'))
    fireEvent.click(screen.getByRole('button', { name: /遇见 TA/ }))
    fireEvent.click(screen.getByRole('button', { name: /陈奕恒/ }))
    fireEvent.click(screen.getByRole('button', { name: /开始我们的故事/ }))
    await waitFor(() => expect(screen.getAllByText('陈奕恒')).toHaveLength(2))
    expect((await loadLocalData()).settings.selected).toBe('chen')
    expect(localStorage.getItem('aily-demo-state')).toBeNull()
  })
})
