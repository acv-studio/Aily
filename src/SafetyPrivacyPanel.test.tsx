import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import SafetyPrivacyPanel, { SafetyConsent } from './SafetyPrivacyPanel'
afterEach(cleanup)
it('requires both adult status and disclosure and prevents underage continuation', () => {
  const accepted = vi.fn()
  render(<SafetyConsent onAccepted={accepted} />)
  const next = screen.getByRole('button', { name: '遇见 TA' })
  expect(next).toBeDisabled()
  fireEvent.click(screen.getByLabelText('我已年满 18 周岁'))
  expect(next).toBeDisabled()
  fireEvent.click(screen.getByLabelText('我理解 AI 身份与数据说明'))
  expect(next).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '我未满 18 周岁' }))
  expect(next).toBeDisabled(); expect(accepted).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('暂不能使用')
})
it('requires exact destructive confirmation and can cancel without deleting', () => {
  const remove = vi.fn()
  render(<SafetyPrivacyPanel close={vi.fn()} onDelete={remove} />)
  fireEvent.click(screen.getByRole('button', { name: '删除本机使用资料' }))
  const submit = screen.getByRole('button', { name: '永久删除并退出' })
  expect(submit).toBeDisabled()
  fireEvent.change(screen.getByLabelText('输入“删除”确认'), { target: { value: '删除' } })
  expect(submit).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '取消删除' }))
  expect(remove).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: '永久删除并退出' })).not.toBeInTheDocument()
})
