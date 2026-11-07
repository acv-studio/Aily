import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { addReminder, actOnReminderNotification, evaluateReminders, loadReminderState, saveReminderContext, saveReminderQuietHours, updateReminder, type Reminder, type ReminderContext, type ReminderState } from './smartReminders'
import { reminderNotifications, type ReminderNotificationIntent } from './reminderNotifications'
import { subscribeReminderChanges } from './reminderEvents'

export default function useSmartReminders(enabled: boolean, onNotificationOpen?: () => void) {
  const [state, setState] = useState<ReminderState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const alive = useRef(false)
  const paused = useRef(false)
  const checking = useRef(false)
  const pending = useRef(new Set<Promise<unknown>>())
  const mutations = useRef(0)
  const onOpen = useRef(onNotificationOpen); onOpen.current = onNotificationOpen
  const [openedNotificationId, setOpenedNotificationId] = useState<string | null>(null)
  const notifications = useSyncExternalStore(reminderNotifications.subscribe, reminderNotifications.getSnapshot, reminderNotifications.getSnapshot)

  const run = useCallback(async (operation: () => Promise<unknown>, mutation = true): Promise<boolean> => {
    if (paused.current || !alive.current) return false
    if (mutation) { mutations.current++; setBusy(true) }
    const work = (async () => {
      try {
        await operation()
        // Do not start a scheduler write after deletion has begun.
        if (!paused.current) await evaluateReminders()
        const next = await loadReminderState()
        if (alive.current && !paused.current) {
          setState(next); setError('')
          // Saving a reminder succeeded even if OS scheduling fails. Retry notifications, not the add operation.
          try { await reminderNotifications.sync() } catch { /* Dedicated notification status exposes the failure. */ }
        }
        return true
      } catch (failure) {
        if (alive.current && !paused.current) setError(failure instanceof Error ? failure.message : '提醒操作失败，请重试')
        return false
      } finally {
        if (mutation) { mutations.current--; if (alive.current) setBusy(mutations.current > 0) }
      }
    })()
    pending.current.add(work)
    try { return await work } finally { pending.current.delete(work) }
  }, [])

  const refresh = useCallback(async () => {
    if (checking.current || paused.current || document.visibilityState === 'hidden') return
    checking.current = true
    try { await run(async () => {}, false) } finally { checking.current = false }
  }, [run])

  useEffect(() => {
    alive.current = true
    paused.current = !enabled
    if (!enabled) return () => { alive.current = false; paused.current = true }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15_000)
    const onVisible = () => { void refresh() }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive.current = false; paused.current = true
      window.clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, refresh])

  useEffect(() => {
    reminderNotifications.setActive(enabled)
    const detach = reminderNotifications.attach({ onResume: () => { void refresh() }, onIntent: async (intent: ReminderNotificationIntent) => {
      if (paused.current || !alive.current) return
      let accepted = false
      await run(async () => { accepted = await actOnReminderNotification(intent.reminderId, intent.snapshot, intent.fireAt, intent.action) })
      if (accepted && alive.current && !paused.current && intent.openApp) { setOpenedNotificationId(intent.reminderId); onOpen.current?.() }
    } })
    return () => { reminderNotifications.setActive(false); detach() }
  }, [enabled, refresh, run])
  useEffect(() => subscribeReminderChanges(() => { void refresh() }), [refresh])
  const notificationOperation = async (work: () => Promise<unknown>): Promise<boolean> => {
    if (paused.current || !alive.current) return false
    const task = work(); pending.current.add(task)
    try { return (await task) !== false } catch { return false } finally { pending.current.delete(task) }
  }
  const pauseAndDrain = async () => {
    paused.current = true; reminderNotifications.setActive(false)
    await Promise.allSettled([...pending.current])
    await reminderNotifications.reset()
  }
  return {
    state, error, busy, refresh, pauseAndDrain, notifications, openedNotificationId,
    enableNotifications: (value: boolean) => notificationOperation(() => reminderNotifications.setEnabled(value)),
    showNotificationDetails: (value: boolean) => notificationOperation(() => reminderNotifications.setShowDetails(value)),
    syncNotifications: () => notificationOperation(() => reminderNotifications.sync()),
    testNotification: () => notificationOperation(() => reminderNotifications.sendTest()),
    add: (input: Parameters<typeof addReminder>[0]) => run(() => addReminder(input)),
    act: (id: string, action: Parameters<typeof updateReminder>[1]) => run(() => updateReminder(id, action)),
    context: (value: ReminderContext) => run(() => saveReminderContext(value)),
    quiet: (value: ReminderState['quietHours']) => run(() => saveReminderQuietHours(value)),
    due: state?.reminders.filter((reminder: Reminder) => reminder.enabled && reminder.status === 'due') ?? [],
  }
}
export type SmartReminderController = ReturnType<typeof useSmartReminders>
