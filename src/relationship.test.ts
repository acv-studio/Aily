import { describe, expect, it } from 'vitest'
import { getRelationship } from './relationship'
import type { ConfirmedMemory } from './chatService'

const create = (count: number, characterId: 'lu' | 'chen' = 'lu'): ConfirmedMemory[] => Array.from({ length: count }, (_, index) => ({ id: `${characterId}-${index}`, characterId, text: '共同事件', confirmedAt: '2026-01-01' }))

describe('relationship stages', () => {
  it('advances only from the selected character shared events', () => {
    expect(getRelationship('lu', [...create(2), ...create(10, 'chen')]).stage.name).toBe('熟悉')
    expect(getRelationship('lu', create(5)).stage.name).toBe('信任')
  })

  it('ignores pending, disabled, expired, sensitive and future events', () => {
    const invalid = create(9).map((memory, i) => ({ ...memory, id: `invalid-${i}`, state: 'pending' as const }))
    expect(getRelationship('lu', [...create(1), ...invalid]).stage.name).toBe('初遇')
    const memory = create(1)[0]
    for (const patch of [{ enabled: false }, { state: 'archived' as const }, { state: 'rejected' as const }, { sensitive: true }, { expiresAt: '2020-01-01' }, { expiresAt: 'invalid' }, { confirmedAt: '2999-01-01' }]) {
      expect(getRelationship('lu', [{ ...memory, ...patch }]).count).toBe(0)
    }
    expect(getRelationship('lu', [{ ...memory, category: 'relationship' }], { extractionEnabled: true, disabledCategories: ['relationship'] }).count).toBe(0)
    expect(getRelationship('lu', [memory, memory]).count).toBe(1)
    expect(getRelationship('lu', [memory, { ...memory, enabled: false, updatedAt: '2026-02-01' }]).count).toBe(0)
  })

  it('reports progress without exposing a love score', () => {
    const relationship = getRelationship('lu', create(3))
    expect(relationship.remaining).toBe(2)
    expect(relationship.progress).toBeCloseTo(1 / 3)
  })
})
