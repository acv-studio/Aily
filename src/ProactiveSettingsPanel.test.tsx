import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from './db'
import { loadProactiveSettings } from './proactiveMessages'
import ProactiveSettingsPanel from './ProactiveSettingsPanel'
beforeEach(async () => { await db.delete(); await db.open() })
afterEach(cleanup)
it('saves frequency, quiet hours, weather and triggers per role without enabling another role', async () => {
  render(<ProactiveSettingsPanel selected="lu" close={vi.fn()} />)
  fireEvent.click(await screen.findByRole('checkbox', { name: '开启主动消息' }))
  fireEvent.change(screen.getByLabelText('消息频率'), { target: { value: 'high' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /按时间/ }))
  fireEvent.change(screen.getByLabelText('当前天气（手动提供）'), { target: { value: 'rainy' } })
  fireEvent.change(screen.getByLabelText('免打扰开始时间'), { target: { value: '21:30' } })
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
  expect(await screen.findByText('设置已保存')).toBeInTheDocument()
  const settings = await loadProactiveSettings('lu')
  expect(settings).toMatchObject({ enabled: true, frequency: 'high', triggers: { time: false }, quietHours: { start: 1290 }, weather: { condition: 'rainy' } })
  fireEvent.change(screen.getByLabelText('设置角色'), { target: { value: 'chen' } })
  await waitFor(() => expect(screen.getByRole('checkbox', { name: '开启主动消息' })).not.toBeChecked())
  expect((await loadProactiveSettings('chen')).enabled).toBe(false)
})
it('does not offer save after a read failure and lets the user retry', async () => {
  await db.settings.put({ key: '__proactive:lu', value: 'invalid' })
  render(<ProactiveSettingsPanel selected="lu" close={vi.fn()} />)
  expect(await screen.findByText(/无法读取主动消息设置/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '保存设置' })).toBeNull()
  await db.settings.delete('__proactive:lu')
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByRole('button', { name: '保存设置' })).toBeInTheDocument()
})
