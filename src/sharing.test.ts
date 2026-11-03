import { describe, expect, it, vi } from 'vitest'
import { defaultMemoryPolicy } from './longMemory'
import type { ConfirmedMemory } from './chatService'
import { invitedRole, invitationLink, renderMemoryCard, shareableMemory, shareCard } from './sharing'
const memory: ConfirmedMemory = { id: 'private-id', characterId: 'lu', text: '一起写下海边明信片', confirmedAt: '2026-01-01', category: 'relationship', state: 'confirmed' }

describe('private sharing boundary', () => {
  it('only puts a role in clean invitation links, including nested deployments', () => {
    expect(invitationLink('chen', 'https://user:secret@example.com/aily/?key=private#chat')).toBe('https://example.com/aily/#invite=chen')
    expect(() => invitationLink('lu', 'file:///private/app')).toThrow()
    expect(invitedRole('#invite=gu')).toBe('gu')
    for (const invalid of ['#invite=admin', '#invite=lu&name=private', '#invite=lu%20', '#chat']) expect(invitedRole(invalid)).toBeNull()
  })
  it('excludes inactive, personal, sensitive, expired and withdrawn-source memories', () => {
    expect(shareableMemory(memory)).toBe(true)
    for (const patch of [{ state: 'pending' }, { state: 'archived' }, { enabled: false }, { sensitive: true }, { category: 'profile' }, { expiresAt: '2020-01-01' }, { confirmedAt: 'invalid' }, { confirmedAt: '2999-01-01' }]) expect(shareableMemory({ ...memory, ...patch } as ConfirmedMemory)).toBe(false)
    expect(shareableMemory(memory, { ...defaultMemoryPolicy, disabledCategories: ['relationship'] })).toBe(false)
    const sourced = { ...memory, sourceMessageId: 42 }
    expect(shareableMemory(sourced)).toBe(false)
    expect(shareableMemory(sourced, undefined, [{ id: 42, from: 'user', time: '', text: '', withdrawn: true }])).toBe(false)
    expect(shareableMemory(sourced, undefined, [{ id: 42, from: 'user', time: '', text: '' }])).toBe(true)
  })
  it('paints only explicitly supplied public copy and discloses AI identity', async () => {
    const painted: string[] = []
    const ctx = { fillRect: vi.fn(), strokeRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), stroke: vi.fn(), fillText: (text: string) => painted.push(text), measureText: (text: string) => ({ width: text.length * 32 }), createRadialGradient: () => ({ addColorStop: vi.fn() }) }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['png'], { type: 'image/png' })))
    expect((await renderMemoryCard({ role: 'lu', text: '公开故事' })).type).toBe('image/png')
    expect(painted.join(' ')).toContain('公开故事')
    expect(painted.join(' ')).toContain('AI 角色')
    expect(painted.join(' ')).not.toContain(memory.text)
    expect(painted.join(' ')).not.toContain(memory.id)
    vi.restoreAllMocks()
  })
  it('falls back when files cannot be shared, propagates cancellation without downloading', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'))
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false })
    expect(await shareCard(new Blob())).toBe(false); expect(share).not.toHaveBeenCalled()
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    await expect(shareCard(new Blob())).rejects.toHaveProperty('name', 'AbortError')
    share.mockResolvedValue(undefined)
    expect(await shareCard(new Blob())).toBe(true)
    expect(share.mock.calls.at(-1)?.[0].files[0].name).toBe('aily-memory.png')
    delete (navigator as unknown as Record<string, unknown>).share
    delete (navigator as unknown as Record<string, unknown>).canShare
  })
})
