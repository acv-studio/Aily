import { mkdirSync, writeFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import LedgerApp, { LEDGER_STORAGE_KEY } from './LedgerApp'
const directory = '.mobile-build/ledger-appearance'
const copy = (zh: string, _en: string) => zh
function fixture(state: string) {
  mkdirSync(directory, { recursive: true })
  const clone = document.body.cloneNode(true) as HTMLElement
  const originals = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
  clone.querySelectorAll('input').forEach((input, index) => input.setAttribute('value', originals[index]?.value || ''))
  writeFileSync(`${directory}/${state}.html`, `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>${clone.outerHTML}</html>`)
}
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers() })
it('captures real ledger phone states with one edit target and a separate delete action', () => {
  localStorage.clear(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-07T12:00:00+08:00'))
  const records = [{ id: 'appearance-record', kind: 'expense', cents: 1000, note: 'A', date: '2026-11-07' }]
  const raw = JSON.stringify(records); localStorage.setItem(LEDGER_STORAGE_KEY, raw)
  render(<div className="desktop-tools-overlay"><section className="desktop-tools-dialog tools-surface ledger-shell"><div className="desktop-tools-content"><LedgerApp copy={copy} onClose={() => {}} /></div></section></div>)
  const row = document.querySelector('.ledger-row') as HTMLElement
  expect(within(row).getAllByRole('button')).toHaveLength(2)
  expect(within(row).getByRole('button', { name: '编辑记录：A' })).toBeInTheDocument()
  expect(within(row).getByRole('button', { name: '删除记录：A' })).toBeInTheDocument()
  fixture('details')
  fireEvent.click(screen.getByRole('button', { name: '选择月份' })); fixture('details-month')
  fireEvent.click(within(screen.getByRole('navigation', { name: '手账导航' })).getByRole('button', { name: '预算' })); fixture('budget-month')
  fireEvent.click(screen.getByRole('button', { name: '选择月份' })); fixture('budget')
  fireEvent.click(within(screen.getByRole('navigation', { name: '手账导航' })).getByRole('button', { name: '我的' })); fixture('my')
  fireEvent.click(screen.getByRole('button', { name: '记下一笔' })); fixture('editor')
  expect(localStorage.getItem(LEDGER_STORAGE_KEY)).toBe(raw)
})
