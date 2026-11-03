import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SafetyPrivacyPanel, { SafetyConsent } from './SafetyPrivacyPanel'
import { setLocale } from './i18n'

afterEach(() => { cleanup(); setLocale('zh-CN') })
describe('bilingual safety and privacy controls', () => {
  it('retains both required checks and the underage gate in English', () => {
    setLocale('en')
    const accepted = vi.fn()
    render(<SafetyConsent onAccepted={accepted} />)
    const meet = screen.getByRole('button', { name: 'Meet your companion' })
    expect(meet).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'I am at least 18 years old' }))
    expect(meet).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand the AI identity and data disclosures' }))
    expect(meet).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'I am under 18' }))
    expect(meet).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('You cannot use this prototype')
    expect(accepted).not.toHaveBeenCalled()
  })
  it('uses a displayed locale-specific deletion word without accepting stale confirmation', () => {
    setLocale('en')
    const onDelete = vi.fn(async () => {})
    render(<SafetyPrivacyPanel close={vi.fn()} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete local usage data' }))
    const input = screen.getByRole('textbox', { name: 'Type “DELETE” to confirm' })
    const confirm = screen.getByRole('button', { name: 'Delete permanently and exit' })
    fireEvent.change(input, { target: { value: '删除' } }); expect(confirm).toBeDisabled()
    fireEvent.change(input, { target: { value: 'DELETE' } }); expect(confirm).toBeEnabled()
    act(() => setLocale('zh-CN'))
    expect(screen.getByRole('button', { name: '永久删除并退出' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '输入“删除”确认' })).toHaveValue('DELETE')
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消删除' }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
