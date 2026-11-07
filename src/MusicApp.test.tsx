import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Capacitor } from '@capacitor/core'
import MusicApp from './MusicApp'
import { mediaDb, addLibraryMedia } from './mediaLibrary'
import { DEFAULT_MUSIC_ID, DEFAULT_MUSIC_SETTING_KEY } from './defaultMusic'
const track = { id: DEFAULT_MUSIC_ID, kind: 'music' as const, name: '晚风慢调', artist: 'Aily Studio', mime: 'audio/wav', blob: new Blob(['test audio'], { type: 'audio/wav' }), addedAt: '2026-11-07T10:00:00.000Z', favorite: false, collection: 'Aily 原创' }
beforeEach(async () => {
  await mediaDb.delete(); await mediaDb.open(); await mediaDb.items.put(track)
  await mediaDb.settings.put({ key: DEFAULT_MUSIC_SETTING_KEY, value: { version: 1, initialized: true } })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:music-preview') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await mediaDb.delete() })
const open = async () => { const view = render(<MusicApp locale="zh-CN"/>); await screen.findByRole('heading', { name: '晚风慢调' }); return { ...view, audio: view.container.querySelector('audio')! } }
describe('vinyl music player and existing local library', () => {
  it('shows the default original track without autoplay and spins only on real playback events', async () => {
    const { container, audio } = await open()
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    expect(container.querySelector('.vinyl-stage')).not.toHaveClass('is-playing')
    fireEvent.click(screen.getByRole('button', { name: '播放音乐' }))
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce()
    fireEvent.play(audio); fireEvent.playing(audio)
    expect(container.querySelector('.vinyl-stage')).toHaveClass('is-playing')
    fireEvent.click(screen.getByRole('button', { name: '暂停播放' })); fireEvent.pause(audio)
    expect(container.querySelector('.vinyl-stage')).not.toHaveClass('is-playing')
  })
  it('displays actual duration, updates seek position and does not invent a 4:32 track length', async () => {
    const { audio } = await open()
    Object.defineProperty(audio, 'duration', { configurable: true, value: 72 }); fireEvent.loadedMetadata(audio)
    expect(screen.getByText('1:12')).toBeInTheDocument(); expect(screen.queryByText('04:32')).toBeNull()
    fireEvent.change(screen.getByRole('slider', { name: '播放进度' }), { target: { value: '20' } })
    expect(audio.currentTime).toBe(20); expect(screen.getByText('0:20')).toBeInTheDocument()
  })
  it('opens the retained music library and plays a selected imported track through one audio element', async () => {
    await addLibraryMedia('music', [{ name: 'my-song.mp3', blob: new Blob(['audio'], { type: 'audio/mpeg' }) }])
    const { container } = await open()
    fireEvent.click(screen.getByRole('button', { name: '收起播放器' }))
    fireEvent.click(await screen.findByRole('button', { name: '打开 my-song.mp3' }))
    expect(await screen.findByRole('heading', { name: 'my-song.mp3' })).toBeInTheDocument()
    expect(container.querySelectorAll('audio')).toHaveLength(1)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce()
    expect(await mediaDb.items.count()).toBe(2)
  })
  it('reports playback errors without pretending the record is playing', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('autoplay blocked'))
    const { container } = await open(); fireEvent.click(screen.getByRole('button', { name: '播放音乐' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法播放')
    expect(container.querySelector('.vinyl-stage')).not.toHaveClass('is-playing')
  })
  it('uses native iOS volume controls instead of pretending HTML volume changes hardware volume', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true); vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios')
    await open(); expect(screen.getByText('音量请用侧边键或控制中心调节')).toBeInTheDocument()
    expect(screen.queryByRole('slider', { name: '播放音量' })).toBeNull()
  })
  it('respects user deletion of the default and does not automatically reinstall it', async () => {
    const view = await open(); vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '音乐操作' }))
    fireEvent.click(screen.getByRole('button', { name: '移除当前曲目' }))
    await waitFor(async () => expect(await mediaDb.items.count()).toBe(0))
    view.unmount(); render(<MusicApp locale="zh-CN"/>)
    await waitFor(() => expect(screen.getByRole('button', { name: '恢复默认音乐' })).toBeEnabled())
    expect(await mediaDb.items.count()).toBe(0)
  })
})
