import type { Reminder, ReminderState } from './smartReminders'

export interface ReminderNotificationPlan {
  reminderId: string
  occurrence: { createdAt: string; scheduledAt: string | null; snoozedUntil: string | null }
  at: Date
  title: string
  body: string
  token: string
}

const minute = 60_000
function quietAt(quiet: ReminderState['quietHours'], at: Date): boolean {
  if (!quiet.enabled) return false
  const value = at.getHours() * 60 + at.getMinutes()
  return quiet.start === quiet.end || (quiet.start < quiet.end
    ? value >= quiet.start && value < quiet.end
    : value >= quiet.start || value < quiet.end)
}

/** Calendar operations deliberately use the device's local time zone, not 24h
 * arithmetic. OS scheduling must use the returned absolute Date in that same
 * device zone; re-plan after a device timezone/quiet-hours change. Nonexistent
 * DST wall times follow Date's forward normalization; repeated times use its
 * earlier occurrence. This is a one-occurrence plan, never an OS repeat rule. */
function afterQuiet(quiet: ReminderState['quietHours'], at: Date): Date | null {
  if (!quietAt(quiet, at)) return at
  if (quiet.start === quiet.end) return null
  const end = new Date(at.getTime())
  const value = at.getHours() * 60 + at.getMinutes()
  if (quiet.start > quiet.end && value >= quiet.start) end.setDate(end.getDate() + 1)
  end.setHours(Math.floor(quiet.end / 60), quiet.end % 60, 0, 0)
  // If NOW is in the second occurrence of a DST fold, setHours may select
  // an end in the first occurrence. Select the corresponding later instant.
  if (end.getTime() <= at.getTime()) {
    end.setTime(end.getTime() + (at.getTimezoneOffset() - end.getTimezoneOffset()) * minute)
  }
  return end
}

function fresh(observedAt: string | null, now: number, hours: number): boolean {
  if (observedAt === null) return false
  const age = now - Date.parse(observedAt)
  return age >= 0 && age <= hours * 60 * minute
}
function currentContext(reminder: Reminder, state: ReminderState, now: number): boolean {
  if (now < Date.parse(reminder.createdAt)) return false
  if (reminder.scheduledAt !== null && now < Date.parse(reminder.scheduledAt)) return false
  const context = state.context
  return reminder.kind === 'weather'
    ? context.temperature !== null && reminder.temperatureBelow !== null && context.temperature < reminder.temperatureBelow && fresh(context.weatherObservedAt, now, 6)
    : context.mood === 'low' && fresh(context.moodObservedAt, now, 2)
}
function content(reminder: Reminder, at: Date, locale: string, showDetails: boolean): { title: string; body: string } {
  const en = locale === 'en' || locale.startsWith('en-')
  const title = showDetails ? reminder.title : en ? 'Aily reminder' : 'Aily 提醒'
  const generic = en ? 'You have a reminder. Open Aily to review it.' : '你有一条提醒，请打开 Aily 查看。'
  if (!showDetails || reminder.kind !== 'metro') return { title, body: generic }
  const late = reminder.scheduledAt !== null && at.getTime() >= Date.parse(reminder.scheduledAt)
  return { title, body: en
    ? `${late ? 'Estimated arrival time has passed. ' : ''}Verify your journey, station ${reminder.station}, and exit ${reminder.exit}; this reminder does not confirm your actual location.`
    : `${late ? '预计到达时间已过。' : ''}请核对行程、车站「${reminder.station}」及出口「${reminder.exit}」；此提醒不确认你的实际位置。` }
}

/** Pure planning over validated model state. Pending contextual reminders remain
 * foreground-only: no background condition is predicted. Already-due contextual
 * signals must still qualify NOW and are never moved beyond quiet hours.
 * Snooze overrides the original schedule and context, but not quiet hours.
 * Counters partition omitted active occurrences: cap overflow (deferredCount),
 * foreground/context-only (contextOnlyCount), and quiet suppression (quietSkippedCount).
 * Identity contains ONLY reminder ID and occurrence fields. The service owns
 * deduplication/claiming; planning does not deliver, complete, or re-arm repeats. */
export function planReminderNotifications(
  state: ReminderState,
  options: { now: Date; locale: string; showDetails: boolean; maxCount?: number },
): { notifications: ReminderNotificationPlan[]; deferredCount: number; contextOnlyCount: number; quietSkippedCount: number } {
  const now = options.now.getTime()
  if (!Number.isFinite(now)) throw new Error('Invalid notification planning clock')
  const maxCount = options.maxCount ?? 60
  if (!Number.isSafeInteger(maxCount) || maxCount < 0) throw new Error('Invalid notification count limit')
  const notifications: ReminderNotificationPlan[] = []
  let contextOnlyCount = 0, quietSkippedCount = 0
  for (const reminder of state.reminders) {
    if (!reminder.enabled || reminder.status === 'completed') continue
    const contextual = reminder.kind === 'weather' || reminder.kind === 'mood'
    let at: Date
    if (contextual && reminder.snoozedUntil === null) {
      if (reminder.status !== 'due' || !currentContext(reminder, state, now)) {
        contextOnlyCount++
        continue
      }
      // Check NOW, not a future quiet boundary: never defer a contextual signal.
      if (quietAt(state.quietHours, options.now)) {
        quietSkippedCount++
        continue
      }
      at = new Date(now + 1000)
    } else {
      const base = reminder.snoozedUntil !== null ? Date.parse(reminder.snoozedUntil)
        : reminder.status === 'due' ? now
          : reminder.scheduledAt !== null ? Date.parse(reminder.scheduledAt) - (reminder.kind === 'metro' ? reminder.leadMinutes * minute : 0)
            : now
      const fireAt = Math.max(base, Date.parse(reminder.createdAt))
      at = new Date(fireAt <= now ? now + 1000 : fireAt)
      if (reminder.kind !== 'metro') {
        const deferred = afterQuiet(state.quietHours, at)
        if (deferred === null) { quietSkippedCount++; continue }
        at = deferred
      }
    }
    const occurrence = { createdAt: reminder.createdAt, scheduledAt: reminder.scheduledAt, snoozedUntil: reminder.snoozedUntil }
    notifications.push({ reminderId: reminder.id, occurrence, at,
      ...content(reminder, at, options.locale, options.showDetails),
      token: JSON.stringify({ reminderId: reminder.id, occurrence }),
    })
  }
  notifications.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.reminderId < b.reminderId ? -1 : a.reminderId > b.reminderId ? 1 : 0))
  return { notifications: notifications.slice(0, maxCount), deferredCount: Math.max(0, notifications.length - maxCount), contextOnlyCount, quietSkippedCount }
}
