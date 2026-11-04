import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PeriodRecordPanel from './PeriodRecordPanel'
import { db, clearAllData, exportData, loadLocalData } from './db'
import { setLocale } from './i18n'
import * as privacy from './privacy'
import * as storage from './periodRecords'

const example = { startDate: '2024-02-01', endDate: '2024-02-05', note: '仅自己查看的备注' }
beforeEach(async () => { setLocale('zh-CN'); await clearAllData() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); setLocale('zh-CN') })
async function ready() { await waitFor(() => expect(screen.getByRole('button', { name: '保存经期记录' })).toBeEnabled()) }
function fill(start = example.startDate, end = '', note = '') {
  fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: start } })
  fireEvent.change(screen.getByLabelText('结束日期（选填）'), { target: { value: end } })
  fireEvent.change(screen.getByLabelText('备注（选填，最多 200 字）'), { target: { value: note } })
}
function save() { fireEvent.click(screen.getByRole('button', { name: '保存经期记录' })) }
async function requestDelete() {
  fireEvent.click(await screen.findByRole('button', { name: `删除 ${example.startDate} 的经期记录` }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认删除' })) })
}

describe('local-only period record storage', () => {
  it('persists only in dedicated settings, omits backups and chat state, and clears with local reset', async () => {
    expect(await storage.addPeriodRecord(example)).toEqual([example])
    expect((await db.settings.get(storage.periodRecordsKey))?.value).toEqual({ version: 1, records: [example] })
    expect(await storage.loadPeriodRecords()).toEqual([example])
    expect(await db.messages.count()).toBe(0)
    expect(await db.memories.count()).toBe(0)
    expect(await db.summaries.count()).toBe(0)
    expect((await loadLocalData()).settings).not.toHaveProperty(storage.periodRecordsKey)
    expect(await exportData()).not.toContain(example.note)
    expect(await exportData()).not.toContain(storage.periodRecordsKey)
    await clearAllData()
    expect(await storage.loadPeriodRecords()).toEqual([])
  })
  it('validates real calendar dates, future dates, reversed ranges, and note bounds', async () => {
    for (const input of [
      { startDate: '2024-02-30' }, { startDate: 'not-a-date' }, { startDate: '0000-01-01' },
      { startDate: '9999-01-01' }, { startDate: example.startDate, endDate: '2024-02-30' },
      { startDate: example.startDate, endDate: '9999-01-01' },
      { startDate: example.startDate, endDate: '2024-01-31' },
      { startDate: example.startDate, note: '字'.repeat(201) },
    ]) await expect(storage.addPeriodRecord(input)).rejects.toBeInstanceOf(storage.PeriodRecordError)
    expect(await storage.loadPeriodRecords()).toEqual([])
    await expect(storage.addPeriodRecord({ startDate: '2024-02-29', note: '字'.repeat(200) })).resolves.toHaveLength(1)
  })
  it('uses device calendar dates rather than UTC dates', () => {
    const date = new Date(2024, 1, 29, 23, 59)
    expect(storage.periodToday(date)).toBe('2024-02-29')
  })
  it('prevents duplicate starts atomically and preserves concurrent independent records', async () => {
    const results = await Promise.allSettled([storage.addPeriodRecord(example), storage.addPeriodRecord(example)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    await Promise.all([storage.addPeriodRecord({ startDate: '2024-01-01' }), storage.addPeriodRecord({ startDate: '2024-03-01' })])
    expect((await storage.loadPeriodRecords()).map(record => record.startDate)).toEqual(['2024-03-01', example.startDate, '2024-01-01'])
  })
  it('rejects corrupted storage without overwriting it', async () => {
    const corrupt = { version: 1, records: [{ startDate: '2024-02-30' }] }
    await db.settings.put({ key: storage.periodRecordsKey, value: corrupt })
    await expect(storage.loadPeriodRecords()).rejects.toBeInstanceOf(storage.PeriodRecordError)
    await expect(storage.addPeriodRecord(example)).rejects.toBeInstanceOf(storage.PeriodRecordError)
    expect((await db.settings.get(storage.periodRecordsKey))?.value).toEqual(corrupt)
  })
  it('guards both creating and deleting records in temporary mode', async () => {
    await storage.addPeriodRecord(example)
    await expect(storage.addPeriodRecord({ startDate: '2024-03-01' }, { temporary: true })).rejects.toThrow('临时会话')
    await expect(storage.deletePeriodRecord(example.startDate, { temporary: true })).rejects.toThrow('临时会话')
    expect(await storage.loadPeriodRecords()).toEqual([example])
  })
  it('holds a usage lease through commit and releases even after write errors', async () => {
    const release = vi.fn(async () => {})
    const lease = vi.spyOn(privacy, 'acquireUsageLease').mockResolvedValue(release)
    await storage.addPeriodRecord(example)
    expect(lease).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
    await expect(storage.addPeriodRecord(example)).rejects.toThrow('重复')
    expect(release).toHaveBeenCalledTimes(2)
  })
})

describe('embedded period record panel', () => {
  it('has no nested dialog, saves and reopens persistent history, and confirms deletion', async () => {
    const first = render(<PeriodRecordPanel />)
    expect(screen.queryByRole('dialog')).toBeNull()
    await ready(); fill(example.startDate, example.endDate, example.note); save()
    await screen.findByText('经期记录已保存在本机。')
    expect(screen.getByText(example.note)).toBeInTheDocument()
    first.unmount()
    render(<PeriodRecordPanel />); await ready()
    expect(screen.getByText(example.note)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: `删除 ${example.startDate} 的经期记录` }))
    expect(await storage.loadPeriodRecords()).toEqual([example])
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('button', { name: '确认删除' })).toBeNull()
    await requestDelete(); await screen.findByText('记录已删除。')
    expect(await storage.loadPeriodRecords()).toEqual([])
  })
  it('requires start date, rejects future/reversed dates and duplicate starts', async () => {
    render(<PeriodRecordPanel />); await ready(); save()
    expect(screen.getByRole('alert')).toHaveTextContent('请选择有效的开始日期')
    fill('9999-01-01'); save()
    expect(screen.getByRole('alert')).toHaveTextContent('日期不能晚于今天')
    fill(example.startDate, '2024-01-31'); save()
    expect(screen.getByRole('alert')).toHaveTextContent('结束日期不能早于开始日期')
    fill(); save(); await screen.findByText('经期记录已保存在本机。')
    fill(); save()
    expect(screen.getByRole('alert')).toHaveTextContent('该开始日期已有记录')
    expect(await storage.loadPeriodRecords()).toHaveLength(1)
    expect(screen.getByLabelText('备注（选填，最多 200 字）')).toHaveAttribute('maxlength', '200')
  })
  it('disables mutations while loading and offers retry after a load error', async () => {
    const load = vi.spyOn(storage, 'loadPeriodRecords').mockRejectedValueOnce(new Error('unavailable'))
    render(<PeriodRecordPanel />)
    expect(screen.getByRole('button', { name: '保存经期记录' })).toBeDisabled()
    await screen.findByText('无法读取经期记录，请重试；未覆盖已有记录。')
    expect(screen.getByLabelText('开始日期')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await ready()
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('retains the draft on save failure and never reports success', async () => {
    vi.spyOn(storage, 'addPeriodRecord').mockRejectedValueOnce(new Error('disk failed'))
    render(<PeriodRecordPanel />); await ready(); fill(); save()
    await screen.findByText('经期记录未保存，请检查本机存储后重试。')
    expect(screen.queryByText('经期记录已保存在本机。')).toBeNull()
    expect(screen.getByLabelText('开始日期')).toHaveValue(example.startDate)
    expect(await storage.loadPeriodRecords()).toEqual([])
    save(); await screen.findByText('经期记录已保存在本机。')
  })
  it('does not remove history or report success after delete failure', async () => {
    await storage.addPeriodRecord(example)
    vi.spyOn(storage, 'deletePeriodRecord').mockRejectedValueOnce(new Error('disk failed'))
    render(<PeriodRecordPanel />); await ready(); await requestDelete()
    await screen.findByText('删除未完成，请重试；记录仍保留。')
    expect(screen.queryByText('记录已删除。')).toBeNull()
    expect(screen.getByText(example.note)).toBeInTheDocument()
    expect(await storage.loadPeriodRecords()).toEqual([example])
  })
  it('shows existing records read-only in temporary chat and disables inputs and delete', async () => {
    await storage.addPeriodRecord(example)
    const add = vi.spyOn(storage, 'addPeriodRecord')
    const remove = vi.spyOn(storage, 'deletePeriodRecord')
    render(<PeriodRecordPanel temporary />)
    await screen.findByText(example.note)
    expect(screen.getByText('临时会话中仅可查看，不能新增或删除本机经期记录。')).toBeInTheDocument()
    expect(screen.getByLabelText('开始日期')).toBeDisabled()
    expect(screen.getByLabelText('备注（选填，最多 200 字）')).toBeDisabled()
    expect(screen.getByRole('button', { name: `删除 ${example.startDate} 的经期记录` })).toBeDisabled()
    save()
    fireEvent.submit(document.querySelector('form')!)
    expect(add).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(await storage.loadPeriodRecords()).toEqual([example])
  })
  it.each(['temporary', 'unmount'] as const)('blocks pending writes after %s while acquiring a privacy lease', async change => {
    let grant!: (release: () => Promise<void>) => void
    const release = vi.fn(async () => {})
    vi.spyOn(privacy, 'acquireUsageLease').mockImplementation(() => new Promise(resolve => { grant = resolve }))
    const view = render(<PeriodRecordPanel />); await ready(); fill(); save()
    expect(screen.getByRole('button', { name: '正在保存…' })).toBeDisabled()
    if (change === 'temporary') view.rerender(<PeriodRecordPanel temporary />)
    else view.unmount()
    grant(release)
    await waitFor(() => expect(release).toHaveBeenCalledOnce())
    expect(await storage.loadPeriodRecords()).toEqual([])
    expect(screen.queryByText('经期记录已保存在本机。')).toBeNull()
  })
})
