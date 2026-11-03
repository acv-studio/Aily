import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MemoryPanel from './MemoryPanel'

afterEach(cleanup)
const memories = [{ id: 'm1', characterId: 'lu' as const, text: '不吃辣', category: 'profile' as const, confirmedAt: '2026-11-02T10:00:00Z', enabled: true }, { id: 'm2', characterId: 'chen' as const, text: '喜欢篮球', confirmedAt: '2026-11-02T10:00:00Z' }]
function setup() {
  const onSave = vi.fn().mockResolvedValue(undefined), onUpdate = vi.fn().mockResolvedValue(undefined)
  render(<MemoryPanel memories={memories} selected="lu" onSave={onSave} onUpdate={onUpdate} onDelete={vi.fn()} onClear={vi.fn()} />)
  return { onSave, onUpdate }
}
describe('confirmed memory controls', () => {
  it('filters by character and searches local facts', () => {
    setup(); expect(screen.getByText('不吃辣')).toBeInTheDocument(); expect(screen.queryByText('喜欢篮球')).toBeNull()
    fireEvent.change(screen.getByLabelText('记忆角色'), { target: { value: 'chen' } })
    expect(screen.getByText('喜欢篮球')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('搜索记忆'), { target: { value: '不存在' } })
    expect(screen.queryByText('喜欢篮球')).toBeNull()
  })
  it('edits the content and category only after explicit save', async () => {
    const { onUpdate } = setup(); fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText('编辑记忆内容'), { target: { value: '可以微辣' } })
    expect(onUpdate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存记忆' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('m1', { text: '可以微辣', category: 'profile' }))
  })
})
