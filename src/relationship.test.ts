import { describe, expect, it } from 'vitest'
import { getRelationship } from './relationship'
import type { ConfirmedMemory } from './chatService'

const create = (count: number, characterId: 'lu' | 'chen' = 'lu'): ConfirmedMemory[] => Array.from({ length: count }, (_, index) => ({ id: `${characterId}-${index}`, characterId, text: '共同事件', confirmedAt: '2026-01-01' }))

describe('relationship stages', () => {
  it('advances only from the selected character shared events', () => {
    expect(getRelationship('lu', [...create(2), ...create(10, 'chen')]).stage.name).toBe('熟悉')
    expect(getRelationship('lu', create(5)).stage.name).toBe('信任')
  })

  it('reports progress without exposing a love score', () => {
    const relationship = getRelationship('lu', create(3))
    expect(relationship.remaining).toBe(2)
    expect(relationship.progress).toBeCloseTo(1 / 3)
  })
})
