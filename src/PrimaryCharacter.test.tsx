import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import Dexie from 'dexie'
import * as storage from './db'
import useLocalChat from './useLocalChat'
import { db, exportData, loadLocalData, saveConversation, saveMemory, saveSetting, setPrimaryCharacter } from './db'
import { defaultOnboardingProfile } from './onboarding'
import { acceptSafetyConsent } from './privacy'

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear()
  await db.delete(); await db.open()
  await saveSetting('onboarded', true)
  await saveSetting('selected', 'lu')
  await saveSetting('onboardingProfile', { ...defaultOnboardingProfile('lu'), userName: '小雨', characterName: '阿澜', chatLength: 'long' })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function setupHook() {
  const hook = renderHook(useLocalChat)
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  return hook
}

describe('primary character settings', () => {
  it('atomically persists each role, preserving preferences, conversations and memories in backups', async () => {
    await saveConversation('lu', [{ id: 1, from: 'user', text: '澜的聊天', time: '12:00' }])
    await saveConversation('chen', [{ id: 1, from: 'user', text: '恒的聊天', time: '12:00' }])
    await saveMemory({ id: 'onboarding:relationship:chen', characterId: 'chen', text: '原有回忆不要改写', category: 'relationship', confirmedAt: new Date().toISOString(), state: 'confirmed' })
    const before = await loadLocalData()
    for (const id of ['lu', 'chen', 'gu'] as const) {
      const profile = await setPrimaryCharacter(id)
      expect(profile).toMatchObject({ characterId: id, userName: '小雨', chatLength: 'long' })
      if (id === 'lu') expect(profile.characterName).toBe('阿澜')
      const after = await loadLocalData()
      expect(after.settings.selected).toBe(id)
      expect(after.conversations).toEqual(before.conversations)
      expect(after.memories).toEqual(before.memories)
      const backup = JSON.parse(await exportData())
      expect(backup.settings.selected).toBe(id)
      expect(backup.settings.onboardingProfile.characterId).toBe(id)
    }
  })

  it('rolls back both settings if persistence fails and rejects invalid or unfinished selection', async () => {
    const original = db.settings.bulkPut.bind(db.settings)
    const write = vi.spyOn(db.settings, 'bulkPut').mockImplementationOnce((...args) =>
      Dexie.Promise.resolve(original(...args)).then(() => { throw new Error('storage full') }))
    await expect(setPrimaryCharacter('gu')).rejects.toThrow('storage full')
    write.mockRestore()
    const data = await loadLocalData()
    expect(data.settings.selected).toBe('lu')
    expect(data.settings.onboardingProfile).toMatchObject({ characterId: 'lu', characterName: '阿澜' })
    // Runtime validation also covers stale or malformed callers.
    // @ts-expect-error deliberate invalid role
    await expect(setPrimaryCharacter('invalid')).rejects.toThrow('有效角色')
    await saveSetting('onboarded', false)
    await expect(setPrimaryCharacter('chen')).rejects.toThrow('首次引导')
  })

  it('updates the active role after saving, restores after remount and keeps failure state unchanged', async () => {
    const hook = await setupHook()
    await act(() => hook.result.current.setPrimary('chen'))
    expect(hook.result.current.selected).toBe('chen')
    expect(hook.result.current.onboardingProfile?.characterId).toBe('chen')
    hook.unmount()
    const restored = await setupHook()
    expect(restored.result.current.selected).toBe('chen')
    expect(restored.result.current.onboardingProfile?.characterId).toBe('chen')
    vi.spyOn(db.settings, 'bulkPut').mockRejectedValueOnce(new Error('storage full'))
    await act(async () => { await expect(restored.result.current.setPrimary('gu')).rejects.toThrow('storage full') })
    expect(restored.result.current.selected).toBe('chen')
    expect(restored.result.current.onboardingProfile?.characterId).toBe('chen')
  })

  it('preserves the chat draft when promoting the current character and clears it only on a role switch', async () => {
    const hook = await setupHook()
    act(() => { hook.result.current.setSelected('chen'); hook.result.current.setDraft('返回后继续聊') })
    await act(() => hook.result.current.setPrimary('chen'))
    expect(hook.result.current.draft).toBe('返回后继续聊')
    await act(() => hook.result.current.setPrimary('gu'))
    expect(hook.result.current.draft).toBe('')
  })

  it('keeps the old role while saving and prevents concurrent changes or deletion', async () => {
    const hook = await setupHook()
    let resolve!: () => void
    const deferred = new Promise<void>(done => { resolve = done })
    const original = storage.setPrimaryCharacter
    vi.spyOn(storage, 'setPrimaryCharacter').mockImplementationOnce(async id => { await deferred; return original(id) })
    let pending!: Promise<void>
    act(() => { pending = hook.result.current.setPrimary('gu') })
    expect(hook.result.current.selected).toBe('lu')
    await expect(hook.result.current.setPrimary('chen')).rejects.toThrow('等待本机数据保存')
    await expect(hook.result.current.prepareForDeletion()).rejects.toThrow('等待保存')
    act(() => { hook.result.current.setSelected('chen') })
    expect(hook.result.current.selected).toBe('lu')
    await act(async () => { resolve(); await pending })
    expect(hook.result.current.selected).toBe('gu')
    expect(hook.result.current.onboardingProfile?.characterId).toBe('gu')
  })

  it('exposes three existing choices in settings and synchronizes the home default after reload', async () => {
    acceptSafetyConsent()
    const app = render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '我的' }))
    fireEvent.click(screen.getByRole('button', { name: '主角色 陆听澜' }))
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    fireEvent.click(screen.getByRole('radio', { name: /陈奕恒/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: '主角色 陈奕恒' })).toBeInTheDocument())
    expect((await loadLocalData()).settings.selected).toBe('chen')
    fireEvent.click(screen.getByRole('button', { name: '消息' }))
    expect(screen.getByRole('button', { name: '与陈奕恒聊天' })).toBeInTheDocument()
    app.unmount()
    render(<App />)
    expect(await screen.findByRole('button', { name: '与陈奕恒聊天' })).toBeInTheDocument()
  })
})
