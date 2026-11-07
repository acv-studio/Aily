import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { db, saveSetting } from './db'
import { acceptSafetyConsent } from './privacy'
import { setLocale } from './i18n'
import { addReminder, evaluateReminders, loadReminderState, saveReminderQuietHours } from './smartReminders'

beforeEach(async () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  window.history.replaceState(null, '', '/'); localStorage.clear(); sessionStorage.clear(); setLocale('zh-CN')
  await db.delete(); await db.open(); await saveSetting('onboarded', true); acceptSafetyConsent()
})
afterEach(() => { cleanup(); setLocale('zh-CN') })
async function openCenter() {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: '提醒' }))
  fireEvent.click(await screen.findByRole('button', { name: '智能提醒' }))
  await screen.findByRole('button', { name: '确认添加提醒' })
}
async function disableQuiet() {
  fireEvent.click(screen.getByLabelText('开启免打扰'))
  await waitFor(() => expect(screen.getByLabelText('开启免打扰')).not.toBeChecked())
  await waitFor(() => expect(screen.getByRole('button', { name: '确认添加提醒' })).toBeEnabled())
}
const future = () => new Date(Date.now() + 30 * 60_000)
function datetime(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }

describe('smart reminder application journey', () => {
  it('opens smart reminder center from reminders and profile without inventing reminders', async () => {
    await openCenter()
    expect((await loadReminderState()).reminders).toEqual([])
    expect(screen.getByRole('region', { name: '系统本地通知设置' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '← 返回' }))
    expect(screen.getByText('还没有提醒，从一杯水开始吧。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '我的' }))
    fireEvent.click(screen.getByRole('button', { name: '智能提醒' }))
    expect(screen.getByRole('heading', { name: '把小事，放在心上' })).toBeInTheDocument()
  })

  it('saves hydration reminder and preserves it across app remounts', async () => {
    await openCenter()
    fireEvent.change(screen.getByLabelText('首次提醒时间'), { target: { value: datetime(future()) } })
    fireEvent.click(screen.getByRole('button', { name: '确认添加提醒' }))
    await screen.findByText('提醒已保存')
    expect((await loadReminderState()).reminders[0]).toMatchObject({ kind: 'water', repeatMinutes: 120, status: 'pending' })
    fireEvent.click(screen.getByRole('button', { name: '← 返回' }))
    expect(screen.getByRole('button', { name: '已完成' })).toBeDisabled()
    cleanup()
    await openCenter()
    fireEvent.click(screen.getByRole('button', { name: '← 返回' }))
    expect(screen.getByText('休息一下，喝杯水', { selector: 'strong' })).toBeInTheDocument()
  })

  it('uses manually entered weather and mood, showing newly due items', async () => {
    await openCenter(); await disableQuiet()
    fireEvent.click(screen.getByRole('button', { name: '天气关怀' }))
    fireEvent.click(screen.getByRole('button', { name: '确认添加提醒' }))
    await screen.findByText('提醒已保存')
    expect((await loadReminderState()).reminders[0].status).toBe('pending')
    fireEvent.change(screen.getByLabelText('当前温度（手动记录，°C）'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '更新温度' }))
    await screen.findByText('天气记录已更新')
    expect((await loadReminderState()).reminders[0].status).toBe('due')
    fireEvent.click(screen.getByRole('button', { name: '心情关怀' }))
    fireEvent.click(screen.getByRole('button', { name: '确认添加提醒' }))
    await screen.findByText('提醒已保存')
    fireEvent.click(screen.getByRole('button', { name: '心情低落' }))
    await screen.findByText('心情记录已更新')
    expect((await loadReminderState()).reminders[1].status).toBe('due')
    fireEvent.click(screen.getByRole('button', { name: '← 返回' }))
    expect(screen.getByRole('status', { name: '到期提醒' })).toHaveTextContent('待处理提醒: 2')
  })

  it('requires explicit metro station and exit and saves estimated lead time', async () => {
    await openCenter()
    fireEvent.click(screen.getByRole('button', { name: '地铁出行' }))
    expect(screen.getByLabelText('下车站点')).toBeRequired()
    expect(screen.getByLabelText('出站口')).toBeRequired()
    fireEvent.change(screen.getByLabelText('下车站点'), { target: { value: '人民广场' } })
    fireEvent.change(screen.getByLabelText('出站口'), { target: { value: 'A 口' } })
    fireEvent.change(screen.getByLabelText('预计到站时间'), { target: { value: datetime(future()) } })
    fireEvent.click(screen.getByRole('button', { name: '确认添加提醒' }))
    await screen.findByText('提醒已保存')
    const state = await loadReminderState()
    expect(state.reminders[0]).toMatchObject({ kind: 'metro', station: '人民广场', exit: 'A 口', leadMinutes: 3, repeatMinutes: null })
    expect(screen.getByText(/不识别实际到站/)).toBeInTheDocument()
  })

  it('does not schedule next-step suggestions until each is confirmed', async () => {
    await openCenter()
    fireEvent.change(screen.getByLabelText('刚做完或准备做的事'), { target: { value: '开完会' } })
    fireEvent.click(screen.getByRole('button', { name: '生成下一步建议' }))
    const confirms = screen.getAllByRole('button', { name: '确认加入提醒' })
    expect(confirms.length).toBeGreaterThan(0)
    expect((await loadReminderState()).reminders).toHaveLength(0)
    fireEvent.click(confirms[0])
    await screen.findByText('下一步已加入提醒')
    expect((await loadReminderState()).reminders).toHaveLength(1)
    expect(screen.getByRole('button', { name: '已加入' })).toBeDisabled()
  })

  it('renders foreground due banner and snoozes without duplicate delivery', async () => {
    const arrival = future()
    const item = await addReminder({ kind: 'metro', title: '前往目的地', enabled: true, scheduledAt: arrival.toISOString(), repeatMinutes: null, temperatureBelow: null, station: '目的地站', exit: 'B 口', leadMinutes: 3 })
    await evaluateReminders(new Date(arrival.getTime() - 2 * 60_000))
    render(<App />)
    const banner = await screen.findByRole('status', { name: '到期提醒' })
    expect(banner).toHaveTextContent('目的地站 · B 口')
    fireEvent.click(within(banner).getByRole('button', { name: '稍后' }))
    await waitFor(() => expect(screen.queryByRole('status', { name: '到期提醒' })).not.toBeInTheDocument())
    expect((await loadReminderState()).reminders.find(reminder => reminder.id === item.id)).toMatchObject({ status: 'pending', deliveredAt: null })
  })

  it('keeps due reminders accessible while chatting and returns to the chat', async () => {
    const at = future()
    await addReminder({ kind: 'metro', title: '聊天中的提醒', enabled: true, scheduledAt: at.toISOString(), repeatMinutes: null, temperatureBelow: null, station: '已确认车站', exit: 'C 口', leadMinutes: 3 })
    await evaluateReminders(new Date(at.getTime() - 2 * 60_000))
    render(<App />)
    await screen.findByRole('status', { name: '到期提醒' })
    fireEvent.click(screen.getByRole('button', { name: /^与.+聊天$/ }))
    expect(screen.getByRole('textbox', { name: '发消息' })).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('status', { name: '到期提醒' })).getByRole('button', { name: '查看' }))
    await screen.findByRole('button', { name: '确认添加提醒' })
    fireEvent.click(screen.getByRole('button', { name: '← 返回' }))
    expect(screen.getByRole('textbox', { name: '发消息' })).toBeInTheDocument()
  })

  it('enables reminders after returning-user consent is accepted', async () => {
    localStorage.removeItem('aily-safety-consent-v1')
    render(<App />)
    await screen.findByRole('button', { name: '确认并继续' })
    fireEvent.click(screen.getByLabelText('我已年满 18 周岁'))
    fireEvent.click(screen.getByLabelText('我理解 AI 身份与数据说明'))
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }))
    fireEvent.click(await screen.findByRole('button', { name: '提醒' }))
  fireEvent.click(await screen.findByRole('button', { name: '智能提醒' }))
    await screen.findByRole('button', { name: '确认添加提醒' })
  })

  it('shows English reminder controls without rewriting stored user messages', async () => {
    setLocale('en')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reminders' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Smart reminders' }))
    expect(await screen.findByRole('button', { name: 'Confirm reminder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Metro journey' })).toBeInTheDocument()
  })

  it('completes a due occurrence and re-arms repeats in the future', async () => {
    await saveReminderQuietHours({ enabled: false, start: 0, end: 0 })
    const at = future()
    await addReminder({ kind: 'water', title: '喝水测试', enabled: true, scheduledAt: at.toISOString(), repeatMinutes: 120, temperatureBelow: null, station: '', exit: '', leadMinutes: 0 })
    await evaluateReminders(at)
    await openCenter()
    fireEvent.click(screen.getByRole('button', { name: '← 返回' }))
    fireEvent.click(screen.getByRole('button', { name: '已完成' }))
    await waitFor(() => expect(screen.getByText('等待触发')).toBeInTheDocument())
    const item = (await loadReminderState()).reminders[0]
    expect(item.status).toBe('pending')
    expect(Date.parse(item.scheduledAt!)).toBeGreaterThan(Date.now())
  })
})
