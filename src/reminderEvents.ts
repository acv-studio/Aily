/** Device-local domain changes; no notification SDK or persistence dependencies. */
type ReminderChangeListener = () => void
const listeners = new Set<ReminderChangeListener>()

export function subscribeReminderChanges(listener: ReminderChangeListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Call only after a successful commit (also used by data-reset owners). */
export function notifyReminderChanges(): void {
  for (const listener of [...listeners]) {
    // A UI/service subscriber cannot turn an already committed mutation into a
    // rejected domain action, or prevent other subscribers from refreshing.
    try { listener() } catch { /* Subscribers own their error reporting. */ }
  }
}
