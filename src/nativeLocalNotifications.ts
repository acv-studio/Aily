import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'
import { LocalNotifications, type LocalNotificationsPlugin, type LocalNotificationSchema } from '@capacitor/local-notifications'

export type NotificationApi = Pick<LocalNotificationsPlugin, 'checkPermissions' | 'requestPermissions' | 'schedule' | 'getAll' | 'cancel' | 'removeDeliveredNotificationsById' | 'registerActionTypes' | 'createChannel'>
export type NativeReminderEvent = { kind: 'received' | 'action'; notification: LocalNotificationSchema; actionId?: string } | { kind: 'resume' }
export function localNotificationsAvailable() { return Capacitor.isNativePlatform() && ['ios', 'android'].includes(Capacitor.getPlatform()) && Capacitor.isPluginAvailable('LocalNotifications') }
export const notificationApi: NotificationApi = LocalNotifications
/** Listener setup never requests notification permission, and removes only its own handles. */
export async function listenForNativeReminders(listener: (event: NativeReminderEvent) => void): Promise<() => Promise<void>> {
  const handles: PluginListenerHandle[] = []
  try {
    handles.push(await LocalNotifications.addListener('localNotificationActionPerformed', event => listener({ kind: 'action', notification: event.notification, actionId: event.actionId })))
    handles.push(await LocalNotifications.addListener('localNotificationReceived', notification => listener({ kind: 'received', notification })))
    handles.push(await App.addListener('appStateChange', state => { if (state.isActive) listener({ kind: 'resume' }) }))
    return async () => { await Promise.all(handles.map(handle => handle.remove())) }
  } catch (failure) { await Promise.allSettled(handles.map(handle => handle.remove())); throw failure }
}
