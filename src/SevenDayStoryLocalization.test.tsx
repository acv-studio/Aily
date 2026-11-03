import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SevenDayStory from './SevenDayStoryPanel'
import { db, saveMemoryPolicy } from './db'
import { setLocale, t } from './i18n'
import { chapters, storyTitle } from './sevenDayStory'
import { storyEnglish } from './locales/storyEnglish'

beforeEach(async () => {
  setLocale('en')
  await db.settings.clear()
  await db.memories.clear()
})
afterEach(() => { cleanup(); setLocale('zh-CN'); vi.restoreAllMocks() })
const open = () => render(<SevenDayStory temporary={false} onSaved={vi.fn()} onClose={vi.fn()} />)
const dates = Array.from({ length: 7 }, (_, index) => `2020-01-0${index + 1}`)

describe('bilingual seven-day story', () => {
  it('has matching named placeholders and translations for every static chapter field', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
    for (const [key, translation] of Object.entries(storyEnglish)) expect(placeholders(translation), key).toEqual(placeholders(key))
    for (const chapter of chapters) {
      for (const text of [chapter.title, chapter.intro, ...chapter.choices.flatMap(choice => [choice.label, choice.line, choice.ending])]) {
        expect(storyEnglish[text], text).toBeTruthy()
      }
    }
  })

  it.each([0, 1])('localizes every chapter, callback, and final recap for branch %i without mutating stored content', async branch => {
    const choices = Array(7).fill(branch)
    await db.settings.put({ key: '__sevenDayStory:lu', value: { choices, completedDates: dates } })
    const original = '我自己写的回忆：一起看海 — original user text'
    await db.memories.put({ id: 'original-user-memory', characterId: 'lu', text: original, confirmedAt: '2020-01-01T12:00:00Z' })
    open()
    await screen.findByText('All seven chapters completed')
    expect(screen.getByRole('dialog').textContent).not.toMatch(/[\u3400-\u9fff]/u)
    expect(screen.getByText(/Our shared recap of/)).toHaveTextContent('Chapter 7')
    for (let index = 0; index < 7; index++) {
      fireEvent.click(screen.getByRole('button', { name: t('回看第 {count} 天：{title}', { count: index + 1, title: t(chapters[index].title) }) }))
      expect(screen.getByRole('dialog').textContent).not.toMatch(/[\u3400-\u9fff]/u)
      expect(screen.getByText(t('你的选择：{choice}', { choice: t(chapters[index].choices[branch].label) }))).toBeInTheDocument()
    }
    act(() => setLocale('zh-CN'))
    expect(screen.getAllByText(storyTitle).length).toBeGreaterThan(0)
    expect(screen.getByText('你的选择：' + chapters[6].choices[branch].label)).toBeInTheDocument()
    expect((await db.settings.get('__sevenDayStory:lu'))?.value).toEqual({ choices, completedDates: dates })
    expect((await db.memories.get('original-user-memory'))?.text).toBe(original)
    expect(await db.memories.count()).toBe(1)
  })

  it('keeps numeric choice identity and updates a pending confirmation when switching locale', async () => {
    const onSaved = vi.fn()
    render(<SevenDayStory temporary={false} onSaved={onSaved} onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start this chapter' }))
    fireEvent.click(screen.getByRole('button', { name: /Hug him from behind/ }))
    expect(screen.getByText('Your choice: Hug him from behind')).toBeInTheDocument()
    act(() => setLocale('zh-CN'))
    expect(screen.getByText('你的选择：从背后抱住他')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认保存选择与回忆' }))
    await screen.findByText('已保存选择与回忆')
    expect((await db.settings.get('__sevenDayStory:lu'))?.value).toMatchObject({ choices: [0] })
    act(() => setLocale('en'))
    expect(screen.getByRole('status')).toHaveTextContent('Choice and memory saved')
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('updates a known service error live when switching language without saving progress', async () => {
    await saveMemoryPolicy('lu', { extractionEnabled: true, disabledCategories: ['relationship'] })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Start this chapter' }))
    fireEvent.click(screen.getByRole('button', { name: /Hug him from behind/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and save choice and memory' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('This memory category is disabled.')
    act(() => setLocale('zh-CN'))
    expect(screen.getByRole('alert')).toHaveTextContent('此类记忆已关闭，请在记忆设置中启用关系记忆后重试')
    expect(await db.settings.get('__sevenDayStory:lu')).toBeUndefined()
    expect(await db.memories.count()).toBe(0)
  })

  it('localizes temporary-mode notice without touching saved progress', () => {
    const get = vi.spyOn(db.settings, 'get')
    render(<SevenDayStory temporary={true} onSaved={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/Temporary chats do not load or save story progress/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close story' })).toBeInTheDocument()
    expect(get).not.toHaveBeenCalled()
    act(() => setLocale('zh-CN'))
    expect(screen.getByText(/临时会话不读取或保存故事进度/)).toBeInTheDocument()
  })
})
