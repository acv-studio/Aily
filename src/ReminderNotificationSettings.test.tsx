import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReminderNotificationSettings from './ReminderNotificationSettings'
import type { SmartReminderController } from './useSmartReminders'
import type { ReminderNotificationStatus } from './reminderNotifications'
import { setLocale } from './i18n'
beforeEach(() => setLocale('zh-CN'))
afterEach(() => cleanup())
function controller(info: Partial<ReminderNotificationStatus> = {}): SmartReminderController {
  return { state: { reminders: [], context: { temperature: null, weatherObservedAt: null, mood: 'unknown', moodObservedAt: null }, quietHours: { enabled: false, start: 0, end: 0 } }, error: '', busy: false, due: [], openedNotificationId: null,
    notifications: { available: true, enabled: false, showDetails: false, permission: 'prompt', scheduledCount: 0, deferredCount: 0, contextOnlyCount: 0, busy: false, error: '', ...info },
    add: vi.fn(async () => true), act: vi.fn(async () => true), context: vi.fn(async () => true), quiet: vi.fn(async () => true), refresh: vi.fn(async () => {}), pauseAndDrain: vi.fn(async () => {}), enableNotifications: vi.fn(async () => true), showNotificationDetails: vi.fn(async () => true), syncNotifications: vi.fn(async () => true), testNotification: vi.fn(async () => true),
  }
}
describe('explicit notification permissions and privacy controls', () => {
  it('does not enable or request anything on render, only from a user toggle', () => {
    const control = controller(); render(<ReminderNotificationSettings controller={control}/>)
    expect(screen.getByLabelText('开启系统通知')).not.toBeChecked()
    expect(screen.getByLabelText('在通知中显示具体内容')).not.toBeChecked()
    expect(control.enableNotifications).not.toHaveBeenCalled()
    expect(control.testNotification).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('开启系统通知'))
    expect(control.enableNotifications).toHaveBeenCalledExactlyOnceWith(true)
    fireEvent.click(screen.getByLabelText('在通知中显示具体内容'))
    expect(control.showNotificationDetails).toHaveBeenCalledExactlyOnceWith(true)
  })
  it('keeps unsupported browser controls disabled without discarding in-app reminders', () => {
    const control = controller({ available: false }); render(<ReminderNotificationSettings controller={control}/>)
    expect(screen.getByText(/仍保留应用内提醒/)).toBeInTheDocument()
    expect(screen.getByLabelText('开启系统通知')).toBeDisabled()
    expect(screen.getByRole('button', { name: '发送测试通知' })).toBeDisabled()
    expect(control.enableNotifications).not.toHaveBeenCalled()
  })
  it('reports queue capacity without pretending notifications were delivered', () => {
    render(<ReminderNotificationSettings controller={controller({ enabled: true, permission: 'granted', scheduledCount: 60, deferredCount: 5, contextOnlyCount: 1 })}/>)
    expect(screen.getByText('已登记 60 条系统通知（不代表已送达）。')).toBeInTheDocument()
    expect(screen.getByText(/还有 5 条因系统队列容量暂未登记/)).toBeInTheDocument()
    expect(screen.getByText(/有 1 条天气\/心情等条件提醒/)).toBeInTheDocument()
  })
  it('offers a user-initiated test only after permission is granted', async () => {
    const control = controller({ enabled: true, permission: 'granted' }); render(<ReminderNotificationSettings controller={control}/>)
    fireEvent.click(screen.getByRole('button', { name: '发送测试通知' }))
    expect(control.testNotification).toHaveBeenCalledOnce()
    expect(await screen.findByText(/测试通知已安排/)).toBeInTheDocument()
  })
})
