import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllData, db, deleteMemory, exportData, importData, loadLocalData, saveMemoryPolicy, updateMemory } from './db'
import { chapterEnding, chapterIntro, chapters, completeStoryChapter, loadStoryProgress, localDate, storyRecall, storyTitle, type StoryProgress } from './sevenDayStory'

const key = '__sevenDayStory:lu'
const at = (day: number, hour = 12, minute = 0) => new Date(2026, 0, day, hour, minute)
const empty: StoryProgress = { choices: [], completedDates: [] }
const chapterMemory = async (day: number) => (await db.memories.toArray()).find(memory => memory.text.startsWith(`与陆听澜完成《${storyTitle}》第${day}章`))

beforeEach(async () => {
  vi.restoreAllMocks()
  await db.delete()
  await db.open()
})

describe('Lu seven-day mainline', () => {
  it('has seven connected chapters and two safe choices in each', () => {
    expect(storyTitle).toBe('把日子慢慢写成我们')
    expect(chapters).toHaveLength(7)
    expect(chapters[0].title).toBe('下班后的晚饭')
    chapters.forEach(chapter => {
      expect(chapter.art).not.toBe('')
      expect(chapter.intro).not.toBe('')
      expect(chapter.choices).toHaveLength(2)
      chapter.choices.forEach(choice => {
        expect(choice.label).not.toBe('')
        expect(choice.line).not.toBe('')
        expect(choice.ending).not.toBe('')
      })
    })
    expect(chapters[1].intro).toContain('海岸')
    expect(chapters[6].intro).toContain('不用补偿')
  })

  it('uses local midnight rather than elapsed 24 hours to unlock', async () => {
    const date = at(1, 23, 59)
    const iso = vi.spyOn(date, 'toISOString')
    expect(localDate(date)).toBe('2026-01-01')
    expect(iso).not.toHaveBeenCalled()
    await completeStoryChapter(0, 0, date)
    await expect(completeStoryChapter(1, 1, date)).rejects.toThrow('日历日')
    expect(await completeStoryChapter(1, 1, at(2, 0))).toEqual({ choices: [0, 1], completedDates: ['2026-01-01', '2026-01-02'] })
    expect(localDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
    expect(localDate(new Date(2027, 0, 1))).toBe('2027-01-01')
  })

  it('allows missed days without resetting or skipping chapters and rejects clock rollback', async () => {
    await completeStoryChapter(0, 1, at(1))
    const progress = await completeStoryChapter(1, 0, at(19))
    expect(progress).toEqual({ choices: [1, 0], completedDates: ['2026-01-01', '2026-01-19'] })
    await expect(completeStoryChapter(2, 0, at(18))).rejects.toThrow('日历日')
    expect(await loadStoryProgress()).toEqual(progress)
  })

  it('serializes double clicks; first choice wins and every retry returns authoritative progress', async () => {
    const first = completeStoryChapter(0, 0, at(1))
    const second = completeStoryChapter(0, 1, at(1))
    expect(await Promise.all([first, second])).toEqual([
      { choices: [0], completedDates: ['2026-01-01'] },
      { choices: [0], completedDates: ['2026-01-01'] },
    ])
    const next = await completeStoryChapter(1, 1, at(2))
    expect(await completeStoryChapter(0, 1, at(3))).toEqual(next)
    expect(await db.memories.count()).toBe(2)
    expect(await chapterMemory(1)).toMatchObject({ characterId: 'lu', category: 'relationship', state: 'confirmed', enabled: true })
    expect((await chapterMemory(1))?.text).toContain(chapters[0].choices[0].line)
  })

  it('rejects future chapters and malformed arguments without writing', async () => {
    await expect(completeStoryChapter(1, 0, at(1))).rejects.toThrow('前面')
    for (const index of [-1, 7, 0.5, NaN]) await expect(completeStoryChapter(index, 0, at(1))).rejects.toThrow('章节')
    for (const choice of [-1, 2, 0.5, NaN, undefined as unknown as number]) await expect(completeStoryChapter(0, choice, at(1))).rejects.toThrow('选择')
    await expect(completeStoryChapter(0, 0, new Date(NaN))).rejects.toThrow('日期')
    expect(await loadStoryProgress()).toEqual(empty)
    expect(await db.settings.count()).toBe(0)
    expect(await db.memories.count()).toBe(0)
  })

  it.each([
    null, undefined, [], {}, { choices: [0], completedDates: [] },
    { choices: [2], completedDates: ['2026-01-01'] },
    { choices: [0.5], completedDates: ['2026-01-01'] },
    { choices: ['0'], completedDates: ['2026-01-01'] },
    { choices: Array(1), completedDates: ['2026-01-01'] },
    { choices: Array(8).fill(0), completedDates: Array.from({ length: 8 }, (_, i) => `2026-01-0${i + 1}`) },
    { choices: [0], completedDates: ['2026-02-30'] },
    { choices: [0], completedDates: ['2025-02-29'] },
    { choices: [0], completedDates: ['2026-13-01'] },
    { choices: [0], completedDates: ['0000-01-01'] },
    { choices: [0], completedDates: ['2026-1-1'] },
    { choices: [0], completedDates: ['2026-01-01T12:00:00Z'] },
    { choices: [0, 1], completedDates: ['2026-01-01', '2026-01-01'] },
    { choices: [0, 1], completedDates: ['2026-01-02', '2026-01-01'] },
    { ...empty, extra: true },
  ])('leaves corrupt persisted state untouched: %j', async value => {
    await db.settings.put({ key, value })
    await expect(loadStoryProgress()).rejects.toThrow('损坏')
    await expect(completeStoryChapter(0, 0, at(1))).rejects.toThrow('损坏')
    expect((await db.settings.get(key))?.value).toEqual(value)
    expect(await db.memories.count()).toBe(0)
  })

  it('accepts valid leap dates and returns detached progress', async () => {
    await db.settings.put({ key, value: { choices: [1], completedDates: ['2024-02-29'] } })
    const progress = await loadStoryProgress()
    progress.choices[0] = 0
    expect((await loadStoryProgress()).choices).toEqual([1])
  })

  it('rolls back the settings write when the memory write fails and supports retry', async () => {
    const prior = await completeStoryChapter(0, 0, at(1))
    vi.spyOn(db.memories, 'put').mockRejectedValueOnce(new Error('injected memory failure'))
    await expect(completeStoryChapter(1, 1, at(2))).rejects.toThrow('injected memory failure')
    expect(await loadStoryProgress()).toEqual(prior)
    expect(await db.memories.count()).toBe(1)
    expect((await completeStoryChapter(1, 1, at(2))).choices).toEqual([0, 1])
  })

  it('reopens durably and does not recreate deleted memory or undo user edits on retry', async () => {
    const progress = await completeStoryChapter(0, 1, at(1))
    await deleteMemory((await chapterMemory(1))!.id)
    db.close()
    await db.open()
    expect(await loadStoryProgress()).toEqual(progress)
    expect(await completeStoryChapter(0, 0, at(2))).toEqual(progress)
    expect(await db.memories.count()).toBe(0)
    await completeStoryChapter(1, 0, at(2))
    const editedId = (await chapterMemory(2))!.id
    await updateMemory(editedId, { text: '用户修订', enabled: false })
    await completeStoryChapter(1, 1, at(3))
    expect(await db.memories.get(editedId)).toMatchObject({ text: '用户修订', enabled: false })
  })

  it('carries preferences into later scenes but keeps the full recap UI-only', async () => {
    let progress = empty
    for (let index = 0; index < 7; index++) progress = await completeStoryChapter(index, index % 2, at(index + 1))
    const intro = chapterIntro(5, progress)
    expect(intro).toContain('傍晚的落日')
    expect(intro).toContain('不想聊天也可以')
    expect(intro).not.toContain('第1章')
    expect(chapterIntro(0, progress)).toBe(chapters[0].intro)
    const memory = await chapterMemory(7)
    for (let index = 0; index < 6; index++) expect(memory?.text).not.toContain(chapters[index].choices[index % 2].line)
    expect(memory?.text).toContain(chapters[6].choices[0].line)
    expect(memory?.text).not.toContain('共同回顾')
    const recap = chapterEnding(6, 0, progress)
    for (let index = 0; index < 7; index++) expect(recap).toContain(chapters[index].choices[index % 2].line)
    expect(await db.memories.count()).toBe(7)
    expect(storyRecall(progress)).toContain('第7章')
    expect(chapterEnding(6, 0, progress)).toContain('共同回顾')
    expect(await completeStoryChapter(6, 1, at(20))).toEqual(progress)
    expect(await db.memories.where('characterId').equals('chen').count()).toBe(0)
    expect(await db.memories.where('characterId').equals('gu').count()).toBe(0)
  })

  it('does not reconstruct deleted, edited, or paused earlier memories when saving the finale', async () => {
    for (let index = 0; index < 6; index++) await completeStoryChapter(index, 0, at(index + 1))
    const deletedId = (await chapterMemory(1))!.id
    const editedId = (await chapterMemory(2))!.id
    const pausedId = (await chapterMemory(3))!.id
    await deleteMemory(deletedId)
    await updateMemory(editedId, { text: '修订后的关系事实' })
    await updateMemory(pausedId, { enabled: false })
    const before = await db.memories.toArray()
    await completeStoryChapter(6, 1, at(7))
    expect(await db.memories.get(deletedId)).toBeUndefined()
    for (const memory of before) expect(await db.memories.get(memory.id)).toEqual(memory)
    const finale = await chapterMemory(7)
    expect(finale?.text).toContain(chapters[6].choices[1].line)
    for (let index = 0; index < 6; index++) {
      expect(finale?.text).not.toContain(chapters[index].choices[0].line)
      expect(finale?.text).not.toContain(chapters[index].choices[0].ending)
    }
    expect(await db.memories.count()).toBe(6)
  })

  it('rejects disabled relationship memories without saving progress or memory', async () => {
    const prior = await completeStoryChapter(0, 0, at(1))
    await saveMemoryPolicy('lu', { disabledCategories: ['relationship'], extractionEnabled: true })
    const before = await db.memories.toArray()
    await expect(completeStoryChapter(1, 0, at(2))).rejects.toThrow('此类记忆已关闭')
    expect(await loadStoryProgress()).toEqual(prior)
    expect(await db.memories.toArray()).toEqual(before)
    expect(await completeStoryChapter(0, 1, at(2))).toEqual(prior)
    await saveMemoryPolicy('lu', { disabledCategories: [], extractionEnabled: false })
    expect((await completeStoryChapter(1, 0, at(2))).choices).toEqual([0, 0])
  })

  it('gives both earlier choices distinct, concise callbacks in relevant later scenes', () => {
    const dates = Array.from({ length: 6 }, (_, index) => `2026-01-0${index + 1}`)
    const zero = { choices: Array(6).fill(0), completedDates: dates }
    const one = { choices: Array(6).fill(1), completedDates: dates }
    const branches = [
      ['抱够了', '安静陪着就很好'], ['早餐便当', '晚餐便当'],
      ['今天也想抱一会儿吗', '留出舒服的距离'], ['清淡便当', '小份甜点'],
      ['清晨的日出', '傍晚的落日'], ['走累就停', '读明信片的小仪式'],
    ]
    branches.forEach(([left, right], offset) => {
      const index = offset + 1
      expect(chapterIntro(index, zero)).toContain(left)
      expect(chapterIntro(index, zero)).not.toContain(right)
      expect(chapterIntro(index, one)).toContain(right)
      expect(chapterIntro(index, one)).not.toContain(left)
      expect(chapterIntro(index, zero).length).toBeLessThan(300)
      expect(chapterIntro(index, one).length).toBeLessThan(300)
    })
    expect(chapterIntro(5, zero)).toContain('先听，不急着给建议')
    expect(chapterIntro(5, one)).toContain('不想聊天也可以')
    expect(chapterIntro(6, zero)).toContain('一起吃饭，一起慢慢走')
    expect(chapterIntro(6, one)).toContain('有空的时候，我们去看海')
  })

  it('keeps progress out of backups and clears it on import and clear all', async () => {
    await completeStoryChapter(0, 0, at(1))
    const originalId = (await chapterMemory(1))!.id
    await updateMemory(originalId, { state: 'archived', enabled: false })
    const original = await db.memories.get(originalId)
    expect((await loadLocalData()).settings).not.toHaveProperty(key)
    const raw = await exportData()
    expect(JSON.parse(raw).settings).not.toHaveProperty(key)
    await importData(raw)
    expect(await loadStoryProgress()).toEqual(empty)
    expect(await db.memories.count()).toBe(1)
    await completeStoryChapter(0, 1, at(2))
    expect(await db.memories.count()).toBe(2) // Replay creates a fresh memory, preserving the imported one.
    expect(await db.memories.get(originalId)).toEqual(original)
    const replay = (await db.memories.toArray()).find(memory => memory.id !== originalId)
    expect(replay?.text).toContain(chapters[0].choices[1].line)
    expect(replay).toMatchObject({ state: 'confirmed', enabled: true })
    await clearAllData()
    expect(await loadStoryProgress()).toEqual(empty)
    expect(await db.memories.count()).toBe(0)
  })
})
