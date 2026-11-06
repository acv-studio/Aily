import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import Dexie from 'dexie'
import { refreshBilling } from './billing'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProfileScreen from './ProfileScreen'
import { setLocale } from './i18n'

const billingLedger = new Dexie('aily-billing-v1')
billingLedger.version(1).stores({ ledger: 'id' })
beforeEach(async () => {
  setLocale('zh-CN')
  await billingLedger.table('ledger').clear()
  await refreshBilling()
})
afterEach(() => { cleanup(); setLocale('zh-CN'); vi.restoreAllMocks() })
async function setup(overrides: Partial<ComponentProps<typeof ProfileScreen>> = {}) {
  const props = {
    userName: '小雨', primaryName: '陆听澜', primaryId: 'lu' as const, setPrimary: vi.fn().mockResolvedValue(undefined),
    apiKey: '', endpoint: 'https://api.deepseek.com', model: 'deepseek-chat',
    setApiKey: vi.fn(), setEndpoint: vi.fn(), setModel: vi.fn(), onImported: vi.fn(), onCleared: vi.fn(),
    beforeDataChange: vi.fn().mockResolvedValue(undefined), openPreferences: vi.fn(),
    openProactive: vi.fn(), openInvite: vi.fn(), openPrivacy: vi.fn(), ...overrides,
  }
  const view = render(<ProfileScreen {...props} />)
  await act(async () => { await refreshBilling() })
  return { ...props, view }
}

describe('organized profile settings', () => {
  it('puts the points entry first and connects all grouped actions without the removed profile card', async () => {
    const props = await setup()
    expect(screen.getAllByRole('button')[0]).toHaveAccessibleName('签到与月卡')
    expect(screen.queryByRole('button', { name: '编辑本机陪伴档案' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '陪伴与互动' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '通用设置' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '修改称呼与互动偏好' }))
    expect(props.openPreferences).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '主角色 陆听澜' }))
    expect(screen.getByRole('radiogroup', { name: '主角色' })).toBeInTheDocument()
    expect(props.setPrimary).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '主动提醒设置' }))
    fireEvent.click(screen.getByRole('button', { name: '邀请朋友' }))
    fireEvent.click(screen.getByRole('button', { name: '安全与隐私' }))
    expect(props.openProactive).toHaveBeenCalledOnce()
    expect(props.openInvite).toHaveBeenCalledOnce()
    expect(props.openPrivacy).toHaveBeenCalledOnce()
  })

  it('expands all three existing companions with avatars, titles and the current primary choice, and collapses without saving', async () => {
    const props = await setup({ primaryId: 'gu', primaryName: '顾辰泽' })
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    const entry = screen.getByRole('button', { name: '主角色 顾辰泽' })
    expect(entry).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(entry)
    expect(entry).toHaveAttribute('aria-expanded', 'true')
    const group = screen.getByRole('radiogroup', { name: '主角色' })
    expect(within(group).getAllByRole('radio')).toHaveLength(3)
    expect(within(group).getByRole('radio', { name: '陆听澜 温柔年上 · 行动派' })).not.toBeChecked()
    expect(within(group).getByRole('radio', { name: '陈奕恒 对抗路 · 年下恋人' })).not.toBeChecked()
    expect(within(group).getByRole('radio', { name: '顾辰泽 克制强势 · 边界清晰' })).toBeChecked()
    for (const avatar of ['澜', '奕', '泽']) expect(within(group).getByText(avatar)).toHaveAttribute('aria-hidden', 'true')
    fireEvent.click(within(group).getByRole('radio', { name: /顾辰泽/ }))
    fireEvent.click(entry)
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(entry).toHaveAttribute('aria-expanded', 'false')
    expect(props.setPrimary).not.toHaveBeenCalled()
  })

  it('awaits saving, disables choices and uses only the persisted primaryId for checked state', async () => {
    let complete!: () => void
    const setPrimary = vi.fn().mockImplementation(() => new Promise<void>(resolve => { complete = resolve }))
    const props = await setup({ setPrimary })
    fireEvent.click(screen.getByRole('button', { name: '主角色 陆听澜' }))
    fireEvent.click(screen.getByRole('radio', { name: /陈奕恒/ }))
    expect(setPrimary).toHaveBeenCalledExactlyOnceWith('chen')
    expect(screen.getByRole('status')).toHaveTextContent('正在保存主角色…')
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-busy', 'true')
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(screen.getByRole('radio', { name: /陆听澜/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /陈奕恒/ })).not.toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: /顾辰泽/ }))
    expect(setPrimary).toHaveBeenCalledTimes(1)
    await act(async () => { complete() })
    expect(screen.getByRole('status')).toHaveTextContent('主角色已更新')
    expect(screen.getByRole('radio', { name: /陆听澜/ })).toBeChecked()
    props.view.rerender(<ProfileScreen {...props} primaryId="chen" primaryName="陈奕恒" />)
    expect(screen.getByRole('radio', { name: /陈奕恒/ })).toBeChecked()
    expect(screen.getByRole('button', { name: '主角色 陈奕恒' })).toHaveAttribute('aria-expanded', 'true')
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '主角色 陈奕恒' }))
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  })

  it('shows a readable save failure, keeps the old selection and permits retry', async () => {
    const setPrimary = vi.fn().mockRejectedValueOnce(new Error('IndexedDB transaction failed')).mockResolvedValue(undefined)
    const props = await setup({ setPrimary })
    fireEvent.click(screen.getByRole('button', { name: '主角色 陆听澜' }))
    fireEvent.click(screen.getByRole('radio', { name: /顾辰泽/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('主角色保存失败，请重新选择以重试。')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /陆听澜/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /顾辰泽/ })).not.toBeChecked()
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeEnabled()
    fireEvent.click(screen.getByRole('radio', { name: /顾辰泽/ }))
    expect(await screen.findByText('主角色已更新')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(setPrimary).toHaveBeenNthCalledWith(1, 'gu')
    expect(setPrimary).toHaveBeenNthCalledWith(2, 'gu')
    props.view.rerender(<ProfileScreen {...props} primaryId="gu" primaryName="顾辰泽" />)
    expect(screen.getByRole('radio', { name: /顾辰泽/ })).toBeChecked()
  })

  it('localizes the inline choices and save feedback in English', async () => {
    setLocale('en')
    await setup({ setPrimary: vi.fn().mockRejectedValue(new Error('failed')) })
    fireEvent.click(screen.getByRole('button', { name: 'Main companion Lu Tinglan' }))
    const group = screen.getByRole('radiogroup', { name: 'Main companion' })
    expect(within(group).getByRole('radio', { name: 'Lu Tinglan Warm & steady · Acts with care' })).toBeChecked()
    expect(within(group).getByRole('radio', { name: 'Chen Yiheng Playful & teasing · Younger partner' })).not.toBeChecked()
    fireEvent.click(within(group).getByRole('radio', { name: /Gu Chenze/ }))
    expect(screen.getByRole('status')).toHaveTextContent('Saving main companion…')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save your main companion. Select a companion again to retry.')
  })

  it('collapses language settings by default and supports live bilingual switching', async () => {
    await setup()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    const entry = screen.getByRole('button', { name: '语言设置 简体中文' })
    expect(entry).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(entry)
    expect(entry).toHaveAttribute('aria-expanded', 'true')
    fireEvent.change(screen.getByRole('combobox', { name: '界面语言 / Interface language' }), { target: { value: 'en' } })
    expect(screen.getByRole('heading', { name: 'General settings' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Language settings English' }))
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('retains API configuration and session key deletion', async () => {
    const props = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'AI 服务 未配置' }))
    fireEvent.click(screen.getByRole('radio', { name: 'DeepSeek' }))
    fireEvent.change(screen.getByLabelText('DeepSeek API Key'), { target: { value: 'test-key' } })
    expect(props.setApiKey).toHaveBeenCalledWith('test-key')
    fireEvent.click(screen.getByRole('button', { name: '删除 Key' }))
    expect(props.setApiKey).toHaveBeenLastCalledWith('')
    expect(screen.getByRole('status')).toHaveTextContent('已删除本次会话中的 Key')
    expect(screen.getByRole('button', { name: '本机聊天与记忆 已隐藏' })).toBeInTheDocument()
  })

  it('opens the real monthly billing pane, checks in against IndexedDB and returns to updated profile points', async () => {
    await setup()
    expect(screen.getByText('可用 20 积分 · 每日额度 20')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '了解会员' })).not.toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '签到与月卡' }))
      await refreshBilling()
    })
    const pane = screen.getByRole('dialog', { name: '积分与订阅' })
    expect(screen.queryByRole('region', { name: '陪伴与互动' })).not.toBeInTheDocument()
    expect(within(pane).getByText('当前为免费基础额度 · 1×')).toBeInTheDocument()
    expect(within(pane).getByText(/此环境不支持 Apple 内购/)).toBeInTheDocument()
    expect(within(pane).getAllByRole('button', { name: '仅限 iOS 内购' })).toHaveLength(4)
    for (const button of within(pane).getAllByRole('button', { name: '仅限 iOS 内购' })) expect(button).toBeDisabled()
    expect(within(pane).getByRole('button', { name: '恢复 Apple 购买' })).toBeDisabled()
    expect(within(pane).getByRole('link', { name: '管理 Apple 订阅' })).toHaveAttribute('href', 'https://apps.apple.com/account/subscriptions')
    expect(within(pane).getByText(/恢复购买只检查 Apple 订阅权益，不恢复本机积分/)).toBeInTheDocument()
    fireEvent.click(within(pane).getByRole('button', { name: '签到领取' }))
    await waitFor(() => expect(within(pane).getByRole('button', { name: '今日已签到' })).toBeDisabled())
    expect(await billingLedger.table('ledger').get('main')).toMatchObject({ bonus: 20, used: 0 })
    fireEvent.click(within(pane).getByRole('button', { name: '关闭积分与订阅' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('可用 40 积分 · 每日额度 20')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '陪伴与互动' })).toBeInTheDocument()
  })

  it('localizes the points entry and full billing pane in English and closes with Escape', async () => {
    setLocale('en')
    await setup()
    expect(screen.getByText('Available: 20 points · Daily quota 20')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check in & monthly passes' }))
      await refreshBilling()
    })
    const pane = screen.getByRole('dialog', { name: 'Points & subscriptions' })
    expect(within(pane).getByRole('button', { name: 'Close points and subscriptions' })).toHaveFocus()
    expect(within(pane).getByText('Daily check-in +20 points')).toBeInTheDocument()
    expect(within(pane).getByText(/Apple in-app purchases are unavailable here/)).toBeInTheDocument()
    expect(within(pane).getAllByRole('button', { name: 'iOS purchase only' })).toHaveLength(4)
    fireEvent.keyDown(pane, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check in & monthly passes' })).toBeInTheDocument()
  })
})
