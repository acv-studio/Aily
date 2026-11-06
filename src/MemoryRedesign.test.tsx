import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { it, expect, vi } from 'vitest'
import MemoryPanel from './MemoryPanel'
import { setLocale } from './i18n'

it('keeps compact memory cards editable and opens the add form', async () => {
  setLocale('zh-CN')
  const update = vi.fn().mockResolvedValue(undefined)
  render(<MemoryPanel selected="lu" memories={[{id:'test',characterId:'lu',text:'喜欢蓝色',confirmedAt:'2026-11-05T10:00:00Z'}]} onSave={vi.fn()} onUpdate={update} onDelete={vi.fn()} onClear={vi.fn()}/>)
  expect(screen.queryByText('LONG-TERM MEMORY')).toBeNull()
  expect(screen.getByText('喜欢蓝色')).toBeInTheDocument()
  fireEvent.click(screen.getByText('管理这条记忆'))
  fireEvent.click(screen.getByRole('button',{name:'编辑'}))
  fireEvent.change(screen.getByLabelText('编辑记忆内容'),{target:{value:'喜欢紫色'}})
  fireEvent.click(screen.getByRole('button',{name:'保存记忆'}))
  await waitFor(()=>expect(update).toHaveBeenCalledWith('test',expect.objectContaining({text:'喜欢紫色'})))
  await waitFor(()=>expect(screen.queryByLabelText('编辑记忆内容')).toBeNull())
  fireEvent.click(screen.getByRole('button',{name:'＋ 添加记忆'}))
  expect(screen.getByLabelText('编辑记忆内容')).toBeInTheDocument()
})
