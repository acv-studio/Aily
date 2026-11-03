import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RelationshipPanel from './RelationshipPanel'
import { defaultOnboardingProfile } from './onboarding'
import { defaultMemoryPolicy } from './longMemory'

afterEach(cleanup)
const memories = Array.from({ length: 9 }, (_, i) => ({ id: `event-${i}`, characterId: 'lu' as const, text: '一起分享心事', confirmedAt: '2026-01-01' }))
const profile = defaultOnboardingProfile('lu')
describe('relationship presentation', () => {
  it('locks other roles and never exposes a numerical stage score', () => {
    render(<RelationshipPanel role="chen" memories={memories} policy={defaultMemoryPolicy} profile={profile} onSave={vi.fn()} />)
    expect(screen.getByRole('region', { name: '关系阶段' }).textContent).not.toMatch(/\d|%|还差/)
    expect(screen.queryByLabelText('专属称呼')).toBeNull()
    expect(screen.getByText('亲密阶段解锁，由你决定是否使用。')).toBeInTheDocument()
  })
  it('requires explicit consent and saves only the selected role name', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<RelationshipPanel role="lu" memories={memories} policy={defaultMemoryPolicy} profile={{ ...profile, exclusiveNames: { chen: '阿雨' } }} onSave={save} />)
    fireEvent.change(screen.getByLabelText('专属称呼'), { target: { value: ' 雨宝 ' } })
    expect(screen.getByLabelText('同意这位角色使用专属称呼')).not.toBeChecked()
    fireEvent.click(screen.getByLabelText('同意这位角色使用专属称呼'))
    fireEvent.click(screen.getByRole('button', { name: '保存专属称呼' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ familiarNames: true, exclusiveNames: { lu: '雨宝', chen: '阿雨' } })))
  })
  it('revokes a name without removing another role or changing the stage', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<RelationshipPanel role="lu" memories={memories} policy={defaultMemoryPolicy} profile={{ ...profile, familiarNames: true, exclusiveNames: { lu: '雨宝', chen: '阿雨' } }} onSave={save} />)
    fireEvent.click(screen.getByLabelText('同意这位角色使用专属称呼'))
    fireEvent.click(screen.getByRole('button', { name: '保存专属称呼' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ exclusiveNames: { chen: '阿雨' } })))
    expect(screen.getByRole('heading', { name: '亲密' })).toBeInTheDocument()
  })
  it('does not report success when persistence fails', async () => {
    render(<RelationshipPanel role="lu" memories={memories} policy={defaultMemoryPolicy} profile={profile} onSave={vi.fn().mockRejectedValue(new Error('storage'))} />)
    fireEvent.click(screen.getByRole('button', { name: '保存专属称呼' }))
    await screen.findByText('称呼未保存，请重试。')
  })
})
