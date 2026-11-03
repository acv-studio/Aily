import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import useLocalChat from './useLocalChat'
import { db, loadRoleConversation, saveSetting } from './db'
import { defaultProactiveSettings, saveProactiveSettings } from './proactiveMessages'
beforeEach(async () => { await db.delete(); await db.open(); await saveSetting('onboarded', true) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('pauses proactive delivery in temporary mode and when hidden, then wakes on visibility', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const hook = renderHook(useLocalChat)
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  act(() => hook.result.current.toggleTemporary())
  expect(hook.result.current.temporary).toBe(true)
  await saveProactiveSettings('lu', { ...defaultProactiveSettings, enabled: true, quietHours: { enabled: false, start: 0, end: 0 }, weather: { condition: 'rainy', observedAt: new Date().toISOString() } })
  await act(async () => { window.dispatchEvent(new Event('aily-proactive-settings')) })
  expect(await loadRoleConversation('lu')).toEqual([])
  act(() => { visibility.mockReturnValue('hidden'); hook.result.current.toggleTemporary() })
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  expect(await loadRoleConversation('lu')).toEqual([])
  act(() => { visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange')) })
  await waitFor(() => expect(hook.result.current.conversations.lu).toHaveLength(1))
  expect(hook.result.current.conversations.lu[0].text).toContain('本机主动消息演示')
})
