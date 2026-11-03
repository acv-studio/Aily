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
  it('switches between shared-event views and retains memory management', () => {
    render(<MemoryPanel memories={[{ ...memories[0], category: 'relationship', text: '我们完成共同故事' }]} selected="lu" onSave={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '回忆卡' }))
    expect(screen.getByText('回忆插画 · 非实拍照片')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '时间轴' }))
    expect(screen.getByRole('list')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '周记月记' }))
    expect(screen.getByRole('button', { name: '预览并确认' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '管理、编辑或删除记忆' }))
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument()
  })
  it('prevents journal view and role remounts while a save is pending', async () => {
    let finish!: () => void
    const onSave = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    render(<MemoryPanel memories={[{ ...memories[0], category: 'relationship', text: '我们完成共同故事' }]} selected="lu" onSave={onSave} onUpdate={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '周记月记' }))
    fireEvent.click(screen.getByRole('button', { name: '预览并确认' }))
    fireEvent.click(screen.getByRole('button', { name: '确认保存周记' }))
    expect(screen.getByRole('button', { name: '时间轴' })).toBeDisabled()
    expect(screen.getByLabelText('记忆角色')).toBeDisabled()
    expect(screen.getByRole('button', { name: '管理、编辑或删除记忆' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '时间轴' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    finish()
    await waitFor(() => expect(screen.getByRole('button', { name: '时间轴' })).toBeEnabled())
    expect(screen.getByRole('button', { name: '已保存这份摘录' })).toBeDisabled()
  })
  it('does not start a journal save while a policy write owns the navigation lock', async () => {
    let finish!: () => void
    const onPolicy = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<MemoryPanel memories={[{ ...memories[0], category: 'relationship', text: '我们完成共同故事' }]} selected="lu" onSave={onSave} onPolicy={onPolicy} onUpdate={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '周记月记' }))
    fireEvent.click(screen.getByRole('button', { name: '预览并确认' }))
    fireEvent.click(screen.getByText('记忆与敏感信息控制'))
    fireEvent.click(screen.getByLabelText('允许用户偏好记忆'))
    expect(screen.getByRole('button', { name: '确认保存周记' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '确认保存周记' }))
    expect(onSave).not.toHaveBeenCalled()
    finish()
    await waitFor(() => expect(screen.getByRole('button', { name: '确认保存周记' })).toBeEnabled())
  })
  it('filters by character and searches local facts', () => {
    setup(); expect(screen.getByText('不吃辣')).toBeInTheDocument(); expect(screen.queryByText('喜欢篮球')).toBeNull()
    fireEvent.change(screen.getByLabelText('记忆角色'), { target: { value: 'chen' } })
    expect(screen.getByText('喜欢篮球')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('搜索记忆'), { target: { value: '不存在' } })
    expect(screen.queryByText('喜欢篮球')).toBeNull()
  })
  it('changes importance and explicit expiry without changing them before save', async () => {
    const { onUpdate } = setup()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText('重要度'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('情境到期'), { target: { value: '2027-06-01' } })
    expect(onUpdate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存记忆' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('m1', expect.objectContaining({ importance: 5, expiresAt: expect.any(String) })))
    expect(Number.isFinite(Date.parse(onUpdate.mock.calls[0][1].expiresAt))).toBe(true)
  })
  it('restores archives only as a new pending proposal', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    render(<MemoryPanel memories={[{ ...memories[0], state: 'archived', enabled: false }]} selected="lu" onSave={vi.fn()} onUpdate={onUpdate} onDelete={vi.fn()} onClear={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '恢复引用' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '恢复归档' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('m1', { state: 'pending', enabled: false }))
  })
  it('requires explicit consent for sensitive proposals and does not offer the misleading resume control', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(<MemoryPanel memories={[{ ...memories[0], state: 'pending', sensitive: true, enabled: false }]} selected="lu" onSave={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()} onConfirm={onConfirm} />)
    expect(screen.getByText(/敏感信息：要我记住吗/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '恢复引用' })).toBeNull()
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认记住' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('m1'))
  })
  it('edits the content and category only after explicit save', async () => {
    const { onUpdate } = setup(); fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByLabelText('编辑记忆内容'), { target: { value: '可以微辣' } })
    expect(onUpdate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存记忆' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('m1', { text: '可以微辣', category: 'profile' }))
  })
})
