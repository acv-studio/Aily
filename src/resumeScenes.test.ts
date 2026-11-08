import { describe, expect, it } from 'vitest'
import { resumePeriod, resumeScenes, selectResumeScene } from './resumeScenes'
import { characters } from './data'
const at = (hour: number) => new Date(2026, 10, 8, hour)
describe('presentation-only resume scenes', () => {
  it.each([[5, 'night'], [6, 'morning'], [10, 'morning'], [11, 'day'], [16, 'day'], [17, 'evening'], [21, 'evening'], [22, 'night']] as const)('uses local hour %s for %s', (hour, period) => expect(resumePeriod(at(hour))).toBe(period))
  it.each(characters)('has multiple localized scenes at every hour for $name, without repeating the previous one', character => {
    expect(resumeScenes[character.id]).toHaveLength(12)
    expect(new Set(resumeScenes[character.id].map(scene => scene.id)).size).toBe(12)
    for (let hour = 0; hour < 24; hour++) {
      const first = selectResumeScene(character.id, at(hour), undefined, () => 0)
      const next = selectResumeScene(character.id, at(hour), first.id, () => 0)
      expect(first.id).not.toBe(next.id)
      expect(first.periods).toContain(resumePeriod(at(hour)))
      expect(next.periods).toContain(resumePeriod(at(hour)))
      expect(first.activity).toBeTruthy(); expect(first.english).toBeTruthy()
      expect(first.detail).toBeTruthy(); expect(first.englishDetail).toBeTruthy()
    }
  })
  it.each([0, 1, -1, Number.NaN])('safely handles random value %s', value => expect(selectResumeScene('lu', at(12), undefined, () => value)).toBeDefined())
})
