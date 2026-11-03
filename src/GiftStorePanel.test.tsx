import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GiftStorePanel from './GiftStorePanel'
import { demoDb, loadDemoWallet } from './giftDemo'

beforeEach(async () => { await demoDb.delete(); await demoDb.open() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const openStore = async () => {
  render(<GiftStorePanel selected="chen" />)
  await waitFor(() => expect(screen.getByTestId('demo-balance')).toHaveTextContent(/^0$/))
}
const chooseRecharge = () => fireEvent.click(screen.getByRole('button', { name: '+100 演示币 · 不扣款' }))
const confirmRecharge = () => fireEvent.click(screen.getByRole('button', { name: '确认模拟充值' }))

describe('gift store demo journey', () => {
  it('clearly labels the demo and cancels without changing balance or ledger', async () => {
    await openStore()
    expect(screen.getByText('不扣款演示')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '礼物接收角色' })).toHaveValue('chen')
    chooseRecharge()
    expect(screen.getByRole('group', { name: '确认演示操作' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole('button', { name: '+100 演示币 · 不扣款' })).toHaveFocus()
    expect(await loadDemoWallet()).toEqual({ balance: 0, transactions: [] })
  })
  it('guards rapid duplicate confirmation, persists a recharge and gifts to chosen recipient', async () => {
    await openStore()
    chooseRecharge()
    const confirm = screen.getByRole('button', { name: '确认模拟充值' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await screen.findByText('已模拟充值 100 演示币，未真实扣款。')
    await waitFor(() => expect(screen.getByRole('button', { name: '+100 演示币 · 不扣款' })).toHaveFocus())
    expect((await loadDemoWallet()).transactions).toHaveLength(1)
    fireEvent.change(screen.getByRole('combobox', { name: '礼物接收角色' }), { target: { value: 'gu' } })
    fireEvent.click(screen.getByRole('button', { name: /热饮/ }))
    fireEvent.change(screen.getByRole('spinbutton', { name: '礼物数量' }), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '赠送礼物（演示）' }))
    expect(screen.getByRole('group', { name: '确认演示操作' })).toHaveTextContent('顾辰泽')
    fireEvent.click(screen.getByRole('button', { name: '确认赠送（演示）' }))
    await screen.findByText(/已向顾辰泽赠送热饮 × 2/)
    await waitFor(() => expect(screen.getByRole('button', { name: '赠送礼物（演示）' })).toHaveFocus())
    expect(await loadDemoWallet()).toMatchObject({ balance: 60, transactions: expect.arrayContaining([expect.objectContaining({ kind: 'gift', characterId: 'gu', quantity: 2, coins: 40 })]) })
  })
  it('rejects insufficient funds with no record and disables invalid quantities', async () => {
    await openStore()
    fireEvent.click(screen.getByRole('button', { name: '赠送礼物（演示）' }))
    fireEvent.click(screen.getByRole('button', { name: '确认赠送（演示）' }))
    await screen.findByRole('alert')
    await waitFor(() => expect(screen.getByRole('button', { name: '赠送礼物（演示）' })).toHaveFocus())
    expect(await loadDemoWallet()).toEqual({ balance: 0, transactions: [] })
    for (const value of ['', '0', '-1', '100', '1.5']) {
      fireEvent.change(screen.getByRole('spinbutton', { name: '礼物数量' }), { target: { value } })
      expect(screen.getByRole('button', { name: '赠送礼物（演示）' })).toBeDisabled()
    }
  })
  it('shows a storage error and recovers on explicit retry', async () => {
    const read = vi.spyOn(demoDb.wallet, 'get').mockRejectedValueOnce(new Error('unavailable'))
    render(<GiftStorePanel selected="lu" />)
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: '+100 演示币 · 不扣款' })).toBeDisabled()
    read.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: '重新读取余额' }))
    await waitFor(() => expect(screen.getByTestId('demo-balance')).toHaveTextContent(/^0$/))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
