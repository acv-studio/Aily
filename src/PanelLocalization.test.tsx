import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale, translate } from './i18n'
import { panelEnglish } from './locales/panels'
import MemoryPanel from './MemoryPanel'
import GiftStorePanel from './GiftStorePanel'
import ProactiveSettingsPanel from './ProactiveSettingsPanel'
import RockPaperScissors from './RockPaperScissors'
import InteractiveStory from './InteractiveStory'
import { demoDb } from './giftDemo'

beforeEach(() => setLocale('en'))
afterEach(() => { cleanup(); setLocale('zh-CN'); vi.restoreAllMocks() })

describe('bilingual panel localization', () => {
  it('keeps named interpolation placeholders identical in every panel translation', () => {
    for (const [key, english] of Object.entries(panelEnglish)) {
      const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
      expect(placeholders(english), key).toEqual(placeholders(key))
    }
  })

  it('switches memory controls live while preserving original user memory and editor text', () => {
    const original = '用户偏好：我喜欢咖啡 — my own words'
    render(<MemoryPanel memories={[{ id: 'localization-memory', characterId: 'lu', text: original, originalText: original, confirmedAt: '2026-11-02T10:00:00Z' }]} selected="lu" onSave={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()} />)
    expect(screen.getByText('My memories')).toBeInTheDocument()
    // The relationship timeline also shows the original confirmed memory.
    expect(screen.getAllByText(original)).toHaveLength(2)
    expect(screen.getByText('1 memory · 0 awaiting confirmation')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Details and controls'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Edit memory content')).toHaveValue(original)
    act(() => setLocale('zh-CN'))
    expect(screen.getByLabelText('编辑记忆内容')).toHaveValue(original)
    expect(screen.getByText('我的记忆')).toBeInTheDocument()
  })

  it('translates gift dialogs, static data, and existing success notices on locale changes', async () => {
    await demoDb.delete(); await demoDb.open()
    render(<GiftStorePanel selected="lu" />)
    await waitFor(() => expect(screen.getByTestId('demo-balance')).toHaveTextContent('0'))
    expect(screen.getByRole('button', { name: /Flowers/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+100 demo coins · No charge' }))
    expect(screen.getByRole('group', { name: 'Confirm demo action' })).toHaveTextContent('Add 100 demo coins')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm demo top-up' }))
    await screen.findByText('Added 100 demo coins. No real money was charged.')
    act(() => setLocale('zh-CN'))
    expect(screen.getByText('已模拟充值 100 演示币，未真实扣款。')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '礼物接收角色' })).toBeInTheDocument()
    act(() => setLocale('en'))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Gift quantity' }), { target: { value: '99' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send gift (demo)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm gift (demo)' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('Not enough demo coins. Add free coins first.')
    act(() => setLocale('zh-CN'))
    expect(screen.getByRole('alert')).toHaveTextContent('演示币不足，请先免费补充')
  })

  it('subscribes proactive settings, including trigger and weather labels', async () => {
    render(<ProactiveSettingsPanel selected="lu" close={vi.fn()} />)
    await screen.findByRole('checkbox', { name: 'Enable proactive messages' })
    expect(screen.getByText('Time · Morning 08–11 / Evening 18–22')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Sunny' })).toBeInTheDocument()
    act(() => setLocale('zh-CN'))
    expect(screen.getByRole('checkbox', { name: '开启主动消息' })).toBeInTheDocument()
  })

  it('localizes game prose and saved generated summaries without changing move identifiers', () => {
    const complete = vi.fn()
    render(<RockPaperScissors characterName="陆听澜" onComplete={complete} onClose={vi.fn()} />)
    expect(screen.getByText('A promise, a move, a little bluff')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Rock' }))
    fireEvent.click(screen.getByRole('button', { name: 'Scissors' }))
    expect(screen.getByText('You won this round')).toBeInTheDocument()
    expect(complete).toHaveBeenCalledWith(expect.stringContaining('promised Rock, played Scissors, you won'))
    act(() => setLocale('zh-CN'))
    expect(screen.getByText('这次你赢了')).toBeInTheDocument()
  })

  it('retains story branch identity when the locale changes mid-story', () => {
    const complete = vi.fn()
    render(<InteractiveStory characterName="陆听澜" onComplete={complete} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Push open the kitchen door' }))
    fireEvent.click(screen.getByRole('button', { name: /Hug him from behind/ }))
    expect(screen.getByText('A night worth remembering')).toBeInTheDocument()
    expect(complete).toHaveBeenCalledWith(translate('和{name}完成故事《下班后的晚饭》：{choice}', { name: translate('陆听澜'), choice: translate('从背后抱住他，说今天很想他') }))
    act(() => setLocale('zh-CN'))
    expect(screen.getByText('从背后抱住他，说今天很想他')).toBeInTheDocument()
    expect(screen.getByText('他停了一下，空着的那只手覆上你的手背。“嗯。知道了，再抱会儿。”')).toBeInTheDocument()
  })
})
