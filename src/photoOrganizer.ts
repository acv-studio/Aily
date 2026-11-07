export type OrganizerPhoto = { id: string; name: string; createdAt: string; source: 'native' | 'library' }
export type SwipeAction = 'previous' | 'next' | 'pending' | 'keep'
export function photoSwipe(dx: number, dy: number): SwipeAction | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 60) return null
  // Ambiguous diagonals are ignored to avoid accidental decisions.
  if (Math.abs(dy) > Math.abs(dx) * 1.25) return dy < 0 ? 'pending' : 'keep'
  if (Math.abs(dx) > Math.abs(dy) * 1.25) return dx < 0 ? 'next' : 'previous'
  return null
}
export function randomPhoto(photos: OrganizerPhoto[], exclude?: string): OrganizerPhoto | undefined {
  const candidates = photos.filter(photo => photo.id !== exclude)
  const list = candidates.length ? candidates : photos
  return list.length ? list[Math.floor(Math.random() * list.length)] : undefined
}
export const decisionKey = (photo: OrganizerPhoto) => `${photo.source}:${photo.id}`
