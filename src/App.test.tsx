import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { db, loadLocalData } from './db'

beforeEach(async () => { localStorage.clear(); sessionStorage.clear(); await db.delete(); await db.open() })
afterEach(cleanup)

describe('Aily core journey', () => {
  it('introduces the memory-first value proposition after loading storage', async () => {
    render(<App />)
    expect(await screen.findByText(/会生长/)).toBeInTheDocument()
    expect(screen.getByText(/数据仅保存在当前设备/)).toBeInTheDocument()
  })

  it('persists character choice in IndexedDB instead of a duplicate localStorage blob', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /遇见 TA/ }))
    fireEvent.click(screen.getByRole('button', { name: /陈奕恒/ }))
    fireEvent.click(screen.getByRole('button', { name: /开始我们的故事/ }))
    await waitFor(() => expect(screen.getAllByText('陈奕恒')).toHaveLength(2))
    expect((await loadLocalData()).settings.selected).toBe('chen')
    expect(localStorage.getItem('aily-demo-state')).toBeNull()
  })
})
