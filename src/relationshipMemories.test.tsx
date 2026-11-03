import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RelationshipMemoriesView, { type RelationshipView } from './RelationshipMemoriesView'
import { defaultMemoryPolicy } from './longMemory'
import { journalDrafts, journalPeriodKey, memoryImage, relationshipEvents } from './relationshipMemories'
import type { ConfirmedMemory } from './chatService'

afterEach(cleanup)
const event: ConfirmedMemory = { id: 'sea', characterId: 'lu', category: 'relationship', text: '我们一起完成海边故事', confirmedAt: '2026-11-01T23:30:00Z', state: 'confirmed', sourceMessageId: 1 }
const older = { ...event, id: 'dinner', sourceMessageId: undefined, text: '我们一起做了晚饭', confirmedAt: '2026-10-30T10:00:00Z' }
function setup(view: RelationshipView, overrides: Partial<React.ComponentProps<typeof RelationshipMemoriesView>> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined)
  render(<RelationshipMemoriesView view={view} role="lu" selected="lu" memories={[event, older]} policy={defaultMemoryPolicy} messages={[]} search="" category="all" onSave={onSave} onManage={vi.fn()} {...overrides} />)
  return { onSave }
}
describe('relationship memories', () => {
  it('isolates confirmed shared events, ignores message counts, withdrawals and inactive memories', () => {
    const excluded = [{ ...event, id: 'pending', state: 'pending' as const }, { ...event, id: 'archive', state: 'archived' as const }, { ...event, id: 'other', characterId: 'chen' as const }, { ...event, id: 'profile', category: 'profile' as const }, { ...event, id: 'off', enabled: false }, { ...event, id: 'expiry', expiresAt: '2000-01-01T00:00:00Z' }]
    expect(relationshipEvents([event, older, ...excluded], 'lu', defaultMemoryPolicy, [])).toEqual([older, event])
    expect(relationshipEvents([event], 'lu', defaultMemoryPolicy, [{ id: 1, from: 'user', text: '', time: '', withdrawn: true }])).toEqual([])
    expect(relationshipEvents([event], 'lu', { ...defaultMemoryPolicy, disabledCategories: ['relationship'] }, [])).toEqual([])
  })
  it('sorts actual instants rather than lexicographic timestamp strings', () => {
    const later = { ...event, id: 'later', confirmedAt: '2026-11-01T00:30:00Z' }
    const earlier = { ...older, id: 'earlier', confirmedAt: '2026-11-01T01:00:00+08:00' }
    expect(relationshipEvents([later, earlier], 'lu', defaultMemoryPolicy, [])).toEqual([earlier, later])
    expect(journalDrafts([later, earlier], 'week')[0].sources).toEqual([earlier, later])
  })
  it('groups UTC ISO weeks and months correctly at year and timezone boundaries', () => {
    expect(journalPeriodKey('2021-01-01T00:00:00Z', 'week')).toBe('2020-W53')
    expect(journalPeriodKey('2026-11-02T00:30:00+08:00', 'month')).toBe('2026-11')
    expect(journalPeriodKey('2026-11-01T00:30:00+08:00', 'month')).toBe('2026-10')
    expect(journalPeriodKey('invalid', 'week')).toBeNull()
    const drafts = journalDrafts([older, event, { ...event, sensitive: true }, { ...event, text: '我们讨论了我的抑郁诊断' }], 'week')
    expect(drafts[0].sources).toHaveLength(2)
    expect(journalDrafts(Array.from({ length: 50 }, (_, i) => ({ ...event, id: String(i), text: '共同故事'.repeat(100) })), 'week')[0].text.length).toBeLessThanOrEqual(1000)
  })
  it('uses only same-role source images, never withdrawn or remote images', () => {
    const message = { id: 1, from: 'user' as const, text: '', time: '', kind: 'image' as const, attachment: { name: '海边.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,aA==' } }
    expect(memoryImage(event, [message])).toEqual(message.attachment)
    expect(memoryImage(event, [{ ...message, withdrawn: true }])).toBeNull()
    expect(memoryImage(event, [{ ...message, attachment: { ...message.attachment, dataUrl: 'https://example.org/image.png' } }])).toBeNull()
    setup('cards', { messages: [message] })
    expect(screen.getByRole('img', { name: '回忆照片：海边.png' })).toBeInTheDocument()
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByText('照片暂不可用 · 回忆插画')).toBeInTheDocument()
  })
  it('displays chronological timeline and filters shared-event text', () => {
    setup('timeline')
    expect(screen.getAllByRole('heading', { level: 3 }).map(item => item.textContent)).toEqual([older.text, event.text])
  })
  it('saves journal snapshots only after explicit preview and confirmation', async () => {
    const { onSave } = setup('journals')
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '预览并确认' }))
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '预览并确认' }))
    fireEvent.click(screen.getByRole('button', { name: '确认保存周记' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ category: 'relationship', text: expect.stringContaining('【周记 · 2026-W44】') }))
    await waitFor(() => expect(screen.getByRole('button', { name: '已保存这份摘录' })).toBeDisabled())
  })
  it('shows errors and permits retry instead of falsely reporting saved', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('quota'))
    setup('journals', { onSave })
    fireEvent.click(screen.getByRole('button', { name: '预览并确认' }))
    fireEvent.click(screen.getByRole('button', { name: '确认保存周记' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('摘录未保存'))
    expect(screen.getByRole('button', { name: '确认保存周记' })).toBeEnabled()
  })
  it('respects extraction controls and never saves a journal to a different role', () => {
    setup('journals', { selected: 'chen' })
    expect(screen.getByRole('button', { name: '预览并确认' })).toBeDisabled()
    cleanup()
    setup('journals', { policy: { ...defaultMemoryPolicy, extractionEnabled: false } })
    expect(screen.queryByRole('button', { name: '预览并确认' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('自动整理已关闭')
  })
  it('rejects stale previews after sources or extraction policy change', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const props = { view: 'journals' as const, role: 'lu' as const, selected: 'lu' as const, memories: [event], policy: defaultMemoryPolicy, messages: [], search: '', category: 'all', onSave, onManage: vi.fn() }
    const { rerender } = render(<RelationshipMemoriesView {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '预览并确认' }))
    rerender(<RelationshipMemoriesView {...props} policy={{ ...defaultMemoryPolicy, extractionEnabled: false }} />)
    fireEvent.click(screen.getByRole('button', { name: '确认保存周记' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('请重新预览后保存')
  })
  it('does not recursively digest saved journals or show duplicates after reload', () => {
    const journal = { ...event, id: 'journal', text: journalDrafts([event, older], 'week')[0].text }
    expect(relationshipEvents([event, older, journal], 'lu', defaultMemoryPolicy, [])).toEqual([older, event])
    setup('journals', { memories: [event, older, journal] })
    expect(screen.getByRole('button', { name: '已保存这份摘录' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '月记' }))
    expect(screen.getAllByRole('button', { name: '预览并确认' })).toHaveLength(2)
  })
})
